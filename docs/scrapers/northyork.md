# North York scraper — health log

| | |
|---|---|
| **Platform** | GB Language Centre API (`api.gblc.ca`) |
| **Diff strategy** | **Per-date diff** (`diffByDate: true`) — notify on any date not seen before |
| **Page(s)** | API: `api.gblc.ca/candidates/test-schedules/?test_id=6&format_id=5&has_available_seats=true` · booking: `gblc.ca/en/book-now/choose-date` |
| **Discord** | #northyork |
| **DB key** | city=`northyork`, exam_type=`TCF Canada - Computer` |
| **Status** | ✅ healthy — last assessed 2026-06-13 (benign silence, see incident log) |

## How it works
- `scrapeNorthYork()` GETs the GBLC test-schedules endpoint filtered to
  `test_id=6` (TCF Canada), `format_id=5` (Computer), `has_available_seats=true`.
  The response is a **bare JSON array** of schedule objects.
- Each schedule → one slot: `date` from `start_at_date`, times from
  `group_time_start/end`, `availableSeats = seats - taken_seats`, `examType` =
  `"${tests.title} - ${formats.title}"` (= `"TCF Canada - Computer"`). Booking URL
  is the static choose-date page.
- **Per-date diff** (orchestrator): notify about any `date` not in the previously
  stored set, then persist the full current set. So a ping means "a date appeared
  that we hadn't seen", and silence means "no new dates" — which is the **normal,
  benign steady state** for this strategy.

## Known failure modes / gotchas
- **Silence is usually benign — GBLC releases dates in batches, not continuously.**
  The stored date set shows clear gaps (e.g. nothing Aug 1–18; monthly clusters),
  so the near-daily ping cadence is really GBLC *dripping new far-future dates*;
  when the drip pauses, the per-date diff correctly goes quiet. **Don't mistake a
  batch-release pause for a broken scraper** — confirm against `checked_at`
  freshness + the live API horizon before concluding anything's wrong.
- **Response is a bare array, not paginated.** `scrapeNorthYork` does
  `data.map(...)` directly. If GBLC ever switches to a paginated envelope
  (`{results: [...], count, next}`), `.map` would throw — guard for it then.
- **Scope is deliberately `test_id=6` & `format_id=5` only** (TCF Canada, Computer).
  The unfiltered "any category" query returns ~245 schedules across other
  test/format combos (with a slightly longer horizon) that this scraper does not
  watch — a possible coverage enhancement, not a bug.
- **`has_available_seats=true` currently equals unfiltered** for this test/format
  (every listed schedule has seats), so no full-but-existing dates are hidden.

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

## Debug recipe
```bash
# Dry-run (prints schedule count + every available slot)
npx tsx scripts/scrapers/northyork.ts

# Live API — what the scraper sees (bare array). Compare max date to the DB.
curl -s 'https://api.gblc.ca/candidates/test-schedules/?test_id=6&format_id=5&has_available_seats=true' | head -c 300

# DB state: freshness + last ping + stored dates (silence is benign if dates unchanged)
SELECT exam_type, jsonb_array_length(slots) AS n,
       round(EXTRACT(EPOCH FROM (NOW()-checked_at))/60)  AS checked_min_ago,
       round(EXTRACT(EPOCH FROM (NOW()-notified_at))/60) AS notified_min_ago
FROM slot_monitor_state WHERE city='northyork';
```
- Diagnosis rule: if `checked_at` is fresh and the live API's **max date == stored
  max date**, the silence is just "no new batch yet" — healthy. Only suspect the
  scraper if `checked_at` is stale (it's throwing) or the live max date exceeds the
  stored set (new dates appearing but not detected).
