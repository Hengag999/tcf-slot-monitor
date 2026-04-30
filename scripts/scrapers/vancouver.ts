// Vancouver scraper
// Alliance Française Vancouver uses Oncord CMS with an e-commerce product page.
// When dates are open, a "Date (Please choose) - Full if none listed" combobox
// is rendered as <oncord-combobox> with options embedded in a
// <script type="application/json"> tag (e.g. {"value":"...","label":"Mercredi 01 Avril 2026"}).
//
// When the product is sold out, Oncord removes the combobox entirely and
// renders "This product can't be ordered online" instead — so the previous
// "find combobox by ID" approach was throwing for the past 9 days, freezing
// state at the last successful scrape (30 stale slots).
//
// New strategy:
//   1. If the page contains the explicit "can't be ordered online" marker,
//      return [] (no slots, no error).
//   2. Otherwise, anchor on the "Date (Please choose)" label substring and
//      parse the next <script type="application/json"> options array. This is
//      the same pattern Victoria/Edmonton use and is more durable than
//      hard-coded combobox IDs (which Oncord derives from the field label and
//      may rotate if the label changes).
//   3. Only throw if neither marker nor combobox is found — that means the
//      page structure changed in a way we don't recognize and we want to be
//      loud about it.

export interface Slot {
  id: string;
  examType: "TCF Canada";
  date: string;       // raw label from Oncord option (e.g. "Mercredi 01 Avril 2026")
  bookingUrl: string;
}

const PRODUCT_PAGE = "https://www.alliancefrancaise.ca/products/ciep-tcf-canada-full-exam/";
const FIELD_LABEL = "Date (Please choose)";
const SOLD_OUT_MARKER = /can'?t be ordered online/i;
const UNAVAILABLE_LABEL = /\b(sold\s*out|complet|full)\b/i;

interface OncordOption {
  value: string;
  label: string;
}

export async function scrapeVancouver(): Promise<Slot[]> {
  const res = await fetch(PRODUCT_PAGE, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; tcf-slot-monitor/1.0)" },
  });
  if (!res.ok) throw new Error(`Vancouver page fetch failed: ${res.status}`);

  const html = await res.text();

  if (SOLD_OUT_MARKER.test(html)) return [];

  const labelPos = html.indexOf(FIELD_LABEL);
  if (labelPos === -1) {
    throw new Error(
      `Vancouver: neither sold-out marker nor "${FIELD_LABEL}" label found — page structure may have changed`,
    );
  }

  const scriptOpenTag = '<script type="application/json">';
  const scriptOpen = html.indexOf(scriptOpenTag, labelPos);
  const scriptClose = html.indexOf("</script>", scriptOpen);
  if (scriptOpen === -1 || scriptClose === -1) {
    throw new Error(
      "Vancouver: JSON options script tag not found after date label — structure may have changed",
    );
  }

  const raw = html.slice(scriptOpen + scriptOpenTag.length, scriptClose).trim();

  let options: OncordOption[];
  try {
    options = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Vancouver: failed to parse options JSON: ${err}`);
  }

  const available = options.filter(
    (opt) => opt.value !== "" && !UNAVAILABLE_LABEL.test(opt.label),
  );

  return available.map((opt) => ({
    id: `vancouver-${Buffer.from(opt.value).toString("base64").slice(0, 12)}`,
    examType: "TCF Canada",
    date: opt.label,
    bookingUrl: PRODUCT_PAGE,
  }));
}

// --- Local dry-run ---
if (process.argv[1].endsWith("vancouver.ts")) {
  scrapeVancouver()
    .then((slots) => {
      if (slots.length === 0) {
        console.log("[vancouver] No available slots found.");
      } else {
        console.log(`\n[vancouver] ${slots.length} available slot(s):\n`);
        for (const s of slots) {
          console.log(`  [${s.examType}] ${s.date}`);
          console.log(`  ${s.bookingUrl}\n`);
        }
      }
    })
    .catch((err) => {
      console.error("[vancouver] Error:", err);
      process.exit(1);
    });
}
