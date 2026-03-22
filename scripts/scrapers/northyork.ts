// North York scraper (GB Language Centre)
// Calls the GBLC test-schedules API with has_available_seats=true filter
// Returns only sessions that still have seats available

export interface Slot {
  id: string;
  examType: string;
  date: string;       // "YYYY-MM-DD"
  startTime: string;  // "HH:MM"
  endTime: string;    // "HH:MM"
  availableSeats: number;
  bookingUrl: string;
}

const API_URL =
  "https://api.gblc.ca/candidates/test-schedules/" +
  "?location=Toronto&test_id=6&format_id=5&has_available_seats=true";

const BOOKING_URL = "https://www.gblc.ca/en/book-now/choose-date";

interface Schedule {
  id: number;
  tests: { title: string };
  formats: { title: string };
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

export async function scrapeNorthYork(): Promise<Slot[]> {
  const res = await fetch(API_URL);
  if (!res.ok) throw new Error(`GBLC API error ${res.status}`);

  const data: Schedule[] = await res.json();

  console.log(`[northyork] API returned ${data.length} schedule(s) with available seats`);

  const slots: Slot[] = data.map((s) => ({
    id: String(s.id),
    examType: `${s.tests.title} - ${s.formats.title}`,
    date: s.start_at_date,
    startTime: toHHMM(s.group_time_start),
    endTime: toHHMM(s.group_time_end),
    availableSeats: s.seats - s.taken_seats,
    bookingUrl: BOOKING_URL,
  }));

  return slots;
}

// --- Local dry-run ---
if (process.argv[1].endsWith("northyork.ts")) {
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
