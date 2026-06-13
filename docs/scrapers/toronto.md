# Toronto scraper — health log

| | |
|---|---|
| **Platform** | Alliance Française CM API + Active Communities API |
| **Diff strategy** | 0 → N transition (default). **Only city with two exam types.** |
| **Page(s)** | CM list: `cm-api.alliance-francaise.ca/groupcourses` · detail: `anc.ca.apm.activecommunities.com/aftoronto/rest/activity/detail/{id}` |
| **Discord** | #toronto |
| **DB key** | city=`toronto`, exam_type=`E-TCF Canada` **and** `P-TCF Canada` (two rows) |
| **Status** | ✅ hardened against WAF bot-challenge — last assessed 2026-06-13 |

## How it works
- `scrapeToronto()` makes **two CM list calls** — category `367` (E-TCF, computer)
  and `368` (P-TCF, paper) — with `enddate=gte&openspaces=1&status=0` (future,
  has-spaces, published). Each returns `{ items: [...] }`.
- For each session it then **confirms availability** against the Active Communities
  detail API, reading `body.detail.space_status`. Anything in `["Full","On Hold"]`
  is dropped; everything else is treated as bookable (concurrency-capped at 5).
- A session's date/time comes from its first `date_patterns[]` entry (fallback to
  `start_date`). `bookingUrl` points at the Active Communities activity detail page.

## Known failure modes / gotchas
- **WAF/bot challenge on datacenter IPs (the 2026-06-13 incident).** Node's `fetch`
  sends **no `User-Agent`**; from a GitHub Actions runner the CM API answers **HTTP
  200 with an HTML interstitial** instead of JSON. `res.ok` is true, so the old
  `!res.ok` guard missed it and `res.json()` threw the opaque `Unexpected token '<',
  "<html><hea"...`. The scrape threw → city skipped → `checked_at` froze. **It works
  fine from a residential IP**, so it can't be reproduced locally — only in CI.
  - Fix: send **browser-like headers** (real UA + `Accept`), and route both APIs
    through a `fetchJson()` helper that **retries** (the challenge is intermittent —
    it succeeded at 23:49 but failed at 01:54 and 06:12 the same night) and throws a
    **legible** error (status + content-type + body snippet) on persistent non-JSON.
  - `isAvailable()` got the same headers and a **safe parse**: a non-JSON detail
    response is logged and treated as *unavailable* (false negative) rather than
    throwing the whole scrape.
- **`enddate=gte` with no value is intentional** — the CM API treats it as
  "end date ≥ today". Dropping `openspaces=1&status=0` returns ~150/37 raw sessions
  incl. past/sold-out ones; the filters are what make the result "currently open".
- **0 sessions is the normal steady state**, not an error. Both DB rows sitting at
  `n_slots=0` with a *fresh* `checked_at` = healthy and quiet.
- The Active detail API does **not** throw the scrape on a bad response (returns
  false), so a flaky detail endpoint under-reports rather than freezing state.

## Incident log
- **2026-06-13** — DB `checked_at` ~7.3h stale (frozen at the 2026-06-12 23:49 run)
  while later CI runs (01:54, 06:12) showed `[toronto] Scraper error, skipping:
  SyntaxError: Unexpected token '<', "<html><hea"... is not valid JSON` at
  `fetchSessions`. Root cause: CM API served a **WAF/bot-challenge HTML page** (200)
  to the GitHub Actions IP because the request had no `User-Agent`; local runs (JSON)
  couldn't reproduce it. Intermittent, so not a hard IP block. **Fix:** browser
  headers + retrying `fetchJson()` helper with legible non-JSON errors; hardened
  `isAvailable()`. Verified locally (still 0, no regression); the real bypass must be
  confirmed on a GitHub runner via `workflow_dispatch` after push.

## Debug recipe
```bash
# Dry-run (prints session counts per category, then bookable slots)
npx tsx scripts/scrapers/toronto.ts

# Raw CM API — what CI sees. From a datacenter IP this may return HTML, not JSON:
curl -s 'https://cm-api.alliance-francaise.ca/groupcourses?enddate=gte&limit=150&openspaces=1&orderby=course.startDate&othercategory=367&status=0' | head -c 200

# DB state (two rows — one per exam type)
SELECT city, exam_type, jsonb_array_length(slots) AS n_slots,
       round(EXTRACT(EPOCH FROM (NOW()-checked_at))/60) AS checked_min_ago, checked_at
FROM slot_monitor_state WHERE city='toronto' ORDER BY exam_type;

# Did Toronto throw in CI? (the run "succeeds" even when a city is skipped)
gh run view <run-id> --log | grep -i toronto
```
- If the CM API still returns HTML from CI after the header fix, the challenge is
  IP-based (Cloudflare JS), not UA-based — would then need a proxy or a different
  fetch path. Watch the next `workflow_dispatch` log for `[toronto] ... non-JSON`.
