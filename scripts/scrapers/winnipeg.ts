// Alliance Française du Manitoba publishes seats under "Next sessions" and
// links a registration form. These are published availability counts, not a
// live checkout inventory. Never submit that form from this monitor.
export interface Slot {
  id: string;
  examType: "TCF Canada";
  date: string;
  bookingUrl: string;
  availableSeats?: number;
}

export const WINNIPEG_PAGE = "https://www.afmanitoba.ca/en/exams/tcf/";
export const WINNIPEG_REGISTRATION = `${WINNIPEG_PAGE}register-tcf-canada/`;
const USER_AGENT = "TCF-Slot-Monitor/1.0 (+https://github.com/Hengag999/tcf-slot-monitor)";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function text(html: string): string {
  return html.replace(/<[^>]*>/g, " ")
    .replace(/&#(?:x([\da-f]+)|(\d+));/gi, (_all, hex, decimal) => {
      const code = Number.parseInt(hex ?? decimal, hex ? 16 : 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "�";
    })
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"').replace(/&apos;|&#39;/gi, "'")
    .replace(/\s+/g, " ").trim();
}

function isEmptyNotice(value: string): boolean {
  return /^(?:No (?:upcoming )?(?:sessions|dates|spots) (?:are )?(?:currently )?available|All sessions (?:are )?(?:full|sold out))[.!]?$/i.test(value);
}

function hasExplicitlyHiddenMarkup(html: string): boolean {
  const tags = /<[a-z][\w:-]*\b((?:[^"'<>]|"[^"]*"|'[^']*')*)>/gi;
  for (const tag of html.matchAll(tags)) {
    const attributes = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    for (const attribute of tag[1].matchAll(attributes)) {
      const name = attribute[1].toLowerCase();
      const value = attribute[2] ?? attribute[3] ?? attribute[4] ?? "";
      if (name === "hidden" || (name === "aria-hidden" && value.toLowerCase() === "true")
        || (name === "style" && /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:!important\s*)?(?:;|$)/i.test(value))) return true;
    }
  }
  return false;
}

function parseDate(value: string): string {
  const match = value.match(/^([a-z]+)(?:\.\s*|\s+)(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?$/i);
  if (!match) throw new Error("Winnipeg: unrecognized session date; state must be preserved");
  const monthName = match[1].toLowerCase();
  const month = MONTHS.findIndex(name => name.toLowerCase() === monthName
    || name.slice(0, 3).toLowerCase() === monthName
    || (name === "September" && monthName === "sept"));
  const day = Number(match[2]);
  const year = match[3] ? Number(match[3]) : undefined;
  // An absent year stays absent. In particular, the next-announcement year is
  // not evidence of the sitting year. Leap-day validation permits a yearless
  // February 29 while rejecting impossible month/day combinations.
  const maxDay = month < 0 ? 0 : new Date(Date.UTC(year ?? 2024, month + 1, 0)).getUTCDate();
  if (day < 1 || day > maxDay || (year !== undefined && year < 1000)) {
    throw new Error("Winnipeg: invalid session date; state must be preserved");
  }
  return `${MONTHS[month]} ${day}${year === undefined ? "" : `, ${year}`}`;
}

function parseSession(value: string): { date: string; seats: number } {
  const match = value.match(/^(.+?)\s*\((?:(\d+)\s+spots?\s+available|(full|sold out|closed))\)$/i);
  if (!match) throw new Error("Winnipeg: unrecognized session date or availability; state must be preserved");
  const date = parseDate(match[1].trim());
  const seats = match[2] === undefined ? 0 : Number(match[2]);
  if (!Number.isSafeInteger(seats) || seats < 0) throw new Error("Winnipeg: invalid seat count");
  return { date, seats };
}

function publishedDatesWithoutCounts(rest: string): Slot[] {
  // The centre formats the same positive announcement as headings with <br>
  // or individual paragraphs. Source-code whitespace is not a date boundary;
  // rendered block boundaries are. Inline emphasis must not split a date.
  const lines = rest.replace(/\s+/g, " ")
    .replace(/<\/?(?:h[1-6]|p|div|li|ol|ul)\b[^>]*>|<br\b[^>]*>/gi, "\n")
    .split("\n").map(text).filter(Boolean);
  const prefix = /^NO MU(?:L)?TIPLE REGISTRATIONS FOR THE SAME CANDIDATE!\s+New dates:\s*spots available!$/i;
  const bannerEnd = lines.findIndex((_line, index) => prefix.test(lines.slice(0, index + 1).join(" ")));
  if (bannerEnd < 0) {
    throw new Error("Winnipeg: Next sessions boundary missing or unrecognized availability list; state must be preserved");
  }
  const disclaimer = "No refund or deferment is possible. Cancellations for climatic or personal reasons are not possible.";
  const boundaries = lines.flatMap((line, index) => line === disclaimer ? [index] : []);
  if (boundaries.length !== 1 || boundaries[0] <= bannerEnd + 1
    || !/^Registration(?: Registration)?$/.test(lines.slice(boundaries[0] + 1).join(" "))) {
    throw new Error("Winnipeg: published dates disclaimer or registration boundary changed; state must be preserved");
  }
  const dates = lines.slice(bannerEnd + 1, boundaries[0]).map(parseDate);
  if (new Set(dates).size !== dates.length) throw new Error("Winnipeg: duplicate session date is ambiguous");
  return dates.map(date => ({
    id: `winnipeg-${date.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    examType: "TCF Canada", date, bookingUrl: WINNIPEG_REGISTRATION,
    // The source says places are available but does not publish seat counts.
  }));
}

export function parseWinnipeg(html: string): Slot[] {
  const clean = html.replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  const headings = [...clean.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]\s*>/gi)];
  if (!headings.some(heading => /^TCF Canada$/i.test(text(heading[1])))) {
    throw new Error("Winnipeg: TCF Canada page context missing");
  }
  const sections = [...clean.matchAll(/<section\b[^>]*>[\s\S]*?<\/section\s*>/gi)]
    .map(match => match[0])
    .filter(section => [...section.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2\s*>/gi)]
      .some(heading => /^Next sessions$/i.test(text(heading[1]))));
  if (sections.length !== 1 || (sections[0].match(/<section\b/gi) ?? []).length !== 1) {
    throw new Error("Winnipeg: missing or ambiguous Next sessions section");
  }
  const section = sections[0];
  // Hidden availability or registration markup is not evidence of an active
  // public offer. Reject this snapshot; never turn hidden content into [] or
  // let a hidden banner/date/link establish availability for the whole card.
  if (hasExplicitlyHiddenMarkup(section)) {
    throw new Error("Winnipeg: explicitly hidden session or registration markup; state must be preserved");
  }
  const titles = [...section.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2\s*>/gi)]
    .filter(heading => /^Next sessions$/i.test(text(heading[1])));
  if (titles.length !== 1) throw new Error("Winnipeg: ambiguous Next sessions heading");

  const validLinks = [...section.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)].filter(link => {
    if (!/^Registration$/i.test(text(link[2])) || /\b(?:disabled|aria-disabled\s*=\s*["']?true)\b/i.test(link[1])) return false;
    const href = link[1].match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2];
    if (!href) return false;
    try { return new URL(href, WINNIPEG_PAGE).href === WINNIPEG_REGISTRATION; } catch { return false; }
  });
  if (validLinks.length !== 1) throw new Error("Winnipeg: valid linked TCF Canada registration form missing or ambiguous");

  const start = titles[0].index! + titles[0][0].length;
  const rest = section.slice(start);
  const boundary = [...rest.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]\s*>/gi)]
    .find(heading => /^(?:Next dates will be announced on|Important information)$/i.test(text(heading[1])));
  if (!boundary) return publishedDatesWithoutCounts(rest);
  const listing = rest.slice(0, boundary.index);
  const slots: Slot[] = [];
  const dates = new Set<string>();
  let emptyNotice = false;
  let parsedSessions = 0;
  const remainder = listing.replace(/<h3\b[^>]*>([\s\S]*?)<\/h3\s*>/gi, (_heading, content) => {
    const value = text(content).replace(/^New dates:\s*/i, "");
    if (!value) return "";
    if (isEmptyNotice(value)) { emptyNotice = true; return ""; }
    const { date, seats } = parseSession(value);
    if (dates.has(date)) throw new Error("Winnipeg: duplicate session date is ambiguous");
    dates.add(date);
    parsedSessions++;
    if (seats > 0) slots.push({
      id: `winnipeg-${date.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      examType: "TCF Canada", date, bookingUrl: WINNIPEG_REGISTRATION, availableSeats: seats,
    });
    return "";
  });
  const remainingText = text(remainder)
    .replace(/^NO MU(?:L)?TIPLE REGISTRATIONS FOR THE SAME CANDIDATE!\s*/i, "")
    .replace(/^New dates:\s*/i, "");
  if (remainingText) {
    if (!isEmptyNotice(remainingText)) throw new Error("Winnipeg: unrecognized content in session listing");
    emptyNotice = true;
  }
  if ((!parsedSessions && !emptyNotice) || (slots.length && emptyNotice)) {
    throw new Error("Winnipeg: missing or conflicting availability evidence");
  }
  return slots;
}

export async function scrapeWinnipeg(options: { fetchImpl?: typeof fetch } = {}): Promise<Slot[]> {
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(WINNIPEG_PAGE, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      signal: AbortSignal.timeout(20_000),
      redirect: "error",
    });
  } catch {
    throw new Error("Winnipeg: public listing request failed or timed out");
  }
  if (!response.ok) throw new Error(`Winnipeg: public listing returned HTTP ${response.status}`);
  if (!/\btext\/html\b/i.test(response.headers.get("content-type") ?? "")) {
    throw new Error("Winnipeg: public listing did not return HTML");
  }
  let html: string;
  try { html = await response.text(); }
  catch { throw new Error("Winnipeg: public listing body failed or timed out"); }
  if (html.length > 2_000_000) throw new Error("Winnipeg: public listing exceeded expected size");
  return parseWinnipeg(html);
}

if (process.argv[1]?.endsWith("winnipeg.ts")) {
  scrapeWinnipeg().then(slots => console.log(JSON.stringify(slots, null, 2)))
    .catch(error => { console.error(error); process.exitCode = 1; });
}
