// Victoria scraper
// Alliance Française Victoria uses Oncord CMS with an e-commerce product page.
// When dates are open, a "Date (Please choose):" dropdown is rendered as
// <oncord-combobox> with options embedded in a <script type="application/json">
// tag (label = the user-visible date string).
//
// When the product is sold out, Oncord removes the combobox entirely and shows
// "This product isn't available at the moment" — so the previous "find label
// then parse JSON" approach was throwing on every run, leaving Victoria with
// no row in the state table at all (never triggered).
//
// New strategy (mirrors Vancouver):
//   1. If the page contains the explicit "isn't available at the moment"
//      marker, return [] (no slots, no error). This is the steady state when
//      no exam dates are open.
//   2. Otherwise, anchor on the "Date (Please choose)" label substring and
//      parse the next <script type="application/json"> options array.
//   3. Drop the empty-value placeholder and any label that matches a
//      "sold out / complet / full" pattern (defensive — in case Victoria
//      starts mirroring Edmonton's habit of leaving sold-out dates listed
//      with a "(Sold out)" annotation).
//   4. Only throw if neither marker nor combobox label is found — structure
//      changed in a way we don't recognize.

export interface Slot {
  id: string;
  examType: "TCF Canada";
  date: string;
  bookingUrl: string;
}

const PRODUCT_PAGE =
  "https://www.afvictoria.ca/products/ceip-tcf-canada-full-exam-victoria/";
const FIELD_LABEL = "Date (Please choose)";
const SOLD_OUT_MARKER = /isn'?t available at the moment/i;
const UNAVAILABLE_LABEL = /\b(sold\s*out|complet|full)\b/i;

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

  if (SOLD_OUT_MARKER.test(html)) return [];

  const labelPos = html.indexOf(FIELD_LABEL);
  if (labelPos === -1) {
    throw new Error(
      `Victoria: neither sold-out marker nor "${FIELD_LABEL}" label found — page structure may have changed`,
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
    (opt) => opt.value !== "" && !UNAVAILABLE_LABEL.test(opt.label),
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
