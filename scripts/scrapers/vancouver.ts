// Vancouver scraper
//
// AF Vancouver migrated off the old Oncord product page (the
// /products/ciep-tcf-canada-full-exam/ combobox) to the shared "exam-selector"
// platform on alliancefrancaise.ca. AF Victoria later joined the same platform,
// so the row parsing lives in src/lib/examSelector.ts and this file only filters
// by the Location column.
//
// Vancouver takes every row that is NOT Victoria's (rather than requiring the
// word "Vancouver") so a row with a missing/renamed location cell is never
// silently dropped — Vancouver is the platform's flagship centre and the safer
// default owner for unattributed rows.
//
// Unlike most other cities, Vancouver does NOT return "currently bookable"
// slots. It returns every exam ROW on the page (with its registration-open
// epoch), and the reminder engine in src/lib/registrationReminders.ts decides
// what to notify. See that file for the rationale (spots vanish in seconds;
// reminders beat real-time detection on a coarse cron).

import { scrapeTcfListing, printExamRows, type ExamSelectorRow } from "../../src/lib/examSelector";

export async function scrapeVancouver(): Promise<ExamSelectorRow[]> {
  const rows = await scrapeTcfListing();
  return rows.filter((r) => !/victoria/i.test(r.location));
}

// --- Local dry-run ---
if (process.argv[1].endsWith("vancouver.ts")) {
  scrapeVancouver()
    .then((exams) => printExamRows("vancouver", exams))
    .catch((err) => {
      console.error("[vancouver] Error:", err);
      process.exit(1);
    });
}
