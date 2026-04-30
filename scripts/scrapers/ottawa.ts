// Ottawa scraper
// Alliance Française Ottawa uses the same AEC platform as Halifax (aec.app).
// JSON structure is identical — see halifax.ts for field documentation.
//
// Two exam type endpoints:
//   /list/1/5  — TCF Canada (one format, likely paper-based)
//   /list/1/79 — TCF Canada (other format, likely computer-based)
//
// TODO: confirm exam type names (product_name values) once a live session is observed.
//
// Availability signal: isFull === false AND mainRegisterLink.link !== ""
//
// Empty-state quirk: AEC returns HTTP 204 No Content (empty body) when an
// endpoint has no examinations to list, rather than an empty array. `res.ok`
// is true for 204, so the previous `await res.json()` would throw
// "Unexpected end of JSON input" if either endpoint emptied. Read body as
// text and short-circuit on empty.

export interface Slot {
  id: string;
  examType: string;   // product_name from API (e.g. "TCF Canada")
  date: string;       // "YYYY-MM-DD"
  startTime: string;  // "HH:MM"
  endTime: string;    // "HH:MM"
  bookingUrl: string;
}

const AEC_BASE = "https://afottawa.aec.app";
const ENDPOINTS = [
  `${AEC_BASE}/api/v1/public/examinations/list/1/5?allBranches=N&CURRENT_LANG=en_US`,
  `${AEC_BASE}/api/v1/public/examinations/list/1/79?allBranches=N&CURRENT_LANG=en_US`,
];

interface RegisterLink {
  link: string;
  label: string;
}

interface Examination {
  IDEXAMINATION: number;
  product_name: string;
  examination_date: string;
  start_time: string;
  end_time: string;
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
  if (!res.ok) throw new Error(`Ottawa: failed to fetch page for API key (${res.status})`);
  const html = await res.text();
  const match = html.match(/"APIKEY":"([^"]+)"/);
  if (!match) throw new Error("Ottawa: APIKEY not found in page source — structure may have changed");
  return match[1];
}

export async function scrapeOttawa(): Promise<Slot[]> {
  const apiKey = await fetchApiKey();

  const headers = {
    "API_KEY": apiKey,
    "CURRENT_LANG": "en_US",
  };

  const responses = await Promise.all(
    ENDPOINTS.map((url) => fetch(url, { headers }))
  );

  const slots: Slot[] = [];

  for (const res of responses) {
    if (!res.ok) throw new Error(`Ottawa: examinations API returned ${res.status} for ${res.url}`);

    const body = await res.text();
    if (body.trim() === "") continue;

    const data: ExaminationType[] = JSON.parse(body);
    const examinations = data[0]?.examinations ?? [];

    for (const exam of examinations) {
      if (exam.isFull) continue;
      if (!exam.mainRegisterLink?.link) continue;

      slots.push({
        id: String(exam.IDEXAMINATION),
        examType: exam.product_name,
        date: exam.examination_date,
        startTime: exam.start_time.slice(0, 5),
        endTime: exam.end_time.slice(0, 5),
        bookingUrl: exam.mainRegisterLink.link,
      });
    }
  }

  return slots;
}

// --- Local dry-run ---
if (process.argv[1].endsWith("ottawa.ts")) {
  scrapeOttawa()
    .then((slots) => {
      if (slots.length === 0) {
        console.log("[ottawa] No available slots found.");
      } else {
        console.log(`\n[ottawa] ${slots.length} available slot(s):\n`);
        for (const s of slots) {
          console.log(`  [${s.examType}] ${s.date} — ${s.startTime} to ${s.endTime}`);
          console.log(`  ${s.bookingUrl}\n`);
        }
      }
    })
    .catch((err) => {
      console.error("[ottawa] Error:", err);
      process.exit(1);
    });
}
