// Edmonton scraper
// Alliance Française Edmonton uses Oncord CMS with an e-commerce product page.
// The "choose your session :" dropdown is an <oncord-combobox> whose options
// are embedded as <script type="application/json"> inline in the HTML.
//
// Unlike Victoria/Vancouver, Edmonton leaves sold-out sessions in the option
// list and appends "(Sold out)" to the label, e.g.:
//   {"value":"TCF 9 avril","label":"TCF 9 avril (Sold out)"}
// An available session will NOT have a "(sold out)" annotation in its label.
// Keep the filter as "label does NOT match /sold out/i AND value is non-empty"
// so we accept both plain labels and any future price-annotated labels.

export interface Slot {
  id: string;
  examType: "TCF Canada";
  date: string;
  bookingUrl: string;
}

const PRODUCT_PAGE = "https://www.afedmonton.com/products/af-tcf-canada/";
const FIELD_LABEL = "choose your session"; // matched case-insensitively
const UNAVAILABLE_MARKER = /\b(sold\s*out|complet|full)\b/i;

interface OncordOption {
  value: string;
  label: string;
}

export async function scrapeEdmonton(): Promise<Slot[]> {
  const res = await fetch(PRODUCT_PAGE, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; tcf-slot-monitor/1.0)" },
  });
  if (!res.ok) throw new Error(`Edmonton page fetch failed: ${res.status}`);

  const html = await res.text();

  const labelPos = html.toLowerCase().indexOf(FIELD_LABEL.toLowerCase());
  if (labelPos === -1) {
    throw new Error(
      `Edmonton: "${FIELD_LABEL}" label not found — page structure may have changed`,
    );
  }

  const scriptOpenTag = '<script type="application/json">';
  const scriptOpen = html.indexOf(scriptOpenTag, labelPos);
  const scriptClose = html.indexOf("</script>", scriptOpen);
  if (scriptOpen === -1 || scriptClose === -1) {
    throw new Error(
      "Edmonton: JSON options script tag not found after session label — structure may have changed",
    );
  }

  const raw = html
    .slice(scriptOpen + scriptOpenTag.length, scriptClose)
    .trim();

  let options: OncordOption[];
  try {
    options = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Edmonton: failed to parse options JSON: ${err}`);
  }

  console.log(
    `[edmonton] parsed ${options.length} session option(s) from page`,
  );

  const available = options.filter(
    (opt) => opt.value !== "" && !UNAVAILABLE_MARKER.test(opt.label),
  );

  return available.map((opt) => ({
    id: `edmonton-${Buffer.from(opt.value).toString("base64").slice(0, 16)}`,
    examType: "TCF Canada",
    date: opt.label,
    bookingUrl: PRODUCT_PAGE,
  }));
}

// --- Local dry-run ---
if (process.argv[1].endsWith("edmonton.ts")) {
  scrapeEdmonton()
    .then((slots) => {
      if (slots.length === 0) {
        console.log("[edmonton] No available slots found.");
      } else {
        console.log(`\n[edmonton] ${slots.length} available slot(s):\n`);
        for (const s of slots) {
          console.log(`  [${s.examType}] ${s.date}`);
          console.log(`  ${s.bookingUrl}\n`);
        }
      }
    })
    .catch((err) => {
      console.error("[edmonton] Error:", err);
      process.exit(1);
    });
}
