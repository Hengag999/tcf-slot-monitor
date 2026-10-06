// Calgary's month-level registration buttons can remain after every date sells out.
// Follow each candidate month and require an individual registration link.
// Unknown page shapes and failed requests throw so the orchestrator retains state.

export interface Slot {
  id: string;
  examType: string;
  date: string;       // e.g. "June 2026 sessions"
  bookingUrl: string;
}

const REGISTRATION_PAGE = "https://www.afcalgary.ca/exams/tcf/registration-process/";
const HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; tcf-slot-monitor/1.0)" };

const REQUEST_TIMEOUT_MS = 20_000;

function visibleText(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/\s+/g, " ").trim();
}

// Isolate balanced divs so a card cannot inherit links/status text from a sibling
// or the footer. Oncord's cards contain nested divs and sometimes extra classes.
function divsWithClass(html: string, className: string): string[] {
  const blocks: string[] = [];
  const tags = /<\/?div\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = tags.exec(html)) !== null) {
    const classes = match[0].match(/\bclass\s*=\s*(["'])(.*?)\1/i)?.[2].split(/\s+/) ?? [];
    if (!classes.includes(className)) continue;
    const start = tags.lastIndex;
    let depth = 1;
    while ((match = tags.exec(html)) !== null) {
      depth += /^<\//.test(match[0]) ? -1 : 1;
      if (depth === 0) break;
    }
    if (!match) throw new Error(`Calgary: incomplete ${className} block`);
    blocks.push(html.slice(start, match.index));
  }
  return blocks;
}

export function parseCalgaryRegistration(html: string, url: string): boolean {
  // Ignore source-code examples, comments and styles when looking for card state.
  const content = html.replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
  const text = visibleText(content);
  if (/\bregistrations? (?:is|are) closed\b/i.test(text)) return false;

  const cards = divsWithClass(content, "exam-card");
  if (cards.length === 0) {
    throw new Error(`Calgary: no exam cards or explicit closure at ${url} — structure may have changed`);
  }

  let openCount = 0;
  for (const card of cards) {
    if (/\bsold\s*out\b/i.test(visibleText(card))) continue;
    const registrationBlocks = divsWithClass(card, "exam-registration");
    const bookingLinks = registrationBlocks.flatMap((block) => [...block.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)]);
    const hasBookingLink = bookingLinks.some((link) => {
      const href = link[1].match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2].trim();
      if (!href || href.startsWith("#") || /(?:^|\s)(?:disabled(?:\s|=|$)|aria-disabled\s*=\s*["']true["'])/i.test(link[1])) return false;
      const label = visibleText(link[2]);
      if (!label || /\b(?:sold\s*out|closed|unavailable)\b/i.test(label)) return false;
      try {
        return /^(?:https?:)$/.test(new URL(href.replace(/&amp;/g, "&"), url).protocol);
      } catch {
        return false;
      }
    });
    if (!hasBookingLink) {
      throw new Error(`Calgary: exam card has neither SOLD OUT nor an actionable registration link at ${url}`);
    }
    openCount++;
    // A live open example has not yet been observed; retain bounded diagnostics.
    console.log(`[calgary:OPEN-MARKUP] ${url}\n${card.slice(0, 600)}`);
  }
  console.log(`[calgary:dest] ${url} cards=${cards.length} open=${openCount}`);
  return openCount > 0;
}

async function isRegistrationOpen(url: string): Promise<boolean> {
  const res = await fetch(url, {
    headers: HEADERS,
    redirect: "follow",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  // A failed request is unknown availability, even if its error URL says closed.
  if (!res.ok) throw new Error(`Calgary destination fetch failed: ${res.status} at ${url}`);
  return parseCalgaryRegistration(await res.text(), res.url || url);
}

export async function scrapeCalgary(): Promise<Slot[]> {
  const res = await fetch(REGISTRATION_PAGE, { headers: HEADERS, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Calgary page fetch failed: ${res.status}`);

  const html = await res.text();

  // Narrow to the Step 2 section where session cards live
  const step2Start = html.indexOf("Step 2");
  if (step2Start === -1) {
    throw new Error("Calgary: Step 2 section not found — structure may have changed");
  }
  const step3Start = html.indexOf("Step 3", step2Start);
  const sectionHtml = html.slice(step2Start, step3Start !== -1 ? step3Start : undefined);

  const candidates: { date: string; bookingUrl: string }[] = [];
  let sessionCards = 0;
  for (const cardHtml of divsWithClass(sectionHtml, "s8-templates-card__cardsize-5")) {
    // Extract session date label (e.g. "June 2026 sessions")
    // Strip HTML tags and normalize whitespace, then extract the date label
    const textContent = visibleText(cardHtml);
    const dateMatch = textContent.match(/(\w+ \d{4} sessions)/i);
    if (!dateMatch) continue; // Ignore non-session information cards in Step 2.
    sessionCards++;
    const date = dateMatch[1];
    if (/SOLD\s*OUT/i.test(textContent)) continue;

    // Extract registration link if present
    const linkMatch = cardHtml.match(/<a[^>]+href="([^"]+)"[^>]*>\s*Registrations/i);
    if (!linkMatch) throw new Error(`Calgary: ${date} has neither SOLD OUT nor a Registrations link`);

    const href = linkMatch[1];
    const bookingUrl = href.startsWith("http") ? href : `https://www.afcalgary.ca${href}`;

    candidates.push({ date, bookingUrl });
  }

  if (sessionCards === 0) {
    throw new Error("Calgary: no session cards found in Step 2 — structure may have changed");
  }

  // Verify each candidate by following the registration link
  const slots: Slot[] = [];
  for (const { date, bookingUrl } of candidates) {
    // Record the parent-side opening signal: a month whose "Registrations" button is
    // visible (not SOLD OUT at month level). Pairs with the [calgary:dest] line to show
    // whether the month-level signal actually had bookable dates behind it.
    console.log(`[calgary:candidate] "${date}" -> ${bookingUrl}`);
    if (await isRegistrationOpen(bookingUrl)) {
      slots.push({
        id: `calgary-${Buffer.from(date).toString("base64").slice(0, 12)}`,
        examType: "TCF Canada",
        date,
        bookingUrl,
      });
    }
  }

  return slots;
}

// --- Local dry-run ---
if (process.argv[1]?.endsWith("calgary.ts")) {
  scrapeCalgary()
    .then((slots) => {
      if (slots.length === 0) {
        console.log("[calgary] No available slots found.");
      } else {
        console.log(`\n[calgary] ${slots.length} available slot(s):\n`);
        for (const s of slots) {
          console.log(`  [${s.examType}] date: ${s.date}`);
          console.log(`  ${s.bookingUrl}\n`);
        }
      }
    })
    .catch((err) => {
      console.error("[calgary] Error:", err);
      process.exit(1);
    });
}
