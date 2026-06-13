# Vancouver scraper — health log

| | |
|---|---|
| **Platform** | AF "exam-selector" listing table (`alliancefrancaise.ca`) — migrated off Oncord |
| **Diff strategy** | **Registration reminders** (`reminderMode: true`) — *not* availability diffing |
| **Page(s)** | `https://www.alliancefrancaise.ca/en/language/exams/tcf-canada/` |
| **Discord** | #vancouver (bot "Vancouver Bot") |
| **DB key** | city=`vancouver`, exam_type=`TCF Canada` (the `slots` JSONB holds reminder tracking, not slots) |
| **Status** | ✅ rebuilt to reminder model — last assessed 2026-06-13 |

## How it works
- `scrapeVancouver()` returns **every exam row** on the TCF-Canada listing table (a
  `VancouverExam[]`), not "bookable slots". Columns: Exam · Schedules · Registration
  Dates · Location · Spots left · Price · Bookings.
- The **Bookings cell** carries the machine-readable state:
  `<span class="es-status es-status-… " data-opens-at="<unix epoch>">`. The epoch is
  the exact registration-open time (no Pacific-timezone parsing needed); the
  `es-status-*` class is captured for diagnostics.
- The reminder engine (`src/lib/vancouverReminders.ts`, `computeReminders`) decides
  pings: a one-off **new-session** ping the first time a row appears, then **3d / 2d /
  1d** reminders before `registrationOpensAt`. Sub-day reminders are intentionally
  omitted (the GH Actions cron can't hit them). Only the **most recent passed
  threshold** fires per run; earlier missed ones are marked done, never back-fired.
- **State** persists in the existing `slot_monitor_state` row (the `slots` JSONB holds
  `[{examKey, label, registrationOpensAt, firedReminders[]}]`). **No schema migration.**

## Why a reminder model (not availability detection)
TCF Vancouver spots vanish within seconds of registration opening, and GitHub Actions
cron is coarse and unreliable (we've seen ~3.5h gaps vs the nominal 5 min). Catching
the instant of availability is hopeless, but the new platform *advertises the
registration-open time in advance* — so we ping people to be ready instead. This
fully replaces the old 0→N availability ping for Vancouver.

## Known failure modes / gotchas
- **Platform migration broke the old scraper** (2026-06): the old Oncord URL
  `/products/ciep-tcf-canada-full-exam/` now **301s to a dead `…-classic` slug**
  ("Product Not Found"), so the old combobox scraper threw every run. The live product
  is the exam-selector; the listing table is the durable source.
- **Open-state Bookings markup is unobserved.** Today every row is `es-status-opens-soon`
  ("Opens in …"). The exact markup once registration is OPEN (Jun 15) isn't known — but
  the reminder model doesn't depend on it (reminders count down to the epoch). The
  `bookingUrl` falls back to the listing page when the Bookings cell has no link.
- **Sub-day reminders are deliberately absent** — don't "fix" their absence; the cron
  can't deliver them reliably.
- **No open-now ping** by design (decided 2026-06-13). Easy to re-add in
  `computeReminders` (`THRESHOLDS` + a kind for lead 0) if wanted.

## Incident log
- **2026-06-13** (`<commit>`) — DB `checked_at` ~10h stale; dry-run threw "neither
  sold-out marker nor 'Date (Please choose)' label found". Cause: AF Vancouver migrated
  off the Oncord product combobox to the exam-selector platform overnight; old URL 301s
  to a dead slug. **Rebuilt** Vancouver as a registration-reminder city: new table
  scraper + `vancouverReminders` engine + orchestrator `reminderMode` branch +
  `postDiscord` helper. Verified: 13/13 engine unit tests (new / 3d / 2d / 1d / catch-up
  / no-double-fire / multi-exam / dropped / null-epoch), live scrape parses both Sep
  exams with correct `data-opens-at` (Jun 15 12pm PDT), full `--dry-run` emits the two
  new-session pings. **Note:** registration opens Jun 15 — watch that the 3d/2d/1d
  reminders actually fire, and capture the open-state `es-status-*` class for the record.

## Debug recipe
```bash
# Dry-run the scraper (prints each exam row + its opens-at epoch + status class)
npx tsx scripts/scrapers/vancouver.ts

# Whole pipeline dry-run (prints Vancouver's WOULD-notify reminder message)
npx tsx scripts/scrape-slots.ts --dry-run

# DB state (slots JSONB holds reminder tracking, not slots)
SELECT city, exam_type, slots,
       round(EXTRACT(EPOCH FROM (NOW()-checked_at))/60) AS checked_min_ago,
       checked_at, notified_at
FROM slot_monitor_state WHERE city='vancouver';

# If the scraper throws, the table structure changed — inspect the page for
# <tr class="tableRow"> rows and the Bookings-cell `data-opens-at` / es-status-* class.
curl -s "https://www.alliancefrancaise.ca/en/language/exams/tcf-canada/" | grep -o 'data-opens-at="[0-9]*"'
```
- The reminder logic is pure (`computeReminders(exams, prevTracking, nowMs)`), so new
  scenarios are easy to unit-test with a throwaway script (see the 2026-06-13 incident).
