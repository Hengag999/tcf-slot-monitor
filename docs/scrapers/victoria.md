# Victoria scraper — health log

| | |
|---|---|
| **Platform** | AF "exam-selector" listing table (`alliancefrancaise.ca`) — shared with Vancouver; migrated off Oncord |
| **Diff strategy** | **Registration reminders** (`reminderMode: true`) — *not* availability diffing |
| **Page(s)** | `https://www.alliancefrancaise.ca/en/language/exams/tcf-canada/` (rows with a Victoria Location) |
| **Discord** | #victoria (bot "BonTCF Victoria Bot") |
| **DB key** | city=`victoria`, exam_type=`TCF Canada` (the `slots` JSONB holds reminder tracking, not slots) |
| **Status** | Benignly quiet in the complete shared listing on 2026-10-06; zero matching rows |

## How it works
- `scrapeVictoria()` fetches the **same shared TCF-Canada listing** as Vancouver
  (parsing in `src/lib/examSelector.ts`) and keeps only rows whose **Location
  column mentions "Victoria"**. Vancouver takes every row that is *not*
  Victoria's, so between the two filters no row is ever silently dropped.
- Rows feed the shared reminder engine (`src/lib/registrationReminders.ts`):
  new-session ping on first sighting, then 3d/2d/1d before `data-opens-at`.
  Message header uses 维多利亚.
- **As of 2026-07-07 the listing carries zero Victoria rows** — AF Victoria's own
  exams FAQ points TCF candidates to AF Vancouver ("check back… when we are
  offering more exams"). `[]` is the normal steady state, not an error. If AF
  resumes Victoria sittings on the platform, the rows appear and reminders fire
  with no code change.

## Known failure modes / gotchas
- **AF Victoria merged into AF-CAPA** (contact `exam-victoria@afcapa.ca`); its own
  site (`afvictoria.ca`, still Oncord) no longer sells exams — the old product page
  `/products/ceip-tcf-canada-full-exam-victoria/` returns a plain **404** (not the
  "isn't available" sold-out marker), so the old Oncord scraper threw every run.
- **Location filter is substring-based** (`/victoria/i` on the Location cell). If
  the platform renames the centre (e.g. drops the word Victoria), rows would fall
  through to Vancouver's channel rather than vanish — watch #vancouver for
  Victoria-looking sittings if this city stays silent after AF re-lists exams.
- Everything in `docs/scrapers/vancouver.md` (opens-at semantics, no sub-day
  reminders, 2000-char chunking) applies here too.

## Incident log
- **2026-07-07** — DB `checked_at` frozen since **2026-06-19** (~18 days; every other
  city ~1h). Dry-run: `Victoria page fetch failed: 404`. Root cause: AF Victoria
  decommissioned its Oncord product page mid-June and folded exam registration into
  the shared AF-CAPA exam-selector platform, which currently lists **no** Victoria
  sessions (Vancouver-only). **Rebuilt** Victoria as a second `reminderMode` city:
  extracted the listing parser to `src/lib/examSelector.ts` (now exposes the
  Location column), generalised `vancouverReminders.ts` → `registrationReminders.ts`
  (city key + Chinese label parameters), Vancouver filter = NOT-Victoria, Victoria
  filter = Victoria. Also fixed the new-session copy when `data-opens-at` is absent
  (row first seen after registration opened): show the human registration window
  instead of "时间待定". Verified: standalone dry-runs (victoria → 0 rows no-throw,
  vancouver → 15 rows) and full `--dry-run` across all 9 cities clean. First real
  run overwrites the stale slot-array state with an empty tracking array.
- **2026-07-13** — Re-assessed (user suspected breakage; silent since 2026-05-25,
  the last ping of the old Oncord scraper). **Verdict: benign, no action.**
  `checked_at` fresh; the shared exam-selector listing has **0** Victoria mentions
  (all 15 rows are Vancouver). Cross-checked afvictoria.ca directly: the
  `/products/categories/exams/tcf-canada/` category now contains only
  workshop/re-evaluation/prep products — no exam sittings — and the old full-exam
  slug redirects to a `…-victoria-classic` URL that 404s. There is currently no
  bookable Victoria TCF anywhere; the scraper is watching the right place and will
  pick rows up if AF-CAPA re-lists them.

## Debug recipe
```bash
# Dry-run the scraper (prints Victoria rows; "No exams listed" is the steady state)
npx tsx scripts/scrapers/victoria.ts

# See ALL rows + locations on the shared listing (is Victoria back?)
npx tsx scripts/scrapers/vancouver.ts

# DB state (slots JSONB holds reminder tracking)
SELECT city, exam_type, slots,
       round(EXTRACT(EPOCH FROM (NOW()-checked_at))/60) AS checked_min_ago,
       checked_at, notified_at
FROM slot_monitor_state WHERE city='victoria';
```


## 2026-10-06 verification

Latest observed Discord message: May 26 06:04 China time. Stored state was refreshed by the latest October 6 run with zero rows. The repaired shared parser follows all three public pages and finds 95 AF-CAPA sittings, **zero with a Victoria location**. This verifies the monitored source's current empty state, not the absence of exams at every possible provider. Shared pagination, stable identities, historical-row baselining, and pre-opening-only countdowns are implemented locally; production adoption remains pending.
