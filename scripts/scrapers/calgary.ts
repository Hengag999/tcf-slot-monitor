// Calgary scraper
// The AFC Calgary booking card is static HTML managed via Oncord CMS.
// No API available — we scrape the page and detect whether the "Sorry" message
// is present. When it's gone, slots have opened and we extract whatever booking
// links/text we can find in the card.
//
// TODO: once a live session is observed, inspect the HTML and improve date/link extraction.

export interface Slot {
  id: string;
  examType: string;   // best-effort from card heading text
  date: string;       // best-effort from link text; "unknown" if not parseable
  bookingUrl: string; // specific booking link if found, else the TCF page URL
}

const TCF_PAGE = "https://www.afcalgary.ca/exams/tcf/";
const NO_SLOTS_MARKER = "Sorry, no dates are available at the moment.";

export async function scrapeCalgary(): Promise<Slot[]> {
  const res = await fetch(TCF_PAGE, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; tcf-slot-monitor/1.0)" },
  });
  if (!res.ok) throw new Error(`Calgary page fetch failed: ${res.status}`);

  const html = await res.text();

  if (html.includes(NO_SLOTS_MARKER)) {
    return []; // nothing open
  }

  // Slots appear to be open — try to extract booking links from the card section.
  // Best-effort: find <a href="..."> tags in the Step 2 section.
  // Pattern covers both absolute and relative hrefs that look like booking links.
  const slots: Slot[] = [];
  const linkPattern = /<a\s+href="(https?:\/\/[^"]+)"[^>]*>([^<]+)<\/a>/gi;
  let match: RegExpExecArray | null;

  // Narrow to the Step 2 card block so we don't pick up nav links
  const step2Start = html.indexOf("Step 2");
  const step2End = html.indexOf("Step 3", step2Start);
  const cardHtml = step2Start !== -1 ? html.slice(step2Start, step2End !== -1 ? step2End : undefined) : html;

  while ((match = linkPattern.exec(cardHtml)) !== null) {
    const [, href, text] = match;
    const cleanText = text.replace(/\s+/g, " ").trim();
    slots.push({
      id: `calgary-${Buffer.from(href).toString("base64").slice(0, 12)}`,
      examType: "TCF Canada",
      date: cleanText || "unknown",
      bookingUrl: href,
    });
  }

  // If no links were found but the "Sorry" marker is gone, return a generic signal
  if (slots.length === 0) {
    slots.push({
      id: "calgary-generic",
      examType: "TCF Canada",
      date: "unknown",
      bookingUrl: TCF_PAGE,
    });
  }

  return slots;
}

// --- Local dry-run ---
if (process.argv[1].endsWith("calgary.ts")) {
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
