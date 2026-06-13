// Vancouver scraper
//
// AF Vancouver migrated off the old Oncord product page (the
// /products/ciep-tcf-canada-full-exam/ combobox) to a new "exam-selector"
// platform. The old product URL now 301-redirects to a dead "...-classic" slug,
// which is why the previous combobox scraper threw on every run.
//
// The current source of truth is the TCF-Canada exam listing table:
//   https://www.alliancefrancaise.ca/en/language/exams/tcf-canada/
// Each exam is a <tr class="tableRow"> with columns:
//   Exam | Schedules | Registration Dates | Location | Spots left | Price | Bookings
// The Bookings cell carries the machine-readable registration-open time as a unix
// epoch: <span class="es-status es-status-..." data-opens-at="1781550000">.
//
// Unlike every other city, Vancouver does NOT return "currently bookable" slots.
// It returns every exam ROW on the page (with its registration-open epoch), and
// the reminder engine in src/lib/vancouverReminders.ts decides what to notify.
// See that file for the rationale (spots vanish in seconds; reminders beat
// real-time detection on a coarse cron).

import type { VancouverExam } from "../../src/lib/vancouverReminders";

const LISTING_PAGE = "https://www.alliancefrancaise.ca/en/language/exams/tcf-canada/";
const HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; tcf-slot-monitor/1.0)" };

function stripTags(s: string): string {
  return s
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function absUrl(href: string): string {
  if (/^https?:\/\//i.test(href)) return href;
  return "https://www.alliancefrancaise.ca" + (href.startsWith("/") ? href : `/${href}`);
}

export async function scrapeVancouver(): Promise<VancouverExam[]> {
  const res = await fetch(LISTING_PAGE, { headers: HEADERS, redirect: "follow" });
  if (!res.ok) throw new Error(`Vancouver page fetch failed: ${res.status}`);
  const html = await res.text();

  // The table renders each exam as <tr class="tableRow">. If neither the row
  // marker nor the exam-title class is present, the page structure changed —
  // throw so the health check surfaces it (a frozen checked_at), rather than
  // silently reporting zero exams.
  if (!/<tr class="tableRow">/i.test(html) && !/class="es-exam-title"/i.test(html)) {
    throw new Error("Vancouver: exam table not found — page structure may have changed");
  }

  const exams: VancouverExam[] = [];
  for (const row of html.matchAll(/<tr class="tableRow">([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
    if (cells.length < 7) continue;

    const label = stripTags(cells[0]);
    if (!/tcf/i.test(label)) continue; // ignore any non-TCF rows defensively

    const schedule = stripTags(cells[1]);
    const registrationWindow = stripTags(cells[2]);

    const spotsText = stripTags(cells[4]);
    const spotsMatch = spotsText.match(/\d+/);
    const spotsLeft = spotsMatch ? parseInt(spotsMatch[0], 10) : null;

    const bookings = cells[6];
    const statusClass = (bookings.match(/class="es-status\s+(es-status-[a-z-]+)/i) || [, "es-status-unknown"])[1];
    const opensAt = bookings.match(/data-opens-at="(\d+)"/i);
    const registrationOpensAt = opensAt ? parseInt(opensAt[1], 10) : null;

    const href = (bookings.match(/href="([^"]+)"/i) || cells[0].match(/href="([^"]+)"/i) || [])[1];
    const bookingUrl = href ? absUrl(href) : LISTING_PAGE;

    const examKey = `tcf-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;

    exams.push({
      id: examKey,
      examType: "TCF Canada",
      date: label,
      bookingUrl,
      examKey,
      label,
      schedule,
      registrationWindow,
      registrationOpensAt,
      spotsLeft,
      statusClass,
    });
  }

  return exams;
}

// --- Local dry-run ---
if (process.argv[1].endsWith("vancouver.ts")) {
  scrapeVancouver()
    .then((exams) => {
      if (exams.length === 0) {
        console.log("[vancouver] No exams listed on the page.");
      } else {
        console.log(`\n[vancouver] ${exams.length} exam(s):\n`);
        for (const e of exams) {
          const opens = e.registrationOpensAt
            ? new Date(e.registrationOpensAt * 1000).toISOString()
            : "n/a";
          console.log(`  ${e.label}`);
          console.log(`    schedule: ${e.schedule}`);
          console.log(`    registration: ${e.registrationWindow}`);
          console.log(`    opens-at: ${opens} | status: ${e.statusClass} | spots: ${e.spotsLeft}`);
          console.log(`    ${e.bookingUrl}\n`);
        }
      }
    })
    .catch((err) => {
      console.error("[vancouver] Error:", err);
      process.exit(1);
    });
}
