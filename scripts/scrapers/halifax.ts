// Official TCF page -> tcf-canada-registration -> AEC widget branch 1, type 16.
// /list/1/16 is branch/type, not pagination. Verified against the public widget
// and all-types catalogue on 2026-10-09: 29 sittings, 17 bookable at that time.
import { scrapeAecExaminations, type AecSlot, type AecSource } from "../../src/lib/aecExaminations";

export interface Slot extends AecSlot {
  examType: "TCF Canada";
}

const SOURCE: AecSource = {
  label: "Halifax", baseUrl: "https://afhalifax.aec.app", branchId: 1,
  examTypes: [{ id: 16, name: "TCF Canada" }],
  bookingOrigins: ["https://afhalifax.ca"],
};

export async function scrapeHalifax(options: { fetchImpl?: typeof fetch } = {}): Promise<Slot[]> {
  const slots = await scrapeAecExaminations(SOURCE, options.fetchImpl);
  return slots.map(slot => ({ ...slot, examType: "TCF Canada" }));
}

if (process.argv[1]?.endsWith("halifax.ts")) {
  scrapeHalifax().then(slots => {
    console.log(`[halifax] ${slots.length} available slot(s).`);
    for (const s of slots) console.log(`  [${s.examType}] ${s.date} — ${s.startTime} to ${s.endTime}\n  ${s.bookingUrl}`);
  }).catch(err => { console.error("[halifax] Error:", err); process.exitCode = 1; });
}
