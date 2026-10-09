// AEC branch 1 exposes TCF Canada computer (type 5) and paper (type 79).
// Type names verified from the live API on 2026-10-09. A failure in either
// endpoint rejects the whole Ottawa snapshot, preserving both prior formats.
import { scrapeAecExaminations, type AecSlot, type AecSource } from "../../src/lib/aecExaminations";

export interface Slot extends AecSlot {}

const SOURCE: AecSource = {
  label: "Ottawa", baseUrl: "https://afottawa.aec.app", branchId: 1,
  examTypes: [{ id: 5, name: "TCF Canada sur ordinateur" }, { id: 79, name: "TCF Canada (papier)" }],
  bookingOrigins: ["https://www.af.ca", "https://af.ca"],
};

export async function scrapeOttawa(options: { fetchImpl?: typeof fetch } = {}): Promise<Slot[]> {
  return scrapeAecExaminations(SOURCE, options.fetchImpl);
}

if (process.argv[1]?.endsWith("ottawa.ts")) {
  scrapeOttawa().then(slots => {
    console.log(`[ottawa] ${slots.length} available slot(s).`);
    for (const s of slots) console.log(`  [${s.examType}] ${s.date} — ${s.startTime} to ${s.endTime}\n  ${s.bookingUrl}`);
  }).catch(err => { console.error("[ottawa] Error:", err); process.exitCode = 1; });
}
