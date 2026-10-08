# Vancouver scraper — health log

Latest investigation: [October 8 failure emails](../health-assessment-2026-10-08.md).
The shared parser supports the documented held-seat countdown and retains strict
failure handling plus structural diagnostics for unrecognized booking markup.

| | |
|---|---|
| **Platform** | AF "exam-selector" listing table (`alliancefrancaise.ca`) — migrated off Oncord |
| **Diff strategy** | **Registration reminders** (`reminderMode: true`) — *not* availability diffing |
| **Page(s)** | `https://www.alliancefrancaise.ca/en/language/exams/tcf-canada/` |
| **Discord** | #vancouver (bot "Vancouver Bot") |
| **DB key** | city=`vancouver`, exam_type=`TCF Canada` (the `slots` JSONB holds reminder tracking, not slots) |
| **Status** | Local repair verified 2026-10-06; production still uses first-page-only parser until deployment |

## How it works
- `scrapeVancouver()` returns **every exam row** on the TCF-Canada listing table
  whose Location column is **not Victoria's** (the same platform hosts AF Victoria —
  see `docs/scrapers/victoria.md`; parsing is shared in `src/lib/examSelector.ts`),
  not "bookable slots". Columns: Exam · Schedules · Registration
  Dates · Location · Spots left · Price · Bookings.
- The **Bookings cell** carries the machine-readable state:
  `<span class="es-status es-status-… " data-opens-at="<unix epoch>">`. The epoch is
  the exact registration-open time (no Pacific-timezone parsing needed); the
  `es-status-*` class is captured for diagnostics.
- The reminder engine (`src/lib/registrationReminders.ts`, `computeReminders`) decides
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
- **Observed `es-status-*` states so far** (2026-07-07): `es-status-opens-soon`
  (pre-open, carries `data-opens-at`), `es-status-full`, `es-status-closed`. Rows in
  full/closed state carry **no `data-opens-at`** → `registrationOpensAt: null`. A row
  first sighted in that state gets a new-session ping showing the human registration
  window (fixed 2026-07-07; previously said "时间待定"). The truly-OPEN markup is still
  unobserved — the reminder model doesn't depend on it. The `bookingUrl` falls back to
  the listing page when the Bookings cell has no link.
- **Sub-day reminders are deliberately absent** — don't "fix" their absence; the cron
  can't deliver them reliably.
- **No separate open-now threshold** by design (decided 2026-06-13). Easy to re-add in
  `computeReminders` (`THRESHOLDS` + a kind for lead 0) if wanted.

## Incident log
- **2026-07-07** — health check: reminder chains confirmed firing live in #vancouver
  (new-session Jun 19, then 3d Jun 19 / 2d Jun 20 / 1d Jun 21 for the Sep 9–28 block;
  3d Jul 3 / 2d Jul 4 / 1d Jul 5 for Oct 2/5). Refactor: parsing moved to
  `src/lib/examSelector.ts` + Location filter (NOT-Victoria) so AF Victoria (now on
  the same platform) gets its own rows; engine generalised to
  `src/lib/registrationReminders.ts`. Behaviour unchanged for Vancouver except the
  null-opens-at new-session copy (see above).
- **2026-06-13** (`8d86a5c`) — DB `checked_at` ~10h stale; dry-run threw "neither
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


## 2026-10-06 investigation and local repair

Discord's latest observed ping is September 14 06:38 China time (the 1-day reminder for September 14 15:00 Pacific). The database is fresh at the latest October 6 GitHub run, but freshness hid incomplete discovery: the old parser read only the first 15 rows.

The official table currently has **95 rows over 3 pages (15 + 60 + 20)**. There are 58 closed sittings and **37 future registrations**: 25 New Westminster, 12 Vancouver. All 37 open November 2, 2026 at 15:00 Pacific (November 3 07:00 China time). None are Victoria. A read-only preview against existing tracking yields 37 new-session reminders and no replay of historical closed sessions.

The shared parser now follows the actual Show More links, rejecting an incomplete traversal, and gives each sitting a location/schedule-aware identity. The former label slug conflated 26 distinct rows in this snapshot; `legacyExamKey` migrates consumed reminders without replaying them. Notification copy includes the location. Closed/full historical rows are baselined silently and countdowns stop at opening. A missing webhook cannot consume reminder state.

Two three-day batches were visible in Discord on September 12 at 06:01 and 08:07 China time. The precise historical cause was not established; stable identities and serialized workflow runs address current duplication risks but do not prove that cause.

These changes are locally tested. No repaired production run or new Discord delivery has occurred in this assessment. The older sections above record historical behavior; the updated engine supersedes their allowance for announcing closed rows.


## Shipment verification — 2026-10-06 21:18 China time

The repairs are deployed on `master`. [GitHub run 37469738669](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/37469738669) passed all source checks and refreshed stored state. See `docs/health-assessment-2026-10-06.md` for the first-run Discord timeout, verified message reconciliation, and final production evidence. Earlier local-only/pending-deployment statements above describe the pre-shipment assessment.
