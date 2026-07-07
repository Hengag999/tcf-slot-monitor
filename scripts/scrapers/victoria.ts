// Victoria scraper
//
// AF Victoria left its own Oncord product page in 2026-06/07: the old
// /products/ceip-tcf-canada-full-exam-victoria/ URL now returns a plain 404
// (which froze this scraper's checked_at for ~18 days), afvictoria.ca defers
// all exam registration to the shared AF-CAPA "exam-selector" platform on
// alliancefrancaise.ca, and exam contact moved to exam-victoria@afcapa.ca.
//
// Victoria therefore watches the same shared TCF-Canada listing table as
// Vancouver (parsing in src/lib/examSelector.ts) and keeps only rows whose
// Location column mentions Victoria. As of 2026-07 the table carries zero
// Victoria rows — AF's own FAQ points TCF candidates to Vancouver — so the
// steady state is an empty array, NOT an error. If AF resumes Victoria
// sittings on this platform, the rows appear here and the registration
// reminder engine picks them up (reminderMode, same as Vancouver).

import { scrapeTcfListing, printExamRows, type ExamSelectorRow } from "../../src/lib/examSelector";

export async function scrapeVictoria(): Promise<ExamSelectorRow[]> {
  const rows = await scrapeTcfListing();
  return rows.filter((r) => /victoria/i.test(r.location));
}

// --- Local dry-run ---
if (process.argv[1].endsWith("victoria.ts")) {
  scrapeVictoria()
    .then((exams) => printExamRows("victoria", exams))
    .catch((err) => {
      console.error("[victoria] Error:", err);
      process.exit(1);
    });
}
