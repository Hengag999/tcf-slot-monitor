// ELC's official TCF Canada page links to this public computer-test registration flow.
// DScholar loads the entire selectable session array once and paginates it in the browser.
export const ELC_BOOKING = "https://www.dscholar.ca/elc/public-test-inscription/fr/2";
const ELC_SEARCH = "https://eastus2-scholar-host.azurewebsites.net/api/GetSessionToSelectForInscription/";
export const ELC_EXAM_TYPE = "TCF Canada - Computer";

interface Slot {
  id: string;
  examType: typeof ELC_EXAM_TYPE;
  date: string;
  availableSeats: number;
  bookingUrl: string;
}

export function parseMontrealElc(payload: unknown, now = new Date()): Slot[] {
  if (!Array.isArray(payload)) throw new Error("ELC: expected the complete public session list");
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  const seen = new Set<number>();
  const slots: Slot[] = [];
  for (const row of payload) {
    if (!row || row.testTypeId !== 2 || row.testType !== "TCF Canada" ||
        !Number.isSafeInteger(row.id) || row.id <= 0 || seen.has(row.id) ||
        typeof row.isPrivate !== "boolean" || !Number.isSafeInteger(row.availablePlaces) ||
        row.availablePlaces < 0 || typeof row.date !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T00:00:00$/.test(row.date)) {
      throw new Error("ELC: invalid or duplicate TCF Canada session");
    }
    const date = row.date.slice(0, 10);
    const parsedDate = new Date(row.date + "Z");
    if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
      throw new Error("ELC: invalid exam date");
    }
    seen.add(row.id);
    if (!row.isPrivate && row.availablePlaces > 0 && date >= today) {
      slots.push({ id: String(row.id), examType: ELC_EXAM_TYPE, date,
        availableSeats: row.availablePlaces, bookingUrl: ELC_BOOKING });
    }
  }
  return slots.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

export async function scrapeMontrealElc(): Promise<Slot[]> {
  // This POST is the public session search used before the candidate selects a date.
  const response = await fetch(ELC_SEARCH, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", TenantId: "elc", Language: "fr" },
    body: JSON.stringify({ testTypeId: 2 }),
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`ELC: public session search returned HTTP ${response.status}`);
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error("ELC: expected a JSON session response");
  }
  return parseMontrealElc(await response.json());
}

if (process.argv[1]?.endsWith("/montrealElc.ts")) {
  scrapeMontrealElc().then(console.table).catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
