// Calgary scraper
// AFC Calgary registration page (Oncord CMS) shows session cards per month.
// Each card has a date label (e.g. "April 2026 sessions") and either
// "SOLD OUT" text or a "Registrations" link.
// We also follow the registration link to verify the destination isn't a
// "closed" placeholder — the real registration page won't have "closed" in
// the URL or page content.

export interface Slot {
  id: string;
  examType: string;
  date: string;       // e.g. "June 2026 sessions"
  bookingUrl: string;
}

const REGISTRATION_PAGE = "https://www.afcalgary.ca/exams/tcf/registration-process/";
const HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; tcf-slot-monitor/1.0)" };

async function isRegistrationOpen(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { headers: HEADERS, redirect: "follow" });
    // Check final URL after redirects
    if (/closed/i.test(res.url)) return false;
    if (!res.ok) return false;
    const html = await res.text();
    // Check page content for closed indicators
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").toLowerCase();
    if (text.includes("registration is closed") || text.includes("registrations are closed")) return false;
    return true;
  } catch {
    return false; // network error = can't confirm it's open
  }
}

export async function scrapeCalgary(): Promise<Slot[]> {
  const res = await fetch(REGISTRATION_PAGE, { headers: HEADERS });
  if (!res.ok) throw new Error(`Calgary page fetch failed: ${res.status}`);

  const html = await res.text();

  // Narrow to the Step 2 section where session cards live
  const step2Start = html.indexOf("Step 2");
  if (step2Start === -1) {
    throw new Error("Calgary: Step 2 section not found — structure may have changed");
  }
  const step3Start = html.indexOf("Step 3", step2Start);
  const sectionHtml = html.slice(step2Start, step3Start !== -1 ? step3Start : undefined);

  // Split into individual cards (each card is a s8-templates-card div)
  const cardPattern = /class="s8-templates-card\s+s8-templates-card__cardsize-5">([\s\S]*?)(?=<\/div>\s*<div[^>]*class="s8-templates-card|<\/div>\s*<\/div>\s*<div[^>]*style="margin-top)/g;
  const candidates: { date: string; bookingUrl: string }[] = [];
  let match: RegExpExecArray | null;

  while ((match = cardPattern.exec(sectionHtml)) !== null) {
    const cardHtml = match[1];

    // Skip cards that are SOLD OUT
    if (/SOLD\s*OUT/i.test(cardHtml)) continue;

    // Extract session date label (e.g. "June 2026 sessions")
    // Strip HTML tags and normalize whitespace, then extract the date label
    const textContent = cardHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const dateMatch = textContent.match(/(\w+ \d{4} sessions)/i);
    const date = dateMatch ? dateMatch[1] : "unknown";

    // Extract registration link if present
    const linkMatch = cardHtml.match(/<a[^>]+href="([^"]+)"[^>]*>\s*Registrations/i);
    if (!linkMatch) continue; // no registration link = not bookable

    const href = linkMatch[1];
    const bookingUrl = href.startsWith("http") ? href : `https://www.afcalgary.ca${href}`;

    candidates.push({ date, bookingUrl });
  }

  // Verify each candidate by following the registration link
  const slots: Slot[] = [];
  for (const { date, bookingUrl } of candidates) {
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
