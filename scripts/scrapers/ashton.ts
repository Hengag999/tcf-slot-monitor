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

interface HtmlElement { tag: string; attrs: string; start: number; contentStart: number; contentEnd: number; end: number }
function attribute(attrs: string, name: string): string | undefined {
  const attributes = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  for (const match of attrs.matchAll(attributes)) {
    if (match[1].toLowerCase() === name) return match[2] ?? match[3] ?? match[4] ?? "";
  }
  return undefined;
}
function classes(attrs: string): string[] { return (attribute(attrs, "class") ?? "").split(/\s+/); }
function hidden(attrs: string): boolean {
  const tokens = classes(attrs);
  return attribute(attrs, "hidden") !== undefined
    || ["desktop", "tablet", "mobile"].every(viewport => tokens.includes(`elementor-hidden-${viewport}`))
    || /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:!important\s*)?(?:;|$)/i.test(attribute(attrs, "style") ?? "");
}
function elements(html: string): HtmlElement[] {
  const result: HtmlElement[] = [];
  const stack: Omit<HtmlElement, "contentEnd" | "end">[] = [];
  const tags = /<(\/?)([a-z][\w:-]*)\b((?:[^"'<>]|"[^"]*"|'[^']*')*)>/gi;
  const voidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
  for (const token of html.matchAll(tags)) {
    const tag = token[2].toLowerCase();
    if (token[1]) {
      const index = stack.map(item => item.tag).lastIndexOf(tag);
      if (index !== -1) {
        const item = stack[index];
        result.push({ ...item, contentEnd: token.index!, end: token.index! + token[0].length });
        stack.splice(index);
      }
    } else {
      const item = { tag, attrs: token[3], start: token.index!, contentStart: token.index! + token[0].length };
      if (voidTags.has(tag) || /\/\s*$/.test(token[3])) result.push({ ...item, contentEnd: item.contentStart, end: item.contentStart });
      else stack.push(item);
    }
  }
  // Never process an unterminated hidden/control wrapper as visible availability.
  if (stack.some(item => hidden(item.attrs) || classes(item.attrs).includes("tcf-radio-picker") || attribute(item.attrs, "name") === "form_fields[exma_date]")) {
    throw new Error("Ashton: unclosed date or hidden container");
  }
  return result.sort((a, b) => a.start - b.start);
}

export function parseAshton(html: string): Slot[] {
  const clean = html.replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  const all = elements(clean);
  const hiddenRanges = all.filter(item => hidden(item.attrs));
  let visible = "";
  let offset = 0;
  for (const range of hiddenRanges) {
    if (range.start < offset) continue;
    visible += clean.slice(offset, range.start);
    offset = range.end;
  }
  visible += clean.slice(offset);
  const visibleElements = elements(visible);
  const picker = visibleElements.find(item => item.tag === "div" && classes(item.attrs).includes("tcf-radio-picker"));
  if (picker) {
    const content = visible.slice(picker.contentStart, picker.contentEnd);
    if (!/<label\b/i.test(content)) throw new Error("Ashton: unrecognized visible date picker");
    return parseRadioPicker(content);
  }
  const select = visibleElements.find(item => item.tag === "select" && attribute(item.attrs, "name") === "form_fields[exma_date]");
  if (select) return parseDateSelect(visible.slice(select.contentStart, select.contentEnd));

  // Observed October 9 closed state: the form and stale FULL picker are hidden
  // on all viewports, an empty date field remains, and a visible release notice
  // explains why there is no registration interface. Hidden dates alone never
  // establish availability or a valid empty snapshot.
  const hasEmptyHiddenSelect = all.some(item => item.tag === "select"
    && attribute(item.attrs, "name") === "form_fields[exma_date]"
    && hiddenRanges.some(range => range.start <= item.start && range.end >= item.end)
    && /^\s*<option\b[^>]*>\s*<\/option>\s*$/i.test(clean.slice(item.contentStart, item.contentEnd)));
  const visibleText = visible.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  if (hasEmptyHiddenSelect && /TCF Canada Exam Registration/i.test(visibleText)
    && /ADDITIONAL EXAM DATES FOR [A-Z ]+ WILL BE RELEASED BY [A-Z-]+/i.test(visibleText)) return [];
  throw new Error("Ashton: no recognized visible date control or verified closed state — structure may have changed");
}

export async function scrapeAshton(options: { fetchImpl?: typeof fetch } = {}): Promise<Slot[]> {
  const res = await (options.fetchImpl ?? fetch)(TCF_PAGE, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; tcf-slot-monitor/1.0)" },
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
  });
  if (!res.ok) throw new Error(`Ashton page fetch failed: ${res.status}`);
  return parseAshton(await res.text());
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

    if (!/<input\b[^>]*\btype=["']radio["']/i.test(inner)) {
      throw new Error("Ashton: unrecognized date picker label");
    }

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
  let recognized = 0;

  while ((match = optionPattern.exec(optionsHtml)) !== null) {
    recognized++;
    const attrs = match[1];
    const text = match[2].replace(/<[^>]+>/g, "").trim();

    // The empty placeholder option is the no-sessions steady state
    if (!text || /^(?:--|select(?: an?)? (?:exam )?date)$/i.test(text)) continue;
    if (/disabled/i.test(attrs)) continue;
    if (/\(FULL\)|sold\s*out|complet/i.test(text)) continue;

    const valueMatch = attrs.match(/value="([^"]*)"/);
    const value = valueMatch?.[1] || text;
    if (!value) continue;

    slots.push(makeSlot(value, text));
  }

  if (!recognized) throw new Error("Ashton: unrecognized date select");
  return slots;
}

// --- Local dry-run ---
if (process.argv[1]?.endsWith("/ashton.ts")) {
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
