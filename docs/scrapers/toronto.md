# Toronto scraper — health log

| | |
|---|---|
| **Platform** | **Hybrid** — E-TCF: Active Communities `activities/list` (category 30); P-TCF: Alliance Française CM API (category 368). Availability for both confirmed via the AC detail API. |
| **Diff strategy** | 0 → N transition (default). **Only city with two exam types.** |
| **Page(s)** | E-TCF list: `anc.ca.apm.activecommunities.com/aftoronto/rest/activities/list` (cat 30) · P-TCF list: `cm-api.alliance-francaise.ca/groupcourses` (cat 368) · detail: `…/rest/activity/detail/{id}` |
| **Discord** | #toronto |
| **DB key** | city=`toronto`, exam_type=`E-TCF Canada` **and** `P-TCF Canada` (two rows) |
| **Status** | ✅ hybrid rewrite (E-TCF moved to Active Communities) — last assessed 2026-06-13 |

## How it works
The two exam types live in **different systems**, so the scraper reads each from
its real source, then confirms availability for both against the same detail API
(a session's CM id and its Active Communities activity id are the **same number**).

- **E-TCF (computer, "4 modules")** comes from the **Active Communities**
  `activities/list` API, `activity_category_ids: ["30"]` (POST, paginated via the
  `page_info` header — currently 32 sittings across 2 pages). Each item carries
  inline availability: `urgent_message.status_description` (e.g. `"Full"`) and
  `already_enrolled`/`total_open`. Obviously-full sittings are dropped up front
  (`CLOSED_LIST_STATUS` = `/full|closed|cancel|wait list|sold out/i`); the rest are
  confirmed via detail. The exam **date** comes from the detail's `first_date`
  (`"2026-09-04"`), or is decoded from the activity `number` `TCFC<DDMMYY>-XX`
  (e.g. `TCFC040926-MS` → `2026-09-04`) — the two agree.
- **P-TCF (paper, "4 modules")** comes from the **CM API** category `368` with
  `enddate=gte&openspaces=1&status=0` (P-TCF isn't in Active Communities at all —
  a keyword search returns nothing). Date/time from the first `date_patterns[]`.
- Both feed a single candidate list, confirmed against the **AC detail** API
  (`body.detail.space_status` ∉ `["Full","On Hold","Closed","Cancelled"]`),
  concurrency-capped at 5. A garbled/blocked detail response → treated as *not
  bookable* (false negative) rather than throwing the scrape.

## Known failure modes / gotchas
- **Stale-category blind spot (the original sin, found 2026-06-13).** E-TCF used to
  be read from **CM API category 367**, but AF Toronto migrated the live E-TCF
  product to Active Communities (the CM `367` listings are now an old *"E-TCF – 5
  modules"* product, **all past-dated** — `openspaces` filtered them to zero, so the
  scraper silently saw no E-TCF and never could). The lesson: a 0→N city sitting at
  permanent zero may be watching a **dead source**, not a quiet one — cross-check the
  list against the platform's own category search. Fix: read E-TCF from Active
  Communities category 30 (this rewrite).
- **WAF/bot challenge on datacenter IPs (also 2026-06-13).** Node's `fetch`
  sends **no `User-Agent`**; from a GitHub Actions runner the CM API answers **HTTP
  200 with an HTML interstitial** instead of JSON. `res.ok` is true, so the old
  `!res.ok` guard missed it and `res.json()` threw the opaque `Unexpected token '<',
  "<html><hea"...`. The scrape threw → city skipped → `checked_at` froze. **It works
  fine from a residential IP**, so it can't be reproduced locally — only in CI.
  - Fix: send **browser-like headers** (real UA + `Accept`), and route both APIs
    through a `fetchJson()` helper that **retries** (the challenge is intermittent —
    it succeeded at 23:49 but failed at 01:54 and 06:12 the same night) and throws a
    **legible** error (status + content-type + body snippet) on persistent non-JSON.
  - `fetchAcDetail()` has the same headers and a **safe parse**: a non-JSON detail
    response is logged and treated as *unavailable* (false negative) rather than
    throwing the whole scrape.
- **`enddate=gte` with no value is intentional** — the CM API treats it as
  "end date ≥ today". Dropping `openspaces=1&status=0` returns the raw session set
  incl. past/sold-out ones; the filters are what make the result "currently open".
- **Open-state E-TCF status string is unobserved** — every sitting is `"Full"` right
  now, so the exact `status_description` shown when a seat opens isn't known. The
  pre-filter is built to *keep* anything that isn't a closed-state (empty / "Open" /
  "N spots"), and detail `space_status` is the authoritative confirmation, so an
  unexpected open string still flows through. First real opening logs `[toronto:OPEN]`.
- **0 slots is the normal steady state**, not an error. Both DB rows at `n_slots=0`
  with a *fresh* `checked_at` = healthy and quiet.
- The AC detail API does **not** throw the scrape on a bad response (returns null →
  not bookable), so a flaky detail endpoint under-reports rather than freezing state.

## Incident log
- **2026-06-13 (hybrid rewrite)** — While confirming the WAF fix, found E-TCF had a
  **silent blind spot**: it was read from CM category `367`, but the live E-TCF
  product had migrated to Active Communities (category 30, 32 future sittings). CM
  `367` now only holds an old *"E-TCF – 5 modules"* product, all past-dated → the
  `openspaces` filter zeroed it, so the scraper saw **no E-TCF and never could**
  (likely orphaned ~Jun 10, the last E-TCF ping). **Fix:** rewrote Toronto as a
  hybrid — E-TCF from the AC `activities/list` API (cat 30), P-TCF still from CM 368,
  both confirmed via AC detail. Verified: live dry-run now sees all 32 E-TCF sittings
  (0 bookable — all Full) + 0 P-TCF (all full); 15/15 unit checks on the date decode,
  status pre-filter, and `isBookable`; real detail `first_date` (`2026-09-04`) matches
  the `number` decode.
- **2026-06-13 (WAF fix)** — DB `checked_at` ~7.3h stale (frozen at the 06-12 23:49
  run) while later CI runs (01:54, 06:12) showed `[toronto] Scraper error, skipping:
  SyntaxError: Unexpected token '<', "<html><hea"...` at `fetchSessions`. Root cause:
  CM API served a **WAF/bot-challenge HTML page** (200) to the GitHub Actions IP
  because the request had no `User-Agent`; local runs (JSON) couldn't reproduce it.
  Intermittent, not a hard IP block. **Fix:** browser headers + retrying `fetchJson()`
  with legible non-JSON errors. Verified on a post-push `workflow_dispatch` run
  (27460062153): clean JSON parse, no skip, both rows refreshed.

## Debug recipe
```bash
# Dry-run (prints E-TCF/P-TCF source counts, candidates, then bookable slots)
npx tsx scripts/scrapers/toronto.ts

# E-TCF source of truth — Active Communities category 30 (POST). status_description
# per sitting lives in urgent_message; the page_info header drives pagination.
# (Easier to probe with a throwaway tsx script than curl — see git history.)

# P-TCF source — CM API category 368 (from a datacenter IP this may return WAF HTML):
curl -s 'https://cm-api.alliance-francaise.ca/groupcourses?enddate=gte&limit=150&openspaces=1&orderby=course.startDate&othercategory=368&status=0' | head -c 200

# DB state (two rows — one per exam type)
SELECT city, exam_type, jsonb_array_length(slots) AS n_slots,
       round(EXTRACT(EPOCH FROM (NOW()-checked_at))/60) AS checked_min_ago, checked_at
FROM slot_monitor_state WHERE city='toronto' ORDER BY exam_type;

# Did Toronto throw in CI? (the run "succeeds" even when a city is skipped)
gh run view <run-id> --log | grep -i toronto
```
- If a real E-TCF opening is ever missed, check the `[toronto:etcf-candidate]` /
  `[toronto:OPEN]` logs — they record the status string the platform shows when a
  seat frees up, which is currently unobserved.
