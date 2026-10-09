# North York scraper — health log

| | |
|---|---|
| **Platform** | GB Language Centre API (`api.gblc.ca`) |
| **Diff strategy** | **Per-date diff** (`diffByDate: true`) within each format — notify on dates absent from its previous snapshot |
| **Page(s)** | API: `api.gblc.ca/candidates/test-schedules/?test_id=6&has_available_seats=true` · booking: `gblc.ca/en/book-now/choose-date` |
| **Discord** | #northyork |
| **DB key** | city=`northyork`, exam_type=`TCF Canada - Computer` or `TCF Canada - Paper` |
| **Status** | Computer coverage verified 2026-10-09; approved Paper addition validated locally, production verification pending |

## How it works
- `scrapeNorthYork()` GETs the official booking site's public schedule API for
  `test_id=6` (TCF Canada), with `has_available_seats=true`. It includes both
  verified formats: Computer (`id=5`) and Paper (`id=4`).
- The response is currently a **complete bare JSON array**, not a paginated
  envelope. The October 9 filtered/unfiltered audit found 171 Computer and 3
  Paper schedules; querying all tests returned those same 174 TCF records plus
  other exam types. No additional TCF dates or pages were found.
- Validate every record's exam/format identity, Toronto location, unique numeric
  ID, date/time fields, positive remaining seats, and true availability flag
  before accepting the snapshot. Unknown envelopes, formats, conflicting
  availability, malformed rows, HTTP errors, or redirects throw; the orchestrator
  preserves the previous state. A bare empty array is accepted as empty.
- IDs, dates, times, Computer exam-type labels and booking URL remain unchanged.
  Paper uses the separate `TCF Canada - Paper` row in the existing state table.
- **Per-date diff** stays independent for each exam type. Adding Paper does not
  replay already stored Computer dates. New Paper dates notify once; repeated
  schedules update state silently. A disappeared format clears only its own row.

## Known failure modes / gotchas
- **Silence alone does not establish health.** Compare official entry points,
  available formats, complete upstream records, parsed records, database state,
  and Discord delivery. A matching maximum date is insufficient: earlier missing
  dates or a whole omitted format can share the same horizon.
- **Former Computer-only scope omitted real Paper exams.** The prior query used
  `format_id=5`. Although that restriction was documented as intentional, it did
  not cover all TCF Canada offerings at GBLC. The user approved including Paper
  on October 9 after three available Paper sessions were verified.
- **Availability is source data.** The observed API rows have positive seats and
  `has_available_seats=true`; no purchase was attempted. The monitor does not
  reserve seats, and availability can change before someone books.
- **Future API changes fail visibly.** A paginated envelope is not guessed or
  silently flattened; investigate the booking site's new complete-fetch contract
  before changing the parser.

## Incident log
- **2026-06-13 (assessment — benign)** — User flagged ~5.6-day silence (last ping
  **Jun 8**) deviating from the near-daily cadence. Investigated: scraper **healthy**
  — `checked_at` 2 min fresh, returns **121 live slots / 50 dates (Jun 17 → Sep 27)**,
  all already stored (n=121). **Root cause: benign** — GBLC's test-6/format-5 date
  horizon is capped at **Sep 27** and the DB already holds every one of those dates,
  so the per-date diff has nothing new to report. Verified **no missed-date bug**:
  response shape still a bare array (unfiltered query also returns 121 → 121 is not a
  pagination cap), and **filtered == unfiltered** with zero test-6/format-5 dates
  beyond Sep 27. Will resume pinging automatically when GBLC releases the next batch
  (≈October dates). **No code change.**

- **2026-10-09 (deep coverage audit)** — The official TCF page and current booking
  frontend support Computer (`format_id=5`) and Paper (`format_id=4`). The API
  returned **174 TCF Canada schedules: 171 Computer across 89 dates (2026-10-17
  through 2027-02-28), plus 3 Paper**. All 171 Computer IDs/dates matched the
  read-only production snapshot (`checked_at=2026-10-09T03:51:39.251Z`,
  `notified_at=2026-10-06T22:56:45.682Z`), so Computer silence was explained by no
  new dates. The Paper omission is separate from that benign Computer silence.
  Verified Paper offerings were:

  | Date | Group time | Remaining seats | Schedule ID |
  |---|---|---|---|
  | 2027-01-05 | 10:00–13:00 | 13 | 1426 |
  | 2027-01-26 | 10:00–13:00 | 25 | 1427 |
  | 2027-02-23 | 10:00–13:00 | 26 | 1485 |

  These counts are dated observations. The approved repair removes the Computer
  filter and validates both known formats. Local parsing of all 174 captured
  records preserves the former 171 Computer outputs byte-for-byte. Five offline
  regression tests cover actual Computer/Paper records, query and production
  wiring, invalid identities/availability/envelopes, separate state rows,
  first-Paper notification, deduplication, and disappearance. Typecheck passed.
  Tests use a sanitized fixture with one actual Computer record and all three
  Paper records. **No production notification or deployment is established by
  these local checks.**

## Debug recipe
```bash
# Public-source dry-run only (no database or Discord)
npx tsx scripts/scrapers/northyork.ts

# Offline regression checks
node --import tsx --test tests/northyork.test.ts
npm run typecheck

# Read-only state: compare complete date sets separately for each format.
SELECT exam_type, jsonb_array_length(slots) AS n, checked_at, notified_at
FROM slot_monitor_state WHERE city='northyork';
```

Official entry points:
- <https://www.gblc.ca/en/tests/tcf-canada>
- <https://www.gblc.ca/en/book-now/choose-date>
- <https://api.gblc.ca/candidates/test-schedules/?test_id=6&has_available_seats=true>
