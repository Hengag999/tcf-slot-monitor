# Edmonton scraper — health log

| | |
|---|---|
| **Platform** | Oncord exam-selector listing (migrated from the product combobox) |
| **Diff strategy** | Per-date bookable availability; separate advance-registration reminders |
| **Page(s)** | `https://www.afedmonton.com/en/exams/tcf/` and its Show More pages |
| **Discord** | #edmonton (bot "BonTCF Edmonton Bot") |
| **Availability DB key** | city=`edmonton`, exam_type=`TCF Canada` |
| **Status** | Local repair on 2026-10-06; deployment and subsequent notification delivery require verification |

## Current source and booking signals

The old `https://www.afedmonton.com/products/af-tcf-canada/` entry point now
redirects to a **single closed exam order** at
`/af/exam-selector/order/?exam_id=200`. That page no longer represents all
sessions. Its missing combobox is a migration, not evidence that Edmonton has
stopped offering exams.

The official [TCF page](https://www.afedmonton.com/en/exams/tcf/) names itself as
the source for current sessions and registration information. Its exam-selector
table contains Exam, Schedules, Registration Dates, Location, Spots left, Price,
and Bookings. The initial HTML contains only 15 rows. Follow the actual
`dataShowMore` link until none remains; do not assume a single response is the
complete inventory. On 2026-10-06 the next link was
`?s8-datatable1_start=15&s8-datatable1_rows=60`, returning 13 further rows.
The shared parser validates each page and fails the scrape if pagination is
incomplete.

`scrapeEdmontonExams()` returns all TCF Canada rows for reuse by availability and
reminder processing. `bookableEdmontonSlots()` requires all of:

- An actual booking anchor with `es-status-available`.
- A same-origin `/af/exam-selector/order/?exam_id=<positive integer>` URL.
- A positive seat count, or no numeric count when the booking control is present.
- No registration-open epoch in the future.

A numeric seat count alone is **not** bookability. The November 2 afternoon TCF
row had 1 seat but `es-status-closed` on 2026-10-06; it must return no slot.
The open anchor pattern was independently observed on six rows of the
[same site's DELF listing](https://www.afedmonton.com/en/exams/delf-adults/),
including exam ID 204. A live open **TCF** row was not available to inspect during
this assessment; fixture tests exercise that same platform markup.

The parser keeps exact normalized labels and schedules in stable identities.
Edmonton uses `*` to distinguish afternoon sittings; stripping punctuation alone
would collapse morning and afternoon exams. Booking IDs cannot be the sole key:
closed rows contain no order link, so those IDs disappear when registration ends.

## Advance notice alongside availability

Current registration windows are often only about an hour, shorter than many
observed GitHub scheduling gaps. The served platform JavaScript reads
`data-opens-at` from `.es-status-opens-soon` rows and refreshes them into Book Now
controls when their opening arrives. That supports advance reminders when the
site publishes future epochs. Keep reminder state separate from availability
state, and format opening times in `America/Edmonton`.

Only future, actionable openings should generate advance reminders. Do not send
"new session" pings for existing closed/full rows during migration or send delayed
countdown reminders after an opening. The 2026-10-06 TCF listing had **no future
opening epochs**; this is a dated observation, not a permanent expectation.
Availability monitoring still handles a new bookable date or a reopening even
when no future epoch was advertised.

## Verification snapshot — 2026-10-06

- Two unauthenticated public GETs returned **28 TCF Canada rows** (15 + 13),
  spanning October 7–November 6, 2026.
- All 28 rows showed `es-status-closed`; their registration windows had elapsed.
- 27 rows showed SOLD OUT; the November 2 afternoon row showed 1 seat but remained
  closed. Correct currently bookable result: **0**.
- Six open DELF rows on the same host confirmed the actual Book Now link shape.
- The repaired standalone scraper completed successfully: `28 listed TCF Canada
  exam(s)`, `0 available slot(s)`. All four Edmonton fixture tests passed,
  including an open row beyond the first page and closed-with-seats rejection.
- The prior production scraper was still using the retired product entry point.
  The parent maintenance assessment found its persisted `checked_at` frozen since
  August 7 and its last visible Discord ping dated May 28.
- Public listing reads and local tests do not establish deployed health or Discord
  delivery. No registration was submitted during source inspection.

## Incident log

- **2026-06-13** (`4c5cbd7`) — Old product-level sold-out state removed the combobox.
  Adding the specific SOLD OUT badge check repaired that historical page shape.
- **2026-07-13** — Old product was sold out and local scrape took its empty branch.
  This was a healthy observation at that time, not a guarantee across migration.
- **2026-10-06** — Found the product redirect and current paginated exam-selector
  listing. Replaced old combobox parsing with the shared listing parser, explicit
  bookability checks, and reusable listed-exam output for advance reminders.

## Debug recipe

```bash
# Public reads only; no database writes or Discord messages.
node --import tsx scripts/scrapers/edmonton.ts
node --import tsx --test tests/edmonton.test.ts

# Full pipeline inspection still requires --dry-run.
node --import tsx scripts/scrape-slots.ts --dry-run
```

A healthy dry-run reports the total listed rows and currently bookable count.
Investigate fetch/pagination/parser errors rather than interpreting them as zero
availability. When diagnosing a future regression, inspect the official TCF
entry point, every Show More page, the Bookings cell, and its destination URL.


## Shipment verification — 2026-10-06 21:18 China time

The repairs are deployed on `master`. [GitHub run 37469738669](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/37469738669) passed all source checks and refreshed stored state. See `docs/health-assessment-2026-10-06.md` for the first-run Discord timeout, verified message reconciliation, and final production evidence. Earlier local-only/pending-deployment statements above describe the pre-shipment assessment.
