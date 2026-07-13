# Ashton scraper — health log

| | |
|---|---|
| **Platform** | WordPress/Elementor form (`ashtontesting.ca`) |
| **Diff strategy** | 0→N transition |
| **Page(s)** | `https://ashtontesting.ca/tcf-canada-test/` |
| **Discord** | #ashton (bot "BonTCF Ashton Bot") |
| **DB key** | city=`ashton`, exam_type=`TCF Canada` |
| **Status** | ✅ healthy (fixed) — last assessed 2026-07-13 |

## How it works
- Two observed structures for the exam-date field, tried in order:
  1. **Custom radio picker** — `<div class="tcf-radio-picker">` of `<label>`
     entries (`name="tcf_radio_date"`); disabled inputs / `(FULL)` labels are
     skipped.
  2. **Plain Elementor select** (since ~2026-07) —
     `<select name="form_fields[exma_date]">` whose `<option>`s are the sessions;
     empty/disabled/FULL/sold-out options are skipped.
- A select containing only the empty placeholder option = **no sessions offered**
  → `[]` is the normal steady state, not an error.
- Throws only when *neither* structure is found (genuinely unrecognised page).

## Known failure modes / gotchas
- **Picker block removed when no sessions exist** (FIXED 2026-07-13). The site
  deletes the whole `tcf-radio-picker` div when nothing is offered, leaving an
  empty `exma_date` select plus a leftover script that still references the
  (absent) radios. The old scraper anchored only on the picker and threw every
  run, freezing `checked_at`. Same family as the Oncord "sold-out removes the
  anchor" mode.
- **Select-mode open-detection is unproven.** No page state with actual options
  in the `exma_date` select has been observed yet; the option-parsing branch is
  synthetic-tested only. When Ashton next lists dates, verify the first ping's
  contents against the page.
- The leftover `tcf_radio_date` bridge script means the site may *restore* the
  radio-picker structure when sessions return — both branches are kept for that
  reason.

## Incident log
- **2026-07-13** — DB `checked_at` frozen ~84h (freshest cohort 1.7h); dry-run
  threw `tcf-radio-picker not found`. Cause: site restructured the form — the
  custom radio-picker block is gone; the exam-date field is now an empty
  Elementor `<select name="form_fields[exma_date]">` (no sessions offered).
  Fix: try picker first, else parse the select's options (empty → `[]`), throw
  only when both anchors are missing. Verified: standalone dry-run returns
  "No available slots found." and full `--dry-run` across all 9 cities is clean.
  Found incidentally during a Calgary/Edmonton/Victoria-scoped assessment.

## Debug recipe
```bash
# Dry-run against the live site
npx tsx scripts/scrapers/ashton.ts
#   "No available slots found." => empty picker/select, steady state
#   a THROW => neither anchor found, inspect the page

# DB state (stale checked_at => scraper throwing & being skipped)
SELECT city, exam_type, jsonb_array_length(slots) AS n,
       round(EXTRACT(EPOCH FROM (NOW()-checked_at))/60) AS checked_min_ago,
       checked_at, notified_at
FROM slot_monitor_state WHERE city='ashton';

# Inspect the live form when debugging
#   look for: class="tcf-radio-picker", name="tcf_radio_date",
#   <select name="form_fields[exma_date]"> and whether it has non-empty options
curl -s "http://web.archive.org/cdx/search/cdx?url=ashtontesting.ca/tcf-canada-test*&output=json&collapse=digest&from=20260101"
```
