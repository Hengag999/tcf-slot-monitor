// Ashton scraper
// Ashton Testing Services (ashtontesting.ca) uses a WordPress/Elementor form.
// Session dates are rendered as radio buttons inside a <div class="tcf-radio-picker">.
// Full sessions have a disabled <input type="radio"> and "(FULL)" in the label text.
// Available sessions have name="tcf_radio_date", a value attribute, and are not disabled.

export interface Slot {
  id: string;
  examType: "TCF Canada";
  date: string;       // raw label text, e.g. "May 15th 5.00 pm"
  bookingUrl: string;
}

const TCF_PAGE = "https://ashtontesting.ca/tcf-canada-test/";

export async function scrapeAshton(): Promise<Slot[]> {
  const res = await fetch(TCF_PAGE, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; tcf-slot-monitor/1.0)" },
  });
  if (!res.ok) throw new Error(`Ashton page fetch failed: ${res.status}`);

  const html = await res.text();

  // Extract the tcf-radio-picker block
  const pickerStart = html.indexOf('class="tcf-radio-picker"');
  if (pickerStart === -1) {
    throw new Error("Ashton: tcf-radio-picker not found — structure may have changed");
  }
  const pickerEnd = html.indexOf("</div>", pickerStart);
  const pickerHtml = html.slice(pickerStart, pickerEnd);

  // Match each <label>…</label> block
  const labelPattern = /<label[^>]*>([\s\S]*?)<\/label>/gi;
  const slots: Slot[] = [];
  let match: RegExpExecArray | null;

  while ((match = labelPattern.exec(pickerHtml)) !== null) {
    const inner = match[1];

    // Skip disabled (full) entries
    if (inner.includes("disabled")) continue;

    // Extract the visible text (strip the <input> tag)
    const text = inner.replace(/<[^>]+>/g, "").trim();

    // Skip if still marked FULL somehow
    if (/\(FULL\)/i.test(text)) continue;

    // Extract the value attribute from the radio input
    const valueMatch = inner.match(/value="([^"]+)"/);
    const value = valueMatch ? valueMatch[1] : text;

    slots.push({
      id: `ashton-${Buffer.from(value).toString("base64").slice(0, 12)}`,
      examType: "TCF Canada",
      date: text,
      bookingUrl: TCF_PAGE,
    });
  }

  return slots;
}

// --- Local dry-run ---
if (process.argv[1].endsWith("ashton.ts")) {
  scrapeAshton()
    .then((slots) => {
      if (slots.length === 0) {
        console.log("[ashton] No available slots found.");
      } else {
        console.log(`\n[ashton] ${slots.length} available slot(s):\n`);
        for (const s of slots) {
          console.log(`  [${s.examType}] ${s.date}`);
          console.log(`  ${s.bookingUrl}\n`);
        }
      }
    })
    .catch((err) => {
      console.error("[ashton] Error:", err);
      process.exit(1);
    });
}
