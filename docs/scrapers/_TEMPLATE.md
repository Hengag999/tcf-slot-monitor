# <City> scraper — health log

> Per-scraper runbook + incident journal. Complements `CLAUDE.md` (architecture)
> and the code comments. Update the **Status** line and append to the
> **Incident log** every time this scraper is assessed or changed.

| | |
|---|---|
| **Platform** | <e.g. Oncord CMS (embedded JSON) / AEC API / Active Communities> |
| **Diff strategy** | <0→N transition · or · per-date> |
| **Page(s)** | <scraped URL(s)> |
| **Discord** | #<channel> (bot "<Bot Name>") |
| **DB key** | city=`<key>`, exam_type=`<...>` |
| **Status** | <✅ healthy / ⚠️ watch / 🔴 broken> — last assessed <YYYY-MM-DD> |

## How it works
- <parse strategy, anchors, what counts as "bookable">
- <empty/steady-state behaviour — what an empty result means>

## Known failure modes / gotchas
- <site-structure assumptions that can break, and the symptom each produces>

## Incident log
- **<YYYY-MM-DD>** — <what was observed> · cause: <root cause> · fix: `<commit>` (or "no action — benign"). <verification notes>

## Debug recipe
```bash
# 1. Dry-run the scraper against the live site (no DB/Discord)
npx tsx scripts/scrapers/<city>.ts

# 2. DB state for this city (checked_at = the key health signal; stale => throwing)
#    needs POSTGRES_URL in .env.local
SELECT city, exam_type, jsonb_array_length(slots) AS n,
       round(EXTRACT(EPOCH FROM (NOW()-checked_at))/60) AS checked_min_ago,
       checked_at, notified_at
FROM slot_monitor_state WHERE city='<key>';

# 3. Cross-city freshness (isolates whether THIS scraper is stale vs whole pipeline down)
SELECT city, round(EXTRACT(EPOCH FROM (NOW()-checked_at))/60) AS checked_min_ago
FROM slot_monitor_state ORDER BY checked_at ASC;

# 4. Past page states (find when structure changed)
curl -s "http://web.archive.org/cdx/search/cdx?url=<host/path>*&output=json&collapse=digest&from=20260101"
```
- **Interpreting silence:** weigh against this city's own cadence AND its diff strategy. A *0→N* city stays quiet while slots remain continuously open (benign); a *per-date* city only stays quiet when no new dates appear. A throw (vs `[]`) freezes the row — look for a stale `checked_at`.
