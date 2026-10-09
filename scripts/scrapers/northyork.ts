// North York scraper (GB Language Centre)
// Calls the GBLC TCF Canada schedules API for both Computer and Paper.
// The booking site offers both formats; restricting format_id to 5 hid paper.

export interface Slot {
  id: string;
  examType: string;
  date: string;       // "YYYY-MM-DD"
  startTime: string;  // "HH:MM"
  endTime: string;    // "HH:MM"
  availableSeats: number;
  bookingUrl: string;
}

export const NORTH_YORK_API_URL =
  "https://api.gblc.ca/candidates/test-schedules/" +
  "?test_id=6&has_available_seats=true";

const BOOKING_URL = "https://www.gblc.ca/en/book-now/choose-date";

interface Schedule {
  id: number;
  tests: { id: number; title: string };
  formats: { id: number; title: string };
  location: string;
  start_at_date: string;      // "YYYY-MM-DD"
  group_time_start: string;   // "HH:MM:SS"
  group_time_end: string;     // "HH:MM:SS"
  seats: number;
  taken_seats: number;
  has_available_seats: boolean;
}

function toHHMM(time: string): string {
  return time.slice(0, 5);
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function validTime(value: unknown): value is string {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(value);
}

export function parseNorthYorkSchedules(data: unknown): Slot[] {
  // GBLC's public booking UI currently consumes a bare array with no paging.
  // A future envelope or unknown identity must fail, never erase prior state.
  if (!Array.isArray(data)) throw new Error("GBLC: expected a complete schedule array; response shape may have changed");
  const seen = new Set<number>();
  for (const [index, value] of data.entries()) {
    const s = value as Partial<Schedule> | null;
    const formatMatches = s?.formats?.id === 5 && s.formats.title === "Computer"
      || s?.formats?.id === 4 && s.formats.title === "Paper";
    if (!s || !Number.isSafeInteger(s.id) || s.id! <= 0 || seen.has(s.id!)
      || s.tests?.id !== 6 || s.tests.title !== "TCF Canada" || !formatMatches
      || s.location !== "Toronto") {
      throw new Error(`GBLC: unexpected or duplicate schedule identity at row ${index}`);
    }
    if (!validDate(s.start_at_date) || !validTime(s.group_time_start) || !validTime(s.group_time_end)
      || !Number.isSafeInteger(s.seats) || !Number.isSafeInteger(s.taken_seats)
      || s.taken_seats! < 0 || s.seats! <= s.taken_seats! || s.has_available_seats !== true) {
      throw new Error(`GBLC: invalid or inconsistent availability at row ${index}`);
    }
    seen.add(s.id!);
  }

  return (data as Schedule[]).map((s) => ({
    id: String(s.id),
    examType: `${s.tests.title} - ${s.formats.title}`,
    date: s.start_at_date,
    startTime: toHHMM(s.group_time_start),
    endTime: toHHMM(s.group_time_end),
    availableSeats: s.seats - s.taken_seats,
    bookingUrl: BOOKING_URL,
  }));
}

export async function scrapeNorthYork(options: { fetchImpl?: typeof fetch } = {}): Promise<Slot[]> {
  const res = await (options.fetchImpl ?? fetch)(NORTH_YORK_API_URL, {
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
  });
  if (!res.ok) throw new Error(`GBLC API error ${res.status}`);

  const slots = parseNorthYorkSchedules(await res.json());
  console.log(`[northyork] API returned ${slots.length} schedule(s) with available seats (Computer + Paper)`);
  return slots;
}

// --- Local dry-run ---
if (process.argv[1]?.endsWith("/northyork.ts")) {
  scrapeNorthYork()
    .then((slots) => {
      if (slots.length === 0) {
        console.log("[northyork] No available slots found.");
      } else {
        console.log(`\n[northyork] ${slots.length} available slot(s):\n`);
        for (const s of slots) {
          console.log(`  [${s.examType}] ${s.date} — ${s.startTime} to ${s.endTime} (${s.availableSeats} seats)`);
          console.log(`  ${s.bookingUrl}\n`);
        }
      }
    })
    .catch((err) => {
      console.error("[northyork] Error:", err);
      process.exit(1);
    });
}
