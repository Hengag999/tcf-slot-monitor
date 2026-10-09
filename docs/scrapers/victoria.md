# Victoria scraper — health log

| | |
|---|---|
| **Platform** | AF Victoria exam-selector listing (`afvictoria.ca`) — separate from Vancouver |
| **Diff strategy** | **Registration reminders** (`reminderMode: true`) — *not* availability diffing |
| **Page(s)** | `https://www.afvictoria.ca/language/exams/tcf/` (all pages; Victoria location required) |
| **Discord** | #victoria (bot "BonTCF Victoria Bot") |
| **DB key** | city=`victoria`, exam_type=`TCF Canada` (the `slots` JSONB holds reminder tracking, not slots) |
| **Status** | Source correction deployed 2026-10-09; real reminder delivery, persistence, and repeat suppression verified |

## How it works
- Victoria has its own [official TCF booking page](https://www.afvictoria.ca/language/exams/tcf/).
  `scrapeVictoria()` uses the shared exam-selector **parser** against that URL;
  it must not use Vancouver's source URL. All same-origin Show More pages are
  followed before producing a complete snapshot.
- Every returned TCF row must explicitly identify Victoria in its location.
  An unexpected location, missing table, or failed later page throws and
  preserves the previous state instead of silently producing an empty result.
- Rows feed the existing registration-reminder engine: actionable new sessions,
  then 3d/2d/1d reminders ahead of `data-opens-at`. Already closed/full records are
  tracked silently. The timezone is `America/Vancouver`, labelled **维多利亚时间**.
- The existing city/exam-type database row and Discord webhook are retained.
  A due notification must be acknowledged by Discord before tracking advances.

## Known failure modes and coverage boundaries
- The retired Oncord product URL broke in June 2026. The July repair switched
  to the AF-CAPA Vancouver listing. By October 9 that source choice was wrong:
  Victoria's own TCF page had 27 sessions while Vancouver's 106-row listing
  contained none. A successful empty scrape was therefore a coverage failure.
- The general Victoria `/language/exams/` page still contains older prose
  directing candidates to Vancouver and asking them to check back. Its own
  dedicated `/language/exams/tcf/` page is a working booking calendar. Inspect
  actual exam links and tables instead of treating the general FAQ as proof
  that Victoria is inactive.
- Fresh `checked_at` and an OK workflow establish execution/persistence, not
  source completeness. Zero due reminders also do not exercise the webhook.
- Historical assertions below describe what was inspected at the time. In
  particular, the July claim that there was no bookable Victoria TCF anywhere
  was broader than the evidence; the October 6 assessment also missed the
  separate Victoria calendar. Do not reuse those as current health conclusions.

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
# See all Victoria rows, including closed/full and future registration records
npx tsx scripts/scrapers/victoria.ts

# DB state (slots JSONB holds reminder tracking)
SELECT city, exam_type, slots,
       round(EXTRACT(EPOCH FROM (NOW()-checked_at))/60) AS checked_min_ago,
       checked_at, notified_at
FROM slot_monitor_state WHERE city='victoria';
```


## 2026-10-06 verification

Latest observed Discord message: May 26 06:04 China time. Stored state was refreshed by the latest October 6 run with zero rows. The repaired shared parser follows all three public pages and finds 95 AF-CAPA sittings, **zero with a Victoria location**. This verifies the monitored source's current empty state, not the absence of exams at every possible provider. Shared pagination, stable identities, historical-row baselining, and pre-opening-only countdowns are implemented locally; production adoption remains pending.


## Shipment verification — 2026-10-06 21:18 China time

The repairs are deployed on `master`. [GitHub run 37469738669](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/37469738669) passed all source checks and refreshed stored state. See `docs/health-assessment-2026-10-06.md` for the first-run Discord timeout, verified message reconciliation, and final production evidence. Earlier local-only/pending-deployment statements above describe the pre-shipment assessment.


## October 9, 2026 — false healthy result from the wrong source

The user questioned silence since May. The Discord channel was inspected
in the logged-in browser: its last message was **May 26 at 06:04 China time**
(`2026-05-25T22:04:04.589Z`), announcing August 17–27 exams through the old
product URL. At 11:35 China time, a read-only query authenticated as
`tcf_slot_monitor` found an empty Victoria tracking array, refreshed at
`03:31:42.204Z`, with `notified_at=2026-05-25T22:04:06.829Z`.

The monitored Vancouver source returned three complete HTTP 200 pages:
15 + 60 + 31 = **106 rows**, all Vancouver (51) or New Westminster (55).
Its location filter was set to Any Location and offered only those two sites.
This confirms the current parser was not dropping Victoria rows from that
source; Victoria was publishing elsewhere.

The separate [official Victoria TCF page](https://www.afvictoria.ca/language/exams/tcf/)
returned two HTTP 200 pages, 15 + 12 = **27 rows**, all at Alliance Française
Victoria, 1218 Langley Street. The existing parser reads it without changes:
**11 closed, 12 full, and four upcoming registrations**.

| Exam date | Published places | Registration opens |
|---|---:|---|
| December 15, 2026 | 9 | October 20, 15:00 Victoria time |
| December 16, 2026 | 8 | October 20, 15:00 Victoria time |
| December 17, 2026 | 16 | October 20, 15:00 Victoria time |
| December 18, 2026 | 8 | October 20, 15:00 Victoria time |

The source epoch is `1792533600`, or `2026-10-20T22:00:00Z`:
**October 21 at 06:00 China time**. These are future registration opportunities,
not seats currently bookable. December 1–4 dates are already full; historical
closed/full rows must not trigger catch-up availability alerts.

The general exams page's old Vancouver advice conflicts with this dedicated
calendar. The exact date this independent calendar resumed, and the number of
historical openings missed, have not been established. The current 27-row
calendar proves the coverage defect; green jobs never disproved it.

Discord settings still showed one existing webhook, **BonTCF Victoria Bot**,
posting to `#victoria`, created April 19. The encrypted GitHub secret was present
with that date. This metadata check did not send a test message or independently
prove the secret's delivery; the next normal scheduled notification will do so.
No credential, database grant, scheduler, or channel permission changes were
required.

The correction passed **129 offline tests**, TypeScript checking, and whitespace
validation. Regression fixtures cover both real pages, the actual orchestrator
source URL, four upcoming reminders, 23 silent baselines, repeat suppression,
and failures that must preserve the previous snapshot.

### Production verification — October 9

Commit `b869ffe` switched the production source to Victoria's own calendar.
The normal timer-created [run 37880785744](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/37880785744)
started at **03:46:11 UTC / 11:46:11 China time**. It passed 129 tests,
typecheck, and the scoped database guard with zero forbidden privileges.
Victoria tracked 27 rows and Discord accepted all four due reminders in
one [message](https://discord.com/channels/1484038585907810535/1495289361342791780/1557962483019550740).
The message was independently read in the logged-in browser, timestamped
`2026-10-09T03:46:41.495Z`, with the four December dates, correct official URL,
and October 20 at 15:00 Victoria registration time.

A read-only database check at `03:47:35.922Z`, authenticated as
`tcf_slot_monitor`, confirmed **27 tracking entries**: four with `new` consumed
and 23 silent baselines. Both `checked_at` and `notified_at` advanced to
`03:46:43.345Z` after delivery. Eleven sources passed; Toronto paper encountered
its known challenge five minutes after its preceding success, within the
approved grace period, and preserved its availability snapshot.

The following automatic [run 37881152902](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/37881152902)
started at **03:51:05 UTC**, 4 minutes 54 seconds after the first. It passed all
129 tests, typecheck, the scoped guard (zero forbidden privileges), and all
**12 source checks**, including a recovered Toronto paper check. Victoria again
tracked **27 records with zero reminders**. A read-only query at `03:52:15.604Z`
confirmed `checked_at=03:51:40.229Z` while `notified_at` remained
`03:46:43.345Z`; the same four `new` markers and 23 silent baselines remained.
This verifies real delivery, persistence, and repeat suppression on the deployed
source. No manual dispatch or local production run was used. Recovery of
Toronto on this cycle does not imply a permanent repair to its upstream challenge.
