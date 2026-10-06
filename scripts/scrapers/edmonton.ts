// Edmonton now lists exams on its public exam-selector table. The retired
// product URL redirects to one closed exam, so it cannot represent inventory.
// Fetch all listing pages once; the orchestrator can use the same rows for
// bookable-date alerts and advance registration reminders.

import { scrapeTcfListing, type ExamSelectorRow } from "../../src/lib/examSelector";

export interface Slot {
  id: string;
  examType: "TCF Canada";
  date: string;
  bookingUrl: string;
  availableSeats?: number;
}

export const EDMONTON_LISTING_PAGE = "https://www.afedmonton.com/en/exams/tcf/";

/** All listed TCF Canada exams, including closed rows and future openings. */
export async function scrapeEdmontonExams(): Promise<ExamSelectorRow[]> {
  const rows = await scrapeTcfListing({ url: EDMONTON_LISTING_PAGE, keyPrefix: "edmonton" });
  const exams = rows.filter((row) => /\btcf[\s-]*canada\b/i.test(row.label));
  console.log(`[edmonton] ${exams.length} listed TCF Canada exam(s)`);
  return exams;
}

function isBookingLink(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === new URL(EDMONTON_LISTING_PAGE).origin
      && url.pathname === "/af/exam-selector/order/"
      && /^[1-9]\d*$/.test(url.searchParams.get("exam_id") ?? "");
  } catch {
    return false;
  }
}

/**
 * Remaining seats alone do not mean registration is open. On 2026-10-06 one
 * closed TCF row still showed 1 seat. A genuine same-site open DELF row exposed
 * an es-status-available Book Now link to /af/exam-selector/order/?exam_id=…;
 * require that positive booking signal, not a negative sold-out text check.
 */
export function bookableEdmontonSlots(exams: ExamSelectorRow[], nowMs = Date.now()): Slot[] {
  return exams
    .filter((exam) => /\btcf[\s-]*canada\b/i.test(exam.label)
      && exam.bookingAvailable
      && exam.statusClass === "es-status-available"
      && isBookingLink(exam.bookingUrl)
      && (exam.spotsLeft == null || exam.spotsLeft > 0)
      && (exam.registrationOpensAt == null || exam.registrationOpensAt * 1000 <= nowMs))
    .map((exam) => ({
      id: exam.id,
      examType: "TCF Canada",
      date: exam.label,
      bookingUrl: exam.bookingUrl,
      ...(exam.spotsLeft == null ? {} : { availableSeats: exam.spotsLeft }),
    }));
}

/** Standalone availability scraper; callers needing reminders can reuse rows. */
export async function scrapeEdmonton(): Promise<Slot[]> {
  return bookableEdmontonSlots(await scrapeEdmontonExams());
}

// --- Local dry-run ---
if (process.argv[1]?.endsWith("/edmonton.ts")) {
  scrapeEdmonton()
    .then((slots) => {
      console.log(`[edmonton] ${slots.length} available slot(s)`);
      for (const slot of slots) {
        console.log(`  [${slot.examType}] ${slot.date}`);
        console.log(`  ${slot.bookingUrl}\n`);
      }
    })
    .catch((err) => {
      console.error("[edmonton] Error:", err);
      process.exitCode = 1;
    });
}
