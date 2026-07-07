// Shared parser for the alliancefrancaise.ca "exam-selector" TCF-Canada listing.
//
// AF Vancouver migrated onto this platform in 2026-06, and AF Victoria followed
// in 2026-06/07 (afvictoria.ca now defers all exam registration to
// alliancefrancaise.ca; the old Oncord product page 404s). Both cities' exams
// live in the SAME listing table, distinguished by the Location column — so the
// row parsing lives here and each city scraper filters by location.
//
// Each exam is a <tr class="tableRow"> with columns:
//   Exam | Schedules | Registration Dates | Location | Spots left | Price | Bookings
// The Bookings cell carries the machine-readable registration-open time as a unix
// epoch: <span class="es-status es-status-..." data-opens-at="1781550000">.
// Rows whose registration is already open/closed/full carry no data-opens-at.

import type { RegistrationExam } from "./registrationReminders";

const LISTING_PAGE = "https://www.alliancefrancaise.ca/en/language/exams/tcf-canada/";
const HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; tcf-slot-monitor/1.0)" };

export interface ExamSelectorRow extends RegistrationExam {
  location: string; // stripped text of the Location column
}

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

/** Fetch and parse every TCF row on the shared listing table. */
export async function scrapeTcfListing(): Promise<ExamSelectorRow[]> {
  const res = await fetch(LISTING_PAGE, { headers: HEADERS, redirect: "follow" });
  if (!res.ok) throw new Error(`exam-selector listing fetch failed: ${res.status}`);
  const html = await res.text();

  // If neither the row marker nor the exam-title class is present, the page
  // structure changed — throw so the health check surfaces it (a frozen
  // checked_at), rather than silently reporting zero exams.
  if (!/<tr class="tableRow">/i.test(html) && !/class="es-exam-title"/i.test(html)) {
    throw new Error("exam-selector: exam table not found — page structure may have changed");
  }

  const exams: ExamSelectorRow[] = [];
  for (const row of html.matchAll(/<tr class="tableRow">([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
    if (cells.length < 7) continue;

    const label = stripTags(cells[0]);
    if (!/tcf/i.test(label)) continue; // ignore any non-TCF rows defensively

    const schedule = stripTags(cells[1]);
    const registrationWindow = stripTags(cells[2]);
    const location = stripTags(cells[3]);

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
      location,
    });
  }

  return exams;
}

export function printExamRows(cityKey: string, exams: ExamSelectorRow[]): void {
  if (exams.length === 0) {
    console.log(`[${cityKey}] No exams listed on the page.`);
    return;
  }
  console.log(`\n[${cityKey}] ${exams.length} exam(s):\n`);
  for (const e of exams) {
    const opens = e.registrationOpensAt
      ? new Date(e.registrationOpensAt * 1000).toISOString()
      : "n/a";
    console.log(`  ${e.label}`);
    console.log(`    schedule: ${e.schedule}`);
    console.log(`    registration: ${e.registrationWindow}`);
    console.log(`    location: ${e.location}`);
    console.log(`    opens-at: ${opens} | status: ${e.statusClass} | spots: ${e.spotsLeft}`);
    console.log(`    ${e.bookingUrl}\n`);
  }
}
