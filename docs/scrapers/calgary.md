# Calgary scraper — health log

| | |
|---|---|
| **Platform** | Oncord CMS (static HTML; parent month-cards page + per-month destination page) |
| **Diff strategy** | 0→N transition |
| **Page(s)** | parent `https://www.afcalgary.ca/exams/tcf/registration-process/` → current destination `https://www.afcalgary.ca/exams/tcf/tcf-registrations-open-1607/` (follow the parent link; slugs change) |
| **Discord** | #calgary (bot "Calgary Bot") |
| **DB key** | city=`calgary`, exam_type=`TCF Canada` |
| **Status** | Current public TCF dates sold out; error handling hardened locally — assessed 2026-10-06; open-state markup still unverified |

## How it works
- Narrow to **Step 2** and extract balanced month card divs with the
  `s8-templates-card__cardsize-5` class token. Require at least one recognizable
  `Month YYYY sessions` label. Information cards are ignored.
- Skip months explicitly marked `SOLD OUT`; other dated month cards must have a
  `Registrations` link, which the scraper follows. A stale month button alone
  is not an availability signal.
- The destination must either explicitly say registration is closed, or contain
  individual `exam-card` divs. Each card must be sold out or have a nonempty,
  enabled HTTP(S) anchor inside its `exam-registration` block. At least one
  such link is required to return the candidate month.
- HTTP/network errors, missing card shapes, incomplete markup and ambiguous
  individual cards **throw**, preserving the previous city state. They are not
  converted into a successful empty result. Both fetches have a 20-second timeout.
- Logs `[calgary:candidate]`, `[calgary:dest]` (card/open counts), and bounded
  `[calgary:OPEN-MARKUP]` for a positive card.

## Known failure modes / gotchas
- **Stale month button.** The month link can remain while every individual date
  is sold out. Always follow it; do not notify from the parent button alone.
- **Unrecognized destination.** Previously, a 200 response with zero exam cards
  returned open. It now throws. Failed requests also throw instead of returning
  closed; neither case should clear valid persisted state.
- **Open-state markup is still unverified.** No live open TCF example was found
  on 2026-10-06. The positive link rule reflects the site's published guidance,
  but its exact open markup has only synthetic coverage. If the live opening
  uses a different control, the scraper will raise an error for review. Even a
  visible registration button can temporarily lag a sellout, according to the
  site; this is not a seat reservation or checkout guarantee.
- **Sampling gap.** Assess actual GitHub run timestamps. The five-minute cron is
  not a five-minute execution guarantee, and short openings can be missed.

## Incident log
- **2026-10-08** — Failure emails from runs `37796571835`,
  `37797314632`, and `37797948246` exposed real December registration buttons
  outside the empty `exam-registration` div. Public HTML showed Oncord
  `s8-templates-button-linkOverlay` anchors, labelled `Register now!`, inside
  their individual exam cards and pointing to same-origin `/event-rsvp/tcf-canada-*`
  pages. Added a narrow fallback for this observed control, retaining sold-out
  precedence and rejection of unknown, disabled, unrelated, or cross-origin links.
  The standalone dry-run detected December availability (six cards, one still
  open at verification; earlier HTML had three). All 111 offline tests and
  typecheck passed. This verifies advertised availability, not checkout completion.
  Shipment and scheduled-run evidence are recorded separately below.
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
- **2026-07-13** — Re-assessed after 105-day Discord silence (user suspected
  breakage). **Verdict: benign, no action.** `checked_at` fresh (same cohort as
  healthy cities); dry-run finds one candidate month ("September 2026 sessions"),
  destination has 5 exam-cards and independent fetch confirms every card's visible
  text reads **SOLD OUT** (`open=0` is correct). The main page advertises no other
  month. Open-detection still unproven by a real opening — keep watching for
  `[calgary:OPEN-MARKUP]` in CI logs. The sampling-gap caveat stands: GitHub
  throttles the */5 cron to ~1.5–4h, so fast sell-outs can be missed entirely.

- **2026-10-06** — Public source reconnaissance found September and October
  sold out on the [parent page](https://www.afcalgary.ca/exams/tcf/registration-process/).
  November's link was still visible, but its
  [destination](https://www.afcalgary.ca/exams/tcf/tcf-registrations-open-1607/)
  contained 11 individual TCF dates, all explicitly sold out. The page explains
  that a missing booking button also means no seat and warns about brief button
  lag after sellout. The related
  [TEF destination](https://www.afcalgary.ca/exams/tef/tef-registrations-open-1607/)
  used the same layout, with all five dates sold out; it supplied no open sample.
  Fixed the zero-card false-positive fallback, preserved state on failed requests,
  added bounded fetches and isolated card parsing, and required a positive
  registration link. Local standalone dry-run: 11 cards, zero open, exit 0.
  Eight offline tests cover closed/unknown/open-policy cases, card boundaries,
  and propagation of HTTP/network/shape failures. No database writes or Discord
  sends were used; this entry does not establish CI deployment or delivery.

## Debug recipe
```bash
# Dry-run (also prints the [calgary:candidate] / [calgary:dest] diagnostics)
npx tsx scripts/scrapers/calgary.ts

# DB state (fresh checked_at proves an upsert, not source accuracy or delivery)
SELECT city, exam_type, jsonb_array_length(slots) AS n,
       round(EXTRACT(EPOCH FROM (NOW()-checked_at))/60) AS checked_min_ago,
       checked_at, notified_at
FROM slot_monitor_state WHERE city='calgary';

# Past page states — confirm sold-out vs open on a given date
curl -s "http://web.archive.org/cdx/search/cdx?url=afcalgary.ca/exams/tcf/tcf-registrations-open*&output=json&collapse=digest&from=20260101"
# raw archived HTML: http://web.archive.org/web/<timestamp>id_/<original-url>
```
- **In CI logs, search `[calgary:`**. `OPEN-MARKUP` means the positive-link
  rule matched; inspect it to validate the first real opening. A changed or
  ambiguous shape should be visible as an error, never interpreted as open.

```bash
node --import tsx --test tests/calgary.test.ts
```


## Shipment verification — 2026-10-06 21:18 China time

The repairs are deployed on `master`. [GitHub run 37469738669](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/37469738669) passed all source checks and refreshed stored state. See `docs/health-assessment-2026-10-06.md` for the first-run Discord timeout, verified message reconciliation, and final production evidence. Earlier local-only/pending-deployment statements above describe the pre-shipment assessment.
