// Ashton scraper
// Ashton Testing Services (ashtontesting.ca) uses a WordPress/Elementor form.
// Two structures have been observed for the exam-date field:
//  1. Custom radio picker: a <div class="tcf-radio-picker"> of <label> radio
//     entries (name="tcf_radio_date"); full sessions are disabled / "(FULL)".
//  2. Plain Elementor select (since ~2026-07): <select name="form_fields[exma_date]">
//     whose <option>s are the sessions. When no sessions are offered the select
//     holds a single empty option — that's the sold-out steady state, not an error.

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

  // Structure 1: custom tcf-radio-picker block
  const pickerStart = html.indexOf('class="tcf-radio-picker"');
  if (pickerStart !== -1) {
    const pickerEnd = html.indexOf("</div>", pickerStart);
    return parseRadioPicker(html.slice(pickerStart, pickerEnd));
  }

  // Structure 2: plain Elementor select for the exam date
  const selectMatch = html.match(
    /<select[^>]+name="form_fields\[exma_date\]"[^>]*>([\s\S]*?)<\/select>/i
  );
  if (selectMatch) {
    return parseDateSelect(selectMatch[1]);
  }

  throw new Error(
    "Ashton: neither tcf-radio-picker nor exma_date select found — structure may have changed"
  );
}

function makeSlot(value: string, text: string): Slot {
  return {
    id: `ashton-${Buffer.from(value).toString("base64").slice(0, 12)}`,
    examType: "TCF Canada",
    date: text,
    bookingUrl: TCF_PAGE,
  };
}

function parseRadioPicker(pickerHtml: string): Slot[] {
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

    slots.push(makeSlot(value, text));
  }

  return slots;
}

function parseDateSelect(optionsHtml: string): Slot[] {
  const optionPattern = /<option([^>]*)>([\s\S]*?)<\/option>/gi;
  const slots: Slot[] = [];
  let match: RegExpExecArray | null;

  while ((match = optionPattern.exec(optionsHtml)) !== null) {
    const attrs = match[1];
    const text = match[2].replace(/<[^>]+>/g, "").trim();

    // The empty placeholder option is the no-sessions steady state
    if (!text) continue;
    if (/disabled/i.test(attrs)) continue;
    if (/\(FULL\)|sold\s*out|complet/i.test(text)) continue;

    const valueMatch = attrs.match(/value="([^"]*)"/);
    const value = valueMatch?.[1] || text;
    if (!value) continue;

    slots.push(makeSlot(value, text));
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
