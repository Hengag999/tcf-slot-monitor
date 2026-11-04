// North York scraper (GB Language Centre)
// Calls the GBLC TCF Canada schedules API for both Computer and Paper.
// The booking site offers both formats; restricting format_id to 5 hid paper.
import { fetchNorthYorkViaPublicDns, NORTH_YORK_API_URL, type NorthYorkApiResponse } from "../../src/lib/northYorkConnection";
export { NORTH_YORK_API_URL } from "../../src/lib/northYorkConnection";

export interface Slot {
  id: string;
  examType: string;
  date: string;       // "YYYY-MM-DD"
  startTime: string;  // "HH:MM"
  endTime: string;    // "HH:MM"
  availableSeats: number;
  bookingUrl: string;
}

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

// Only the three request-transport failures observed in CI are retried.
// HTTP, TLS, DNS, body-read and inventory failures retain immediate failure.
function connectionFailureCode(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const leaf = error instanceof TypeError && !("code" in error) && error.cause instanceof Error
    ? error.cause : error;
  if (leaf.cause !== undefined || leaf instanceof AggregateError) return undefined;
  const code = (leaf as NodeJS.ErrnoException).code;
  return code === "ECONNREFUSED" || code === "UND_ERR_CONNECT_TIMEOUT" || code === "ECONNRESET" ? code : undefined;
}

// Preserve actionable fixed codes for ineligible failures without printing raw
// exception messages, addresses, URLs, credentials or arbitrary nested values.
function transportSummary(error: unknown): string {
  const allowedNames = new Set(["Error", "TypeError", "AggregateError", "AbortError", "TimeoutError"]);
  const allowedCodes = new Set(["ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT", "ECONNRESET", "ETIMEDOUT",
    "EAI_AGAIN", "ENOTFOUND", "ABORT_ERR", "UND_ERR_SOCKET", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT",
    "CERT_HAS_EXPIRED", "ERR_TLS_CERT_ALTNAME_INVALID", "DEPTH_ZERO_SELF_SIGNED_CERT", "UNABLE_TO_VERIFY_LEAF_SIGNATURE"]);
  const names = new Set<string>();
  const codes = new Set<string>();
  const seen = new Set<Error>();
  const visit = (value: unknown): void => {
    if (!(value instanceof Error) || seen.has(value) || seen.size >= 16) return;
    seen.add(value);
    try {
      if (allowedNames.has(value.name)) names.add(value.name);
      const code = (value as NodeJS.ErrnoException).code;
      if (code && allowedCodes.has(code)) codes.add(code);
      visit(value.cause);
      if (value instanceof AggregateError && Array.isArray(value.errors)) value.errors.slice(0, 8).forEach(visit);
    } catch { /* Unknown/unreadable fields remain unclassified, never raw diagnostics. */ }
  };
  visit(error);
  return `errorNames=${[...names].sort().join("|") || "unknown"}; codes=${[...codes].sort().join("|") || "unknown"}`;
}

export async function scrapeNorthYork(options: {
  fetchImpl?: typeof fetch;
  publicDnsFetchImpl?: (signal: AbortSignal) => Promise<NorthYorkApiResponse>;
  sleep?: (milliseconds: number) => Promise<void>;
} = {}): Promise<Slot[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  let res!: NorthYorkApiResponse;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const signal = AbortSignal.timeout(30_000);
      res = attempt === 1
        ? await fetchImpl(NORTH_YORK_API_URL, { signal, redirect: "error" })
        : await (options.publicDnsFetchImpl ?? fetchNorthYorkViaPublicDns)(signal);
      break;
    } catch (error) {
      const code = connectionFailureCode(error);
      if (!code) throw new Error(`GBLC: schedule request failed (non-retryable transport error; ${transportSummary(error)})`);
      if (attempt === 3) throw new Error(`GBLC: schedule connection failed after 3 attempts (code=${code})`);
      console.warn(`[northyork] schedule connection ${code}; retry ${attempt}/2 via isolated public DNS`);
      await sleep(attempt * 1000);
    }
  }
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
