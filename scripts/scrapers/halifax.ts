// Halifax scraper
// Alliance Française Halifax uses the AEC platform (afhalifax.aec.app).
// The API key is public — it's embedded in the page HTML as window.aecStatus.APIKEY.
// It may rotate with software updates; if requests start returning 401, re-scrape the page.
//
// Availability signal: isFull === false AND mainRegisterLink.link !== ""
// All other states (examination_sold_out, kiosque_examination_enrollment_date_over) mean
// the slot is not bookable right now.
//
// Empty-state quirk: when AEC has no examinations to return, it responds with
// HTTP 204 No Content (empty body) rather than `[]` or `[{"examinations":[]}]`.
// `res.ok` is true for 204, so passing an empty body to `res.json()` throws
// "Unexpected end of JSON input". Read the body as text first and treat empty
// as zero slots.

export interface Slot {
  id: string;
  examType: "TCF Canada";
  date: string;       // "YYYY-MM-DD"
  startTime: string;  // "HH:MM"
  endTime: string;    // "HH:MM"
  bookingUrl: string;
}

const AEC_BASE = "https://afhalifax.aec.app";
const EXAMINATIONS_URL = `${AEC_BASE}/api/v1/public/examinations/list/1/16?allBranches=N&CURRENT_LANG=en_US`;

// IDEXAMINATION_TYPE 16 = TCF Canada
// Page 1, limit 16 per the original URL — but the API returned 28 results,
// so either the limit param is ignored server-side or it means something else. Fine either way.

interface RegisterLink {
  link: string;
  label: string;
}

interface Examination {
  IDEXAMINATION: number;
  product_name: string;
  examination_date: string;   // "YYYY-MM-DD"
  start_time: string;         // "HH:MM:SS"
  end_time: string;           // "HH:MM:SS"
  isFull: boolean;
  mainRegisterLink: RegisterLink;
}

interface ExaminationType {
  examinations: Examination[];
}

async function fetchApiKey(): Promise<string> {
  const res = await fetch(`${AEC_BASE}/`, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; tcf-slot-monitor/1.0)" },
  });
  if (!res.ok) throw new Error(`Halifax: failed to fetch page for API key (${res.status})`);
  const html = await res.text();
  const match = html.match(/"APIKEY":"([^"]+)"/);
  if (!match) throw new Error("Halifax: APIKEY not found in page source — structure may have changed");
  return match[1];
}

export async function scrapeHalifax(): Promise<Slot[]> {
  const apiKey = await fetchApiKey();

  const res = await fetch(EXAMINATIONS_URL, {
    headers: {
      "API_KEY": apiKey,
      "CURRENT_LANG": "en_US",
    },
  });
  if (!res.ok) throw new Error(`Halifax: examinations API returned ${res.status}`);

  const body = await res.text();
  if (body.trim() === "") return [];

  const data: ExaminationType[] = JSON.parse(body);
  const examinations = data[0]?.examinations ?? [];

  const slots: Slot[] = [];
  for (const exam of examinations) {
    if (exam.isFull) continue;
    if (!exam.mainRegisterLink?.link) continue;

    slots.push({
      id: String(exam.IDEXAMINATION),
      examType: "TCF Canada",
      date: exam.examination_date,
      startTime: exam.start_time.slice(0, 5),
      endTime: exam.end_time.slice(0, 5),
      bookingUrl: exam.mainRegisterLink.link,
    });
  }

  return slots;
}

// --- Local dry-run ---
if (process.argv[1].endsWith("halifax.ts")) {
  scrapeHalifax()
    .then((slots) => {
      if (slots.length === 0) {
        console.log("[halifax] No available slots found.");
      } else {
        console.log(`\n[halifax] ${slots.length} available slot(s):\n`);
        for (const s of slots) {
          console.log(`  [${s.examType}] ${s.date} — ${s.startTime} to ${s.endTime}`);
          console.log(`  ${s.bookingUrl}\n`);
        }
      }
    })
    .catch((err) => {
      console.error("[halifax] Error:", err);
      process.exit(1);
    });
}
