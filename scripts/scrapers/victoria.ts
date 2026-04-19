// Victoria scraper
// Alliance Française Victoria uses Oncord CMS with an e-commerce product page.
// The "Date (Please choose):" dropdown is an <oncord-combobox> whose options
// are embedded as <script type="application/json"> inline in the HTML.
//
// When no dates are open the options array is just a placeholder:
//   [{"value":"","label":"Select…"}]
// Available dates appear as entries with a non-empty value (label is the
// user-visible date string). Defensive: also drop any label that contains
// "sold out" / "complet" / "full" in case the site later mirrors Edmonton's
// pattern of leaving sold-out dates in the list.

export interface Slot {
  id: string;
  examType: "TCF Canada";
  date: string;
  bookingUrl: string;
}

const PRODUCT_PAGE =
  "https://www.afvictoria.ca/products/ceip-tcf-canada-full-exam-victoria/";
const FIELD_LABEL = "Date (Please choose)"; // anchor for the date combobox
const UNAVAILABLE_MARKER = /\b(sold\s*out|complet|full)\b/i;

interface OncordOption {
  value: string;
  label: string;
}

export async function scrapeVictoria(): Promise<Slot[]> {
  const res = await fetch(PRODUCT_PAGE, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; tcf-slot-monitor/1.0)" },
  });
  if (!res.ok) throw new Error(`Victoria page fetch failed: ${res.status}`);

  const html = await res.text();

  const labelPos = html.indexOf(FIELD_LABEL);
  if (labelPos === -1) {
    throw new Error(
      `Victoria: "${FIELD_LABEL}" label not found — page structure may have changed`,
    );
  }

  const scriptOpenTag = '<script type="application/json">';
  const scriptOpen = html.indexOf(scriptOpenTag, labelPos);
  const scriptClose = html.indexOf("</script>", scriptOpen);
  if (scriptOpen === -1 || scriptClose === -1) {
    throw new Error(
      "Victoria: JSON options script tag not found after date label — structure may have changed",
    );
  }

  const raw = html
    .slice(scriptOpen + scriptOpenTag.length, scriptClose)
    .trim();

  let options: OncordOption[];
  try {
    options = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Victoria: failed to parse options JSON: ${err}`);
  }

  const available = options.filter(
    (opt) => opt.value !== "" && !UNAVAILABLE_MARKER.test(opt.label),
  );

  return available.map((opt) => ({
    id: `victoria-${Buffer.from(opt.value).toString("base64").slice(0, 16)}`,
    examType: "TCF Canada",
    date: opt.label,
    bookingUrl: PRODUCT_PAGE,
  }));
}

// --- Local dry-run ---
if (process.argv[1].endsWith("victoria.ts")) {
  scrapeVictoria()
    .then((slots) => {
      if (slots.length === 0) {
        console.log("[victoria] No available slots found.");
      } else {
        console.log(`\n[victoria] ${slots.length} available slot(s):\n`);
        for (const s of slots) {
          console.log(`  [${s.examType}] ${s.date}`);
          console.log(`  ${s.bookingUrl}\n`);
        }
      }
    })
    .catch((err) => {
      console.error("[victoria] Error:", err);
      process.exit(1);
    });
}
