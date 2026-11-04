# North York scraper — health log

| | |
|---|---|
| **Platform** | GB Language Centre API (`api.gblc.ca`) |
| **Diff strategy** | **Per-date diff** (`diffByDate: true`) within each format — notify on dates absent from its previous snapshot |
| **Page(s)** | API: `api.gblc.ca/candidates/test-schedules/?test_id=6&has_available_seats=true` · booking: `gblc.ca/en/book-now/choose-date` |
| **Discord** | #northyork |
| **DB key** | city=`northyork`, exam_type=`TCF Canada - Computer` or `TCF Canada - Paper` |
| **Status** | Both formats verified; November 3 DNS fallback shipped with 225 tests, three healthy automatic North York cycles and a successful public-only fallback probe on GitHub |

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
- **Unknown transport failures remain immediate.** November 4 diagnostics log
  only allowlisted native names/codes from a bounded error tree, never raw
  messages, addresses or URLs. Four earlier failures lacked this classification
  and recovered; their cause is not established. No broader retry/grace policy
  was inferred from the generic error. See the
  [November 4 incident record](../health-assessment-2026-11-04.md).
  Later observed request resets receive bounded within-run retries; errors
  after response headers remain non-retryable body failures. This does not add
  grace or suppress exhausted failures. See the
  [afternoon network incident](../health-assessment-2026-11-04-network.md).
- **Intermittent request-transport failures:** only observed
  `ECONNREFUSED`, `UND_ERR_CONNECT_TIMEOUT` and request-stage `ECONNRESET`
  receive up to three GET attempts,
  with 1s/2s backoff and a fresh 30s deadline. The first request uses normal DNS;
  subsequent attempts use a request-local Google resolver for this API hostname
  with normal HTTPS certificate/SNI verification. No API IP is pinned and no
  global DNS/hosts settings change. This addresses inconsistent public DNS
  answers directly observed from CI on November 3. Exhaustion still fails the workflow
  immediately and preserves both formats. HTTP, TLS, DNS, unknown transport,
  response-body and inventory errors are not retried. No one-hour grace or
  repeat-alert suppression applies to North York.

## Incident log
- **2026-11-04 afternoon (confirmed request resets)** — The safe diagnostics
  identified three recent immediate failures as native `ECONNRESET`. Added that
  request-stage error to the existing bounded three-attempt GET recovery; body
  errors after headers remain immediate and cannot be retried by this change.
  All 235 tests/typecheck passed. Normal runs `41798078469`, `41798717255` and
  `41799359528` passed all 12 sources and the scoped guard with zero forbidden
  privileges, retaining 151 Computer + 2 Paper without changing notification
  timestamps. No real request reset occurred in those three successful runs,
  so live recovery via the new branch is not yet observed. A quiet 15-minute
  follow-up continues until about 19:30 China time. See the
  [network incident record](../health-assessment-2026-11-04-network.md).

  **17:25 follow-up:** real automatic run `41807342658` encountered
  `ECONNRESET`, recovered on its first isolated-DNS retry and passed all 12
  sources with 153 schedules. The 17:30 run passed without retry; read-only
  state was fresh with unchanged notification timestamps. This is observed
  recovery of one real reset, not proof of permanent upstream repair.

- **2026-11-03 (connection resilience)** — All 19 failed logs in a 100-run window
  were inspected: 18 were North York connection refusals/timeouts, interspersed
  with successful checks; one other run affected several Oncord sources and later
  recovered. Public North York checks returned 104 Computer and 2 Paper records,
  matching read-only state counts. Added bounded retries only for the two
  evidenced connection-establishment errors, retaining visible failure and
  snapshot preservation after exhaustion. The first repaired run still exhausted
  retries. A read-only diagnostic then confirmed inconsistent public DNS answers
  on the same runner; added hostname-scoped DNS fallback for attempts two/three
  with original HTTPS identity checks. All 225 tests, typecheck and a real
  public fallback GET passed;
  see the [incident record](../health-assessment-2026-11-03.md) for deployment and
  actual scheduled verification evidence.

  Final repair `c47f8c3` was verified in automatic runs `41616984159`,
  `41617688592` and `41618392245` at 18:10, 18:15 and 18:20 China time. Each
  passed 225 tests, typecheck and the restricted guard, with North York retaining
  104 Computer + 2 Paper and no repeat notification. The last passed all 12
  sources; Toronto paper had its accepted challenge grace on the first two.
  The fallback client separately returned the same complete inventory from a
  read-only CI probe. Ordinary GETs succeeded in these cycles, so automatic
  scrape recovery via fallback is not yet observed. Final read-only state was
  fresh and notification timestamps unchanged. Temporary diagnostics/probe were
  removed; the actual fallback and genuine failure alerts remain active.

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

- **2026-10-09 (production verification)** — Commit `4660c3b` shipped the Paper
  addition. Normal run `37882682731` delivered all three Paper dates in one
  [Discord message](https://discord.com/channels/1484038585907810535/1485198603604594730/1557968749770842212),
  independently read in the browser. Subsequent runs at 04:16, 04:21, and 04:26
  UTC retained 171 Computer and 3 Paper records without duplicate messages.
  A scoped read-only query at `04:27:06.308Z` confirmed Paper's check time
  advanced to `04:26:33.239Z` while its notification time stayed at
  `04:11:37.288Z`. See the [complete audit](../health-assessment-2026-10-09.md)
  for the source, delivery, and guard evidence.

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
