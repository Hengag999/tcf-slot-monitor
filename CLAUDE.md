# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TCF Slot Monitor watches availability of TCF Canada (Test de Connaissance du Français) exam slots across Canadian test centres. A scheduled job scrapes each city's booking site, diffs the result against the last-known state in Postgres, and posts a Discord notification when new bookable slots appear. It runs every 5 minutes via GitHub Actions — there is no web UI or server.

Each city has an independent scraper under `scripts/scrapers/`. `scripts/scrape-slots.ts` is the orchestrator that ties scraping, diffing, persistence, and notification together.

## Commands

Runtime is [tsx](https://github.com/privatenumber/tsx) (TypeScript executed directly — no build step). CI uses Node 20.

```bash
# Dry-run a single city scraper (no DB, no Discord — just prints bookable slots)
npx tsx scripts/scrapers/toronto.ts
npx tsx scripts/scrapers/calgary.ts   # …one file per city

# Dry-run the full pipeline (all cities; no DB writes, no Discord — prints what WOULD notify)
npx tsx scripts/scrape-slots.ts --dry-run

# Run the full pipeline for real (requires POSTGRES_URL + DISCORD_WEBHOOK_* in the environment)
npx tsx scripts/scrape-slots.ts

# Apply the DB schema (one table) to a fresh Neon/Postgres database
psql "$POSTGRES_URL" -f database/migrations/001_slot_monitor_state.sql
```

No test framework is configured (`npm test` is a placeholder that exits 1). There is no `tsconfig.json`; tsx handles execution, so there is no separate compile/typecheck step wired up.

## Architecture

### Pipeline (per run)

`scripts/scrape-slots.ts` loops over every city in its `cities` array and, for each:

1. **Scrape** — calls the city's `scrape{City}()`. A thrown error is caught and that city is **skipped** (logged, run continues) — one broken site never aborts the others.
2. **Group** — buckets the returned slots by `examType` (`groupByExamType`). Exam types that existed in the DB but returned zero this run are forced to an empty group so their state gets cleared.
3. **Diff** — compares against `getPrevState(city)` to decide which slots are newly notifiable (see strategies below).
4. **Notify** — if there's anything new, posts to the city's Discord webhook via `notifyDiscord`.
5. **Persist** — `upsertState` writes the current slots back, stamping `notified_at` only when a notification fired.

In `--dry-run` mode, steps 3–5 read nothing and write nothing: prev state is treated as empty, and notifications are printed to stdout instead of sent.

**Per-city error isolation.** The scrape error in step 1 isn't the only thing caught: steps 2–5 run inside their own per-city `try/catch` too, so a Discord or DB failure for one city is logged and skipped instead of aborting the run mid-loop (which used to leave later cities unprocessed and the failing city's state unwritten, so it re-fired forever). Scrape failures stay silent (sites change — tolerated by design); notify/persist failures are *collected* and, after every city has had its turn, the run `throw`s and exits non-zero so genuine infra breakage (Discord 5xx, DB down) still surfaces as a CI failure alert.

### Notification strategies

Diff strategies, selected per city by a flag in the `cities` config:

| Strategy | Cities | Behaviour |
|----------|--------|-----------|
| **0 → N transition** (default) | Toronto, Calgary, Halifax, Ottawa, Ashton | Notify only when an exam type went from **0** known slots to **>0**. Avoids re-pinging while slots stay open. |
| **Per-date diff** (`diffByDate: true`) | North York, Victoria, Edmonton | Notify about any **date not present in the previous set** (set difference on `slot.date`). Catches new dates appearing while others are already open. |
| **Registration reminders** (`reminderMode: true`) | Vancouver | Doesn't diff availability at all. AF Vancouver's platform advertises each exam's *registration-open* time ahead of time; spots vanish in seconds, so instead of catching availability the engine pings reminders **before** each exam's open time (new-session, then 3d/2d/1d). See `src/lib/vancouverReminders.ts`. The orchestrator routes `reminderMode` cities to `runVancouverReminders` and skips the diff. |

### File layout

```
scripts/
  scrape-slots.ts        # orchestrator (cities config, diff logic, dry-run flag)
  scrapers/<city>.ts     # one independent scraper per city
src/lib/
  db.ts                  # Neon Postgres state: getPrevState / upsertState
  discord.ts             # notifyDiscord (standard) + postDiscord (raw message)
  vancouverReminders.ts  # Vancouver's registration-reminder engine (reminderMode)
database/migrations/
  001_slot_monitor_state.sql
.github/workflows/
  monitor.yml            # cron */5 + manual dispatch
```

### State (Postgres on Neon)

`src/lib/db.ts` uses `@neondatabase/serverless` with a lazily-initialised `neon(POSTGRES_URL)` client (throws if `POSTGRES_URL` is unset). Single table, keyed by `(city, exam_type)`:

```sql
slot_monitor_state(city TEXT, exam_type TEXT, slots JSONB, checked_at TIMESTAMPTZ, notified_at TIMESTAMPTZ, PK(city, exam_type))
```

`upsertState(city, examType, slots, notified)` always refreshes `slots` + `checked_at`; it touches `notified_at` only when `notified` is true. The diff compares the new scrape against the stored `slots` JSON.

### Discord notifier

`src/lib/discord.ts` → `notifyDiscord(webhookUrl, cityLabel, examType, slots)` builds an `@everyone` message listing each slot's date (plus time/seat count when present) and the de-duplicated booking URL(s), then POSTs it. A non-2xx webhook response throws.

**2000-char limit / chunking.** Discord rejects any `content` over 2000 characters with a 400. A heavy day (e.g. Halifax opening 40+ sittings at once, or a North York date dump) easily exceeds that. `postDiscord` — the single send choke point for *both* `notifyDiscord` and Vancouver's reminders — splits over-long content into multiple ≤2000-char messages on line boundaries; only the first chunk carries `@everyone`, so a split message still pings once. Budgeting by JS string `.length` is deliberately conservative (UTF-16 length ≥ Discord's character count).

### Scraper contract

Every file in `scripts/scrapers/` follows the same shape:

- Exports a local `Slot` interface and a `scrape{City}(): Promise<Slot[]>` function.
- Returns **only slots that are currently bookable** — an empty array means nothing is open (this is the normal steady state, not an error).
- Ends with a `process.argv[1].endsWith("{city}.ts")` guard so the file can be run standalone as a dry-run.
- Each `Slot` is defined locally (not shared). The union must satisfy the orchestrator's `MonitorSlot`: `id`, `examType`, `date`, `bookingUrl` are required; `startTime`, `endTime`, `availableSeats` are optional.

### Scraping strategies by city

| City | Platform | Technique |
|------|----------|-----------|
| **Toronto** | Alliance Française CM API + Active Communities API | Fetches session list for two categories (367 = E-TCF/computer, 368 = P-TCF/paper), then confirms each session's `space_status` is not `Full`/`On Hold` via the detail API (concurrency-capped at 5). Only city that distinguishes exam types. |
| **Calgary** | Oncord CMS (static HTML) | Parses month "session cards" in the Step 2 section, skips `SOLD OUT`, extracts the `Registrations` link, then **follows each link** and verifies the destination has ≥1 non-sold-out `<div class="exam-card">`. The month button stays visible after all dates fill, so the destination check is required to avoid false positives. |
| **Vancouver** | AF "exam-selector" listing table (`alliancefrancaise.ca`) | **Not** an availability scraper — returns every exam *row* from the TCF-Canada listing table (`/en/language/exams/tcf-canada/`), each with its registration-open epoch from the Bookings cell's `data-opens-at`. Feeds the reminder engine (`reminderMode`), not the diff. Migrated off the old Oncord product combobox (which 301s to a dead slug). |
| **Halifax** | AEC platform (`afhalifax.aec.app`) | Scrapes the public `APIKEY` from page HTML, then calls the examinations API (type 16). Bookable = `isFull === false` AND a non-empty `mainRegisterLink.link`. |
| **Ottawa** | AEC platform (`afottawa.aec.app`) | Same as Halifax; queries two exam-type endpoints (IDs 5 and 79) and labels each slot by its `product_name`. |
| **Ashton** | WordPress/Elementor form (`ashtontesting.ca`) | Parses `<label>` radio entries inside `tcf-radio-picker`; skips `disabled` inputs and `(FULL)` labels. |
| **North York** | GBLC API (`api.gblc.ca`) | Calls the test-schedules endpoint with `has_available_seats=true` (test 6 / format 5); returns sessions with open seats, reporting `availableSeats`. Per-date diff. |
| **Victoria** | Oncord CMS (embedded JSON) | If page shows "isn't available at the moment" → return `[]`. Otherwise same parse as Vancouver, anchored on `Date (Please choose)`. Per-date diff. |
| **Edmonton** | Oncord CMS (embedded JSON) | Anchors on the `choose your session` label. Sold-out sessions stay listed with a `(Sold out)` suffix, so the same `sold out/complet/full` negative-match filter drops them. Per-date diff. |

### Key patterns & gotchas

- **AEC empty state** (Halifax/Ottawa): when there are no examinations, the API returns **HTTP 204 with an empty body** (not `[]`). `res.ok` is true, so `res.json()` would throw "Unexpected end of JSON input" — read the body as text and short-circuit on empty.
- **Oncord sold-out** (Victoria/Edmonton): when sold out, Oncord **removes the combobox entirely** and renders a marker — "isn't available at the moment" (Victoria) or a `<strong>SOLD OUT!</strong>` badge (Edmonton). Detect the marker and return `[]` — don't throw, or stale slots get frozen in the DB. Only throw when *neither* the marker *nor* the expected label is found (genuinely unrecognised structure). (Vancouver used to share this pattern but has since migrated off Oncord — see its row above.)
- **Vancouver registration-open epoch**: the listing table's Bookings cell embeds the registration-open time as a unix epoch (`data-opens-at="…"`) plus an `es-status-*` state class — parse the epoch directly, no Pacific-timezone math. Reminders count down to it.
- **AEC API key is public but may rotate** with platform updates; if requests start 401-ing, re-scrape the page for a fresh `APIKEY`.
- **Anchor on labels, not IDs**: Oncord derives combobox IDs from the field label and they can rotate. The durable approach is to find the label substring, then parse the following `<script type="application/json">` block.
- **Calgary prefers false negatives**: the destination-page per-date check accepts occasionally missing a real opening over emitting weeks of false positives from a stuck month button.

## Environment & secrets

`scripts/scrape-slots.ts` imports `src/lib/env.ts` first, which uses **dotenv** to load `.env.local` into `process.env`. dotenv never overrides variables that are already set, so in CI the GitHub Actions secrets win and the absent file is a silent no-op. (Individual scraper dry-runs don't import the loader — they only hit public pages and need no secrets.)

Required variables:

- `POSTGRES_URL` — Neon/Postgres connection string (only needed for the non-dry-run pipeline).
- `DISCORD_WEBHOOK_{CITY}` — one per city: `TORONTO`, `CALGARY`, `VANCOUVER`, `HALIFAX`, `OTTAWA`, `ASHTON`, `NORTHYORK`, `VICTORIA`, `EDMONTON`. A missing webhook only warns (that city won't notify); it doesn't fail the run.

For local runs, put them in `.env.local` (gitignored), one `KEY=value` per line — quoted values are fine, dotenv strips surrounding quotes and trims whitespace. In CI they come from GitHub Actions secrets. Dry-run modes need none of them. In practice a local `.env.local` often holds only `POSTGRES_URL`, so local real-runs diff against the DB but skip Discord (the webhooks live only as CI secrets).

## CI

`.github/workflows/monitor.yml` runs on a `*/5 * * * *` cron (every 5 minutes) and on manual `workflow_dispatch`: `npm ci` then `npx tsx scripts/scrape-slots.ts`, with `POSTGRES_URL` and all nine `DISCORD_WEBHOOK_*` values injected from repository secrets.
