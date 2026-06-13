# Calgary scraper — health log

| | |
|---|---|
| **Platform** | Oncord CMS (static HTML; parent month-cards page + per-month destination page) |
| **Diff strategy** | 0→N transition |
| **Page(s)** | parent `https://www.afcalgary.ca/exams/tcf/registration-process/` → destination e.g. `https://www.afcalgary.ca/exams/tcf/tcf-registrations-open/` |
| **Discord** | #calgary (bot "Calgary Bot") |
| **DB key** | city=`calgary`, exam_type=`TCF Canada` |
| **Status** | ✅ healthy (hardened + instrumented) — last assessed 2026-06-13 |

## How it works
- Narrow to the **"Step 2"** section; parse month "session cards"
  (`class="s8-templates-card s8-templates-card__cardsize-5"`), e.g. "August 2026 sessions".
- Skip any card with `SOLD OUT`; from the rest, extract the `Registrations` link.
- **Follow each link** to its destination and require ≥1 `<div class="exam-card">`
  block **without** "SOLD OUT". This per-date verification exists because the
  month-level "Registrations" button stays visible even after every individual
  date inside has filled (the "stuck button").
- Returns only verified-open months; `[]` is the normal steady state.
- **Instrumentation** (added 2026-06-13): logs `[calgary:candidate]` (a month
  whose button is live), `[calgary:dest]` (every destination check, incl. the
  distinct `exam-card` class attributes), and `[calgary:OPEN-MARKUP]` (dumps the
  first non-sold-out card's HTML the moment one ever appears).

## Known failure modes / gotchas
- **Stuck month button** → false positive. The month button persists after all
  dates fill; that's why the destination per-date check is mandatory. Calgary
  deliberately prefers false negatives over weeks of false positives.
- **Modifier class on open cards** → false negative (FIXED). The destination
  split was the literal `<div class="exam-card"`; an open date rendered as
  `class="exam-card available"` would not be isolated and would be silently
  missed. Now splits on `/<div class="(?:[^"]*\s)?exam-card(?:\s[^"]*)?"/i`
  (tolerates modifiers, still won't match wrapper classes like `exam-cards`).
- **Open-detection is unproven by a real opening.** Every observed state
  (live + Wayback 2026-05-11/13/20) has been 100% sold out; no archived OPEN
  snapshot exists. The "absence of SOLD OUT == open" heuristic rests on this
  assumption — hence the `[calgary:OPEN-MARKUP]` logging to capture the next real
  opening. Watch CI logs; a `classes` value other than `["exam-card"]` is the
  modifier-class scenario appearing for real.
- **Sampling gap.** TCF Calgary demand is extreme; sessions can sell out within
  one 5-min cron window, so genuine openings may rarely be caught. Inherent.

## Incident log
- **2026-04-30** (`6bc6c61`) — Calgary emitted a ~30-day false positive on "June
  2026 sessions" while every June date was actually SOLD OUT (the destination
  check only looked for "registration is closed" text). Added the per-date
  exam-card split requiring ≥1 non-sold-out card.
- **2026-06-13** (`7df4d3d`) — Investigated 75-day Discord silence (1 ping ever,
  on 2026-03-30). **Verdict: benign** — `checked_at` fresh, scraper returns `[]`
  because all June/July/Aug dates are genuinely sold out (the Aug month button is
  stuck-visible; destination check correctly suppresses it). Note: the lone
  2026-03-30 ping was *itself* the false positive that `6bc6c61` later fixed, so
  the current code has produced **zero** pings. While here, hardened the split
  against the modifier-class false negative and added open-state logging.
  Verified live (8 cards, 0 open → `[]`) + synthetic (bare-open ✓, modifier-open ✓,
  plural-wrapper → no false positive ✓).

## Debug recipe
```bash
# Dry-run (also prints the [calgary:candidate] / [calgary:dest] diagnostics)
npx tsx scripts/scrapers/calgary.ts

# DB state (checked_at fresh + slots=[] => running fine, just nothing open)
SELECT city, exam_type, jsonb_array_length(slots) AS n,
       round(EXTRACT(EPOCH FROM (NOW()-checked_at))/60) AS checked_min_ago,
       checked_at, notified_at
FROM slot_monitor_state WHERE city='calgary';

# Past page states — confirm sold-out vs open on a given date
curl -s "http://web.archive.org/cdx/search/cdx?url=afcalgary.ca/exams/tcf/tcf-registrations-open*&output=json&collapse=digest&from=20260101"
# raw archived HTML: http://web.archive.org/web/<timestamp>id_/<original-url>
```
- **In CI logs, grep `[calgary:`** — `OPEN-MARKUP` firing = a real opening was
  seen (validate detection); a `[calgary:dest]` `classes` value ≠ `["exam-card"]`
  = modifier-class state in the wild (already handled by the hardened split).
