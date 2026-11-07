// The Cégep links to this public WebInscription catalogue. Each card exposes the
// same per-session cart action as its detail page. Only the catalogue is fetched.
export const MARIE_VICTORIN_CATALOG = "https://cmvtcf.webinscription.com/fr/students/catalog";
const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

interface Slot {
  id: string;
  examType: "TCF Canada";
  date: string;
  bookingUrl: string;
  startTime: string;
}

function fail(reason: string): never {
  throw new Error(`Montréal Marie-Victorin: ${reason}; availability unknown`);
}

function attr(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`\\s${name}=["']([^"']*)["']`, "i"))?.[1];
}

function text(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
}

function getSession(card: string, seen: Set<string>): Slot | undefined {
  const titles = [...card.matchAll(/<h3\b[^>]*\bclass=["']course-title["'][^>]*>\s*(<a\b[^>]*>)([^<>]+)<\/a>\s*<\/h3>/gi)];
  if (titles.length !== 1) fail("missing or duplicate course title");
  const [, anchor, title] = titles[0];
  const bookingUrl = new URL(attr(anchor, "href") ?? "", MARIE_VICTORIN_CATALOG);
  const session = bookingUrl.pathname.match(/^\/fr\/students\/catalog\/(\d+)-/);
  if (bookingUrl.origin !== new URL(MARIE_VICTORIN_CATALOG).origin || bookingUrl.username || bookingUrl.password || bookingUrl.search || bookingUrl.hash || !session) fail("unexpected session link");
  const id = session[1];
  if (seen.has(id)) fail("duplicate session ID");
  seen.add(id);
  if (/^TCF (?:QU[ÉE]BEC|TOUT PUBLIC)$/i.test(title.trim())) {
    if (!/\/\d+-tcf-(?:quebec|tout-public)-/.test(bookingUrl.pathname)) fail("unrecognized variant link");
    return;
  }
  if (!/^TCF CANADA$/i.test(title.trim())) fail("unrecognized course identity");
  const identity = bookingUrl.pathname.match(/^\/fr\/students\/catalog\/\d+-tcf-canada-montreal-qc-(\d{1,2})-([a-z]+)-(\d{4})$/);
  if (!identity) fail("unexpected Montréal session link");
  const [, slugDay, slugMonth, slugYear] = identity;
  const dateText = card.match(/<div\b[^>]*\bclass=["']course-date["'][^>]*>([\s\S]*?)<\/div>/i);
  const date = text(dateText?.[1] ?? "").match(/^(\d{1,2}) ([a-zéû]+) (\d{4}) à ([01]?\d|2[0-3])h([0-5]\d)$/iu);
  if (!date) fail("unrecognized session date or time");
  const [, day, month, year, hour, minutes] = date;
  const monthNum = MONTHS.indexOf(month.toLowerCase()) + 1;
  if (!monthNum || +day !== +slugDay || year !== slugYear || month.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase() !== slugMonth ||
      +day < 1 || +day > new Date(Date.UTC(+year, monthNum, 0)).getUTCDate()) fail("session date disagrees with link or calendar");

  const tags = card.match(/<[a-z][\w-]*\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi) ?? [];
  const cartActions = tags.filter(tag => /^<a\b/i.test(tag) && attr(tag, "id")?.startsWith("add_"));
  if (cartActions.length !== 1) fail("missing or duplicate registration action");
  const action = cartActions[0];
  if (attr(action, "id") !== `add_${id}` || attr(action, "href") !== `/fr/students/carts_sessions?session_id=${id}` ||
      attr(action, "title") !== "Ajouter au panier" || attr(action, "data-method") !== "post") fail("registration action disagrees with session");
  // The anonymous card has a second hidden 'checkout' link for use AFTER adding
  // to cart. It is never evidence that a session is open.
  const hidden = tags.some(tag => attr(tag, "id") !== `cart_link_${id}` && (
    /\shidden(?:[\s=>])|\saria-hidden=["']true["']/i.test(tag) || /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(attr(tag, "style") ?? "") ||
    (attr(tag, "class") ?? "").split(/\s+/).includes("hidden")));
  if (hidden) fail("hidden course markup");
  const sold = /<(?:div|span)\b[^>]*class=["'][^"']*\b(?:sold-out-overlay|badge-sold)\b/i.test(card);
  const disabled = (attr(action, "class") ?? "").split(/\s+/).includes("disabled") || /\s(?:disabled\b|aria-disabled=["']true["']|onclick=)/i.test(action);
  if (sold && disabled && /\bComplet\b/i.test(text(card))) return;
  if (sold || disabled || !(attr(action, "class") ?? "").split(/\s+/).includes("course-cta")) fail("unknown registration status");
  return {
    id, examType: "TCF Canada", date: `${year}-${String(monthNum).padStart(2, "0")}-${day.padStart(2, "0")}`,
    startTime: `${hour.padStart(2, "0")}:${minutes}`, bookingUrl: bookingUrl.href,
  };
}

function parsePage(html: string, seen: Set<string>) {
  const clean = html.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  if (!/alt=["']Cegep Marie-Victorin - Tests de français logo["']/i.test(clean)) fail("catalogue identity missing");
  if (/\bid=["']active_filters["']/i.test(clean)) fail("catalogue is filtered");
  const count = clean.match(/<div\b[^>]*class=["']results-count\b[^"']*["'][^>]*>\s*<strong\b[^>]*>(\d+)<\/strong>\s*cours trouvé\(s\)/i);
  const list = clean.match(/<div\b[^>]*\bid=["']courses["'][^>]*>([\s\S]*?)<div\b[^>]*\bid=["']courses_paginate["'][^>]*>([\s\S]*?)<\/div>/i);
  if (!count || !list) fail("catalogue total, results or pagination missing");
  const total = Number(count[1]);
  const cards = list[1].split(/(?=<div\b[^>]*class=["']course-card(?:\s|["']))/i).slice(1);
  if (total === 0) {
    if (cards.length || !text(list[1]).includes("Essayer un autre critère de recherche, celui-ci n&#39;a pas de succès")) fail("unrecognized empty catalogue");
  } else if (!cards.length || !/\bid=["']courses-list["']/i.test(list[1])) fail("course cards missing");
  const nextLinks = (list[2].match(/<a\b[^>]+>/gi) ?? []).filter(tag => (attr(tag,"rel") ?? "").split(/\s+/).includes("next"));
  if (nextLinks.length > 1) fail("ambiguous pagination");
  const next = nextLinks.length ? attr(nextLinks[0], "href")?.replace(/&amp;/g, "&") : undefined;
  if (nextLinks.length && !next) fail("next page link missing");
  return { total, count: cards.length, slots: cards.map(card => getSession(card, seen)).filter((slot): slot is Slot => slot !== undefined), next };
}

export async function scrapeMontrealMarieVictorin(options: { fetchImpl?: typeof fetch; now?: Date } = {}): Promise<Slot[]> {
  const seen = new Set<string>();
  const slots: Slot[] = [];
  let url = MARIE_VICTORIN_CATALOG;
  let count = 0;
  let total: number | undefined;
  for (let page = 1; page <= 20; page++) {
    const response = await (options.fetchImpl ?? fetch)(url, {
      headers: {"User-Agent": "TCF-Slot-Monitor/1.0 (+https://github.com/Hengag999/tcf-slot-monitor)"},
      redirect: "error", signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) fail(`catalogue HTTP ${response.status}`);
    const result = parsePage(await response.text(), seen);
    total ??= result.total;
    if (result.total !== total) fail("catalogue total changed during pagination");
    slots.push(...result.slots);
    count += result.count;
    if (!result.next) {
      if (count !== total) fail("incomplete catalogue");
      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit",
      }).format(options.now ?? new Date());
      return slots.filter(slot => slot.date >= today);
    }
    const next = new URL(result.next, MARIE_VICTORIN_CATALOG);
    if (count >= total || next.origin + next.pathname !== MARIE_VICTORIN_CATALOG || next.username || next.password || next.hash ||
        next.search !== `?page=${page + 1}`) fail("unexpected next page");
    url = next.href;
  }
  return fail("pagination limit exceeded");
}

if (process.argv[1]?.endsWith("/montrealMarieVictorin.ts")) {
  scrapeMontrealMarieVictorin().then(console.log).catch(error => { console.error(error); process.exitCode = 1; });
}
