// Victoria publishes its own paginated exam-selector listing. Vancouver's
// listing does not include these sittings; a successful empty Victoria filter
// there is not evidence that Victoria has no exams.

import { scrapeTcfListing, printExamRows, type ExamSelectorRow } from "../../src/lib/examSelector";

export const VICTORIA_LISTING_PAGE = "https://www.afvictoria.ca/language/exams/tcf/";

export async function scrapeVictoria(options: { fetchImpl?: typeof fetch } = {}): Promise<ExamSelectorRow[]> {
  // Retain the shared parser's existing key scheme and reminder state shape.
  // All pages must validate before returning a snapshot to the reminder engine.
  const rows = await scrapeTcfListing({ url: VICTORIA_LISTING_PAGE, fetchImpl: options.fetchImpl });
  if (rows.some((row) => !/\bvictoria\b/i.test(row.location))) {
    throw new Error("Victoria listing returned an unexpected location; snapshot not accepted");
  }
  return rows;
}

// --- Local dry-run ---
if (process.argv[1]?.endsWith("/victoria.ts")) {
  scrapeVictoria()
    .then((exams) => printExamRows("victoria", exams))
    .catch((err) => {
      console.error("[victoria] Error:", err);
      process.exitCode = 1;
    });
}
