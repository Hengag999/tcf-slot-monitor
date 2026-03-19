// Toronto scraper
// Step 1: Fetch session list from Alliance Française CM API (two calls: e-TCF + p-TCF)
// Step 2: For each session, confirm availability via Active Communities API (space_status)
// Returns only sessions where space_status !== "Full"

export type ExamType = "E-TCF Canada" | "P-TCF Canada";

export interface Slot {
  id: string;
  examType: ExamType;
  date: string;       // "YYYY-MM-DD"
  startTime: string;  // "HH:MM"
  endTime: string;    // "HH:MM"
  bookingUrl: string;
}

const CM_API_BASE = "https://cm-api.alliance-francaise.ca/groupcourses";
const ACTIVE_API_BASE = "https://anc.ca.apm.activecommunities.com/aftoronto/rest/activity/detail";
const BOOKING_BASE = "https://anc.ca.apm.activecommunities.com/aftoronto/activity/search/detail";

const CATEGORIES: { id: number; examType: ExamType }[] = [
  { id: 367, examType: "E-TCF Canada" }, // computer-based
  { id: 368, examType: "P-TCF Canada" }, // paper-based
];

interface DatePattern {
  activity_start_date: string; // "YYYY-MM-DD"
  activity_start_time: string; // "HH:MM:SS"
  activity_end_time: string;   // "HH:MM:SS"
}

interface CMSession {
  id: number;
  name: string;
  start_date: string;       // ISO timestamp fallback
  date_patterns: DatePattern[];
}

interface CMResponse {
  items: CMSession[];
}

async function fetchSessions(
  category: number
): Promise<CMSession[]> {
  const url =
    `${CM_API_BASE}?enddate=gte&limit=150&openspaces=1&orderby=course.startDate` +
    `&othercategory=${category}&status=0`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`CM API error ${res.status} for category ${category}`);
  const data: CMResponse = await res.json();
  return data.items ?? [];
}

async function isAvailable(sessionId: number): Promise<boolean> {
  const url = `${ACTIVE_API_BASE}/${sessionId}?locale=en-US`;
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`  [toronto] Active API returned ${res.status} for session ${sessionId}`);
    return false;
  }
  const data = await res.json();
  const spaceStatus: string | undefined = data?.body?.detail?.space_status;
  return spaceStatus !== "Full";
}

function toHHMM(time: string): string {
  // "HH:MM:SS" → "HH:MM"
  return time.slice(0, 5);
}

export async function scrapeToronto(): Promise<Slot[]> {
  const sessionsByType = await Promise.all(
    CATEGORIES.map(async ({ id, examType }) => ({
      examType,
      sessions: await fetchSessions(id),
    }))
  );

  const tagged = sessionsByType.flatMap(({ examType, sessions }) =>
    sessions.map((s) => ({ examType, session: s }))
  );

  console.log(`[toronto] Found ${tagged.length} total sessions (${
    sessionsByType.map(({ examType, sessions }) => `${sessions.length} ${examType}`).join(", ")
  }), checking availability...`);

  const slots: Slot[] = [];

  // Check availability concurrently, capped to avoid hammering the API
  const CONCURRENCY = 5;
  for (let i = 0; i < tagged.length; i += CONCURRENCY) {
    const batch = tagged.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async ({ examType, session }) => ({
        examType,
        session,
        available: await isAvailable(session.id),
      }))
    );

    for (const { examType, session, available } of results) {
      if (!available) continue;

      const pattern = session.date_patterns?.[0];
      const date = pattern?.activity_start_date ?? session.start_date.slice(0, 10);
      const startTime = pattern ? toHHMM(pattern.activity_start_time) : "??:??";
      const endTime = pattern ? toHHMM(pattern.activity_end_time) : "??:??";

      slots.push({
        id: String(session.id),
        examType,
        date,
        startTime,
        endTime,
        bookingUrl: `${BOOKING_BASE}/${session.id}`,
      });
    }
  }

  return slots;
}

// --- Local dry-run ---
if (process.argv[1].endsWith("toronto.ts")) {
  scrapeToronto()
    .then((slots) => {
      if (slots.length === 0) {
        console.log("[toronto] No available slots found.");
      } else {
        console.log(`\n[toronto] ${slots.length} available slot(s):\n`);
        for (const s of slots) {
          console.log(`  [${s.examType}] ${s.date} — ${s.startTime} to ${s.endTime}`);
          console.log(`  ${s.bookingUrl}\n`);
        }
      }
    })
    .catch((err) => {
      console.error("[toronto] Error:", err);
      process.exit(1);
    });
}
