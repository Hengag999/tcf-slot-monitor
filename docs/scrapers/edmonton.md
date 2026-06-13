# Edmonton scraper — health log

| | |
|---|---|
| **Platform** | Oncord CMS (embedded JSON) |
| **Diff strategy** | per-date |
| **Page(s)** | `https://www.afedmonton.com/products/af-tcf-canada/` |
| **Discord** | #edmonton (bot "BonTCF Edmonton Bot") |
| **DB key** | city=`edmonton`, exam_type=`TCF Canada` |
| **Status** | ✅ healthy (fixed) — last assessed 2026-06-13 |

## How it works
- Anchor on the **"choose your session"** label, then parse the next
  `<script type="application/json">` options array (Oncord `<oncord-combobox>`).
- Keep an option when `value != ""` **AND** label !~ `/sold out|complet|full/i`.
  Edmonton leaves sold-out *dates* in the list with a `(Sold out)` suffix, so the
  label filter — not the option's presence — decides availability.
- **Full product sold-out** (every date gone): Oncord removes the combobox + label
  entirely and shows a `<strong>SOLD OUT!</strong>` badge in the order controls.
  Detect that badge → return `[]`; throw only if **neither** label nor badge is
  found (genuinely unrecognised structure).
- `[]` is the normal steady state.

## Known failure modes / gotchas
- **Full sold-out removes the combobox** → the label anchor throws every run
  (FIXED `4c5cbd7`). This is the Oncord-unavailable mode that also bit
  Vancouver/Victoria — Edmonton was just never given the same handling.
- **"sold out" is ambiguous on this page.** It appears (a) in available-state
  option labels (`(Sold out)`) and (b) "complet" matches "**complet**e your
  registration" in the sold-out body. So the page-level marker is matched as the
  specific `<strong>SOLD OUT!</strong>` badge (`/<strong>\s*sold\s*out/i`), and
  only in the no-label branch — never short-circuiting the available parse.
- Per-date diff means silence genuinely = "no new dates" (usually benign/seasonal).

## Incident log
- **2026-06-13** (`4c5cbd7`) — DB `checked_at` was frozen at 2026-05-29 (~14 days)
  while every other city updated; dry-run threw `"choose your session" label not
  found`. Cause: the whole product had sold out, so Oncord dropped the combobox
  and showed the `SOLD OUT!` badge. Fix: detect the badge → return `[]`; throw
  only when neither label nor badge present. Verified end-to-end with a mocked
  fetch: available → parses open dates, fully sold-out → `[]`, unknown → throws.

## Debug recipe
```bash
# Dry-run against the live site
npx tsx scripts/scrapers/edmonton.ts
#   "product sold out (session combobox removed) — 0 available" => sold-out branch OK
#   a THROW about the label/badge => genuinely new structure, inspect the page

# DB state (stale checked_at => scraper throwing & being skipped)
SELECT city, exam_type, jsonb_array_length(slots) AS n,
       round(EXTRACT(EPOCH FROM (NOW()-checked_at))/60) AS checked_min_ago,
       checked_at, notified_at
FROM slot_monitor_state WHERE city='edmonton';

# Inspect the live page structure when debugging a throw
#   look for: "choose your session" label, <script type="application/json"> count,
#   oncord-combobox count, and <strong>SOLD OUT!</strong> badge
curl -s "http://web.archive.org/cdx/search/cdx?url=afedmonton.com/products/af-tcf-canada*&output=json&from=20260101"
```
- When debugging, remember the two healthy shapes: **available** = label +
  `<script type="application/json">` options; **sold-out** = no label, no combobox,
  `<strong>SOLD OUT!</strong>` badge. Anything else → throw is correct (it surfaces
  a real structure change via a stale `checked_at`).
