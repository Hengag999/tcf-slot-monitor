---
name: health-assessment
description: >-
  Periodic health assessment of all 9 TCF slot-monitor city scrapers: read
  Discord ping cadence, check DB checked_at freshness, triage silence by each
  city's diff strategy, investigate suspects against the live site, and fix
  broken scrapers. Use this whenever the user asks to "check the scrapers",
  "assess health", "do a maintenance/recon run", "why is <city> silent",
  "look at the Discord channels", or anything about whether the monitors are
  working as intended — even if they don't say "health assessment".
---

# Scraper health assessment

Goal: for each of the 9 cities, reach a verdict — **healthy**, **benignly
quiet**, or **broken** — then fix the broken ones. Recon first, verdicts for
all cities, then fixes. Don't start editing code the moment you find the first
suspect; a full picture first avoids fixing the wrong thing.

## Stage 1 — DB freshness (the strongest signal)

```bash
npx tsx .claude/skills/health-assessment/scripts/db-health.mts   # run from repo root
```

A scraper that throws is *skipped* by the orchestrator (no upsert), so its
`checked_at` freezes while healthy cities keep updating. **Any city lagging
the freshest cohort is broken** — this beats Discord ping age, which only
reflects notification events. Note: the `*/5` cron is actually throttled by
GitHub to ~1.5–4h intervals, so "fresh" means "within the last few hours",
and all rows share the same timestamp cohort per run.

If local DB auth fails: creds live in `.env.local` (may lag the CI secret);
transient Neon auth errors happen — retry once.

## Stage 2 — Discord ping cadence

Server BonTCF, one channel per city. Channel IDs (URL form
`https://discord.com/channels/1484038585907810535/<channelId>`):

| City | Channel ID |
|------|-----------|
| ashton | 1484039767829123164 |
| calgary | 1484039873999667261 |
| edmonton | 1495289049014075526 |
| halifax | 1484039971886207106 |
| ottawa | 1484040043583504555 |
| toronto | 1484040090144608346 |
| toronto-north-york | 1485198603604594730 |
| vancouver | 1484040131932455003 |
| victoria | 1495289361342791780 |

Use Chrome MCP: `navigate` to each channel URL, then run
`scripts/discord-latest-pings.js` via `javascript_tool` (not `get_page_text`
— it drops timestamps). The script polls because the message list paints 1–2s
late after navigation. First Chrome MCP call in a session often fails once —
retry before treating it as a real error.

## Stage 3 — Triage silence by diff strategy

Weigh each gap against that city's **own historical cadence**, never a fixed
threshold. Interpretation depends on the strategy (see CLAUDE.md cities table):

- **0→N cities** (toronto, calgary, halifax, ottawa, ashton): if slots stayed
  continuously open the state never returns to 0, so silence can be benign.
  BUT a city stuck at *permanent* zero (never pinged, `n_slots` always 0) may
  be watching a **dead/migrated source** — cross-check the scraper's list
  against the platform's own category/keyword search. Fresh `checked_at`
  alone does not prove the source is still alive (learned from Toronto's
  dead CM category 367).
- **Per-date cities** (northyork, edmonton): fresh `checked_at` + live-API
  max date == stored max date ⇒ silence is benign (source drips batches).
  Suspect breakage only if `checked_at` is stale OR live max date exceeds
  the stored set.
- **Reminder cities** (vancouver, victoria): silence just means no upcoming
  registration thresholds. Verify the reminder chains (new/3d/2d/1d) fired at
  the right times relative to `data-opens-at` epochs in the channel history.

## Stage 4 — Investigate suspects

For each suspect, in order:
1. `npx tsx scripts/scrapers/<city>.ts` — standalone dry-run. A throw + the
   frozen `checked_at` usually pinpoints the failure line.
2. Inspect the live target with fetch/tsx or `Invoke-WebRequest` throwaway
   scripts — the user prefers this over browser navigation for scraper
   targets (Chrome is for the logged-in Discord app). Beware: some failures
   are CI-only (WAF challenges against GitHub runner IPs give clean pages
   locally — see docs/scrapers/toronto.md).
3. Read the city's runbook `docs/scrapers/<city>.md` (create from
   `_TEMPLATE.md` if missing) — known failure modes and past incidents often
   match.

Recurring root-cause patterns: platform migrations (Oncord → exam-selector;
dead 301/404 slugs), sold-out states that remove the DOM anchor entirely
(return `[]`, don't throw), APIs returning 204-empty-body, WAF bot
challenges, rotated public API keys.

## Stage 5 — Fix, verify, record

- Fix with the repo's conventions (per-city error isolation, anchor on labels
  not IDs, prefer false negatives over false-positive spam, `[]` is a normal
  steady state).
- Verify: standalone dry-run, then full `npx tsx scripts/scrape-slots.ts
  --dry-run` (all 9 cities must run clean).
- Update the runbook: Status line + incident-log entry (root cause, fix,
  verification). Update CLAUDE.md tables if a city's platform/strategy changed.
- Commit. **Push needs the user** (direct push to master is blocked in auto
  mode) — say so explicitly; unpushed fixes mean CI keeps running broken code
  (this has bitten before).
- After CI runs the fix, re-check the DB: the formerly frozen `checked_at`
  must unfreeze.

## Reporting

End with a per-city verdict table (verdict + one-line evidence), the fixes
made, and what to watch next run (e.g. unvalidated open-detection paths).
