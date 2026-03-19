// Vancouver scraper
// Alliance Française Vancouver uses Oncord CMS with an e-commerce product page.
// The "Date" dropdown is an <oncord-combobox> whose options are embedded as
// <script type="application/json"> inline in the HTML — no separate API call needed.
//
// When no dates are available the array is [].
// When dates open up it becomes e.g. [{"value":"April 15, 2026","label":"April 15, 2026"}, ...]
//
// TODO: confirm exact label format once a live session is observed.

export interface Slot {
  id: string;
  examType: "TCF Canada";
  date: string;       // raw label from Oncord option (e.g. "April 15, 2026")
  bookingUrl: string;
}

const PRODUCT_PAGE = "https://www.alliancefrancaise.ca/products/ciep-tcf-canada-full-exam/";
const COMBOBOX_ID = "combo_Date__Please_choose___Full_if_none_listed_";

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

  // Locate the combobox for the date field and extract its embedded JSON options
  const comboboxStart = html.indexOf(`id="${COMBOBOX_ID}"`);
  if (comboboxStart === -1) {
    throw new Error("Vancouver: date combobox not found in page — structure may have changed");
  }

  // The JSON options are in the first <script type="application/json"> after the combobox
  const scriptOpen = html.indexOf('<script type="application/json">', comboboxStart);
  const scriptClose = html.indexOf("</script>", scriptOpen);
  if (scriptOpen === -1 || scriptClose === -1) {
    throw new Error("Vancouver: JSON options script tag not found — structure may have changed");
  }

  const raw = html.slice(scriptOpen + '<script type="application/json">'.length, scriptClose).trim();
  const options: OncordOption[] = JSON.parse(raw);

  if (options.length === 0) return [];

  return options.map((opt) => ({
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
