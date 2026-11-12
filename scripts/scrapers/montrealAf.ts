import { scrapeAecExaminations, type AecSource, type AecSlot } from "../../src/lib/aecExaminations";

// The TCF Canada widget on https://www.afmontreal.ca/tcf/ selects type 10
// and leaves establishment blank (list/0/10). The actual Montréal branch is 1.
const source: AecSource = {
  label: "Alliance Française de Montréal",
  baseUrl: "https://afmontreal.aec.app",
  listingBranchId: 0,
  branchId: 1,
  examTypes: [{ id: 10, name: "TCF CANADA" }],
  bookingOrigins: ["https://www.afmontreal.ca"],
  // Retry transient origin failures within this scrape; exhaustion has no grace.
  retryKeyPageOriginErrors: true,
};

type Slot = Omit<AecSlot, "startTime" | "endTime"> & { startTime?: string; endTime?: string };

export async function scrapeMontrealAf(options: { fetchImpl?: typeof fetch; now?: Date; sleep?: (ms: number) => Promise<void> } = {}): Promise<Slot[]> {
  const sittings = await scrapeAecExaminations(source, options.fetchImpl, options.sleep);
  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(options.now ?? new Date());
  return sittings.filter(sitting => sitting.date >= today).map(({ startTime, endTime, ...slot }) => ({
    ...slot,
    examType: "TCF Canada",
    // The centre emails exact times. Its widget uses 00:00–00:00 until then.
    ...(startTime === "00:00" && endTime === "00:00" ? {} : { startTime, endTime }),
  }));
}

if (process.argv[1]?.endsWith("montrealAf.ts")) {
  scrapeMontrealAf().then(slots => console.log(JSON.stringify(slots, null, 2))).catch(error => {
    console.error("[montreal-af]", error);
    process.exitCode = 1;
  });
}
