const CALENDAR = 'https://francisation.uqam.ca/tests-tcf/calendrier/';
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

function invalid(detail: string): never {
  throw new Error(`UQAM: ${detail}; registration availability unknown`);
}

function text(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&rsquo;|&#8217;|’/gi, "'").replace(/\s+/g, ' ').trim();
}

function frenchDate(value: string, withWeekday: boolean): string {
  const match = /^(?:([\p{L}]+) )?(\d{1,2})(?:er)? ([\p{L}]+) (\d{4})$/u.exec(value.toLowerCase());
  if (!match || Boolean(match[1]) !== withWeekday) invalid('unrecognized date');
  const month = MONTHS.indexOf(match[3]), day = Number(match[2]), year = Number(match[4]);
  const parsed = new Date(Date.UTC(year, month, day));
  if (month < 0 || year < 2000 || parsed.getUTCMonth() !== month || parsed.getUTCDate() !== day
    || (withWeekday && WEEKDAYS[parsed.getUTCDay()] !== match[1])) invalid('invalid calendar date');
  return parsed.toISOString().slice(0, 10);
}

// Require every row and cell to match the calendar shape, including closed and
// Québec rows. An unparsed sibling could otherwise turn a partial list into a success.
function elements(html: string, pattern: RegExp): string[] {
  if (html.replace(pattern, '').trim()) invalid('unexpected calendar markup');
  return Array.from(html.matchAll(pattern), match => match[1]);
}

function visibleHtml(html: string): string {
  // A WordPress preview or archived copy may contain the complete calendar.
  // Strip non-rendered blocks before finding the main element and its table.
  const clean = html.replace(/<!--[\s\S]*?(?:-->|$)|<(script|style|textarea|title|iframe|noscript)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '');
  let hiddenTag = '', depth = 0, start = 0, visible = '';
  const tags = /<(\/?)([a-z][\w:-]*)\b((?:[^<>"']|"[^"]*"|'[^']*')*)>/gi;
  for (const tag of clean.matchAll(tags)) {
    const [, closing, name, attrs] = tag;
    const tagName = name.toLowerCase();
    if (depth) {
      if (tagName === hiddenTag) depth += closing ? -1 : 1;
      if (!depth) start = tag.index + tag[0].length;
      continue;
    }
    if (closing) continue;
    const classes = attrs.match(/\sclass\s*=\s*["']([^"']*)["']/i)?.[1] ?? '';
    const hidden = /\s(?:hidden|inert)(?=\s|=|$)|\saria-(?:hidden|disabled)\s*=\s*["']?true\b/i.test(attrs)
      || /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(attrs)
      || /(?:^|\s)(?:hidden|d-none|sr-only|visually-hidden)(?:\s|$)/i.test(classes);
    if (!hidden && tagName !== 'template') continue;
    visible += clean.slice(start, tag.index) + '<!--uqam-hidden-->';
    start = tag.index + tag[0].length;
    if (!/^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(tagName)) {
      hiddenTag = tagName;
      depth = 1;
    }
  }
  return depth ? visible : visible + clean.slice(start);
}

export function parseUqamCalendar(html: string, now = new Date()) {
  const mains = [...visibleHtml(html).matchAll(/<main\b[^>]*>([\s\S]*?)<\/main>/gi)];
  if (mains.length !== 1) invalid('calendar main content missing or ambiguous');
  const main = mains[0][1];
  if (!main || text(main.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '') !== 'Calendrier tests TCF') invalid('calendar heading missing');
  const tables = [...main.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)];
  if (tables.length !== 1) invalid('calendar table missing or ambiguous');
  const table = tables[0][1].trim().match(/^<thead\b[^>]*>\s*<tr\b[^>]*>([\s\S]*?)<\/tr>\s*<\/thead>\s*<tbody\b[^>]*>([\s\S]*?)<\/tbody>$/i);
  if (!table) invalid('calendar sections missing');
  if (tables[0][0].includes('<!--uqam-hidden-->')) invalid('hidden calendar content');
  const header = elements(table[1], /<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi).map(cell => text(cell).toLowerCase());
  if (header.join('|') !== "date du test|test|date limite d'inscription|statut") invalid('unrecognized columns');

  const links = [...main.matchAll(/<a\b([^>]+)>([\s\S]*?)<\/a>/gi)].filter(a => text(a[2]).toLowerCase() === "je m'inscris au test");
  const href = links[0]?.[1].match(/\shref\s*=\s*["']([^"']+)["']/i)?.[1];
  if (links.length !== 1 || !href || !/^https:\/\/sites\.grenadine\.uqam\.ca\/sites\/se\/fr\/test-tcf-[\w-]+\/register\/?$/.test(href)) invalid('registration link missing or changed');

  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const seen = new Set<string>();
  const slots: {id: string; examType: string; date: string; bookingUrl: string}[] = [];
  let hasCanadaRow = false;
  for (const row of elements(table[2], /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = elements(row, /<td\b[^>]*>([\s\S]*?)<\/td>/gi).map(text);
    if (cells.length !== 4) invalid('incomplete calendar row');
    const [dateText, test, deadlineText, status] = cells;
    const date = frenchDate(dateText, true), deadline = frenchDate(deadlineText, false);
    if (!['TCF Canada', 'TCF Québec'].includes(test) || !['Ouvert', 'Fermé'].includes(status)
      || deadline > date || (status === 'Ouvert' && /<(?:s|del|strike)\b|text-decoration[^;]*line-through/i.test(row))) invalid('unrecognized or contradictory calendar row');
    const key = `${test}/${date}`;
    if (seen.has(key)) invalid('duplicate calendar sitting');
    seen.add(key);
    if (test === 'TCF Canada') {
      hasCanadaRow = true;
      if (status === 'Ouvert' && deadline >= today) slots.push({ id: `uqam-${date}`, examType: test, date, bookingUrl: href });
    }
  }
  if (!hasCanadaRow) invalid('TCF Canada inventory missing');
  return slots;
}

// Only structural counts and fixed booleans are logged. Never emit page text,
// URLs, cookies or arbitrary server-provided values when a response is unknown.
export function uqamHtmlDiagnostics(html: string): string {
  const visible = visibleHtml(html);
  return JSON.stringify({
    chars: html.length,
    rawMainTags: (html.match(/<main\b/gi) ?? []).length,
    visibleMainSections: [...visible.matchAll(/<main\b[^>]*>([\s\S]*?)<\/main>/gi)].length,
    visibleTables: (visible.match(/<table\b/gi) ?? []).length,
    expectedHeading: /<h1\b[^>]*>\s*Calendrier tests TCF\s*<\/h1>/i.test(visible),
    challengeMarkers: /cf-chl-|challenge-platform|g-recaptcha|hcaptcha|verify you are human|access denied/i.test(html),
  });
}

export async function scrapeMontrealUqam(options: { fetchImpl?: typeof fetch } = {}) {
  const response = await (options.fetchImpl ?? fetch)(CALENDAR, { redirect: 'error', signal: AbortSignal.timeout(15_000),
    headers: { 'User-Agent': 'TCF-Slot-Monitor/1.0 (+https://github.com/Hengag999/tcf-slot-monitor)' } });
  if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) invalid(`calendar HTTP ${response.status} or unexpected content type`);
  const html = await response.text();
  try {
    return parseUqamCalendar(html);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('UQAM: ')) {
      throw new Error(`${error.message}; HTML diagnostics=${uqamHtmlDiagnostics(html)}`);
    }
    throw error;
  }
}

if (process.argv[1]?.endsWith('/montrealUqam.ts')) {
  scrapeMontrealUqam().then(slots => console.log(JSON.stringify(slots, null, 2))).catch(error => { console.error(error); process.exitCode = 1; });
}
