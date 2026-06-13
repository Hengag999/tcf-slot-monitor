// Toronto scraper
// Step 1: Fetch session list from Alliance Française CM API (two calls: e-TCF + p-TCF)
// Step 2: For each session, confirm availability via Active Communities API (space_status)
// Returns only sessions where space_status is not a known non-bookable state

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

// Node's fetch sends no User-Agent by default, which trips the CM API's
// bot/WAF challenge from datacenter IPs (e.g. GitHub Actions runners): it
// answers 200 with an HTML interstitial instead of JSON, so res.json() blew up
// with an opaque "Unexpected token '<'". A real browser UA + Accept header gets
// past the soft challenge; the retry rides out the intermittent ones.
const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-CA,en;q=0.9",
};

// Fetch a URL expecting JSON. Retries on HTTP errors and on non-JSON bodies
// (the WAF interstitial), and on final failure throws a legible error carrying
// the status, content-type and a body snippet instead of a parser stack trace.
async function fetchJson<T>(url: string, label: string): Promise<T> {
  const MAX_ATTEMPTS = 3;
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let body: string;
    let status = 0;
    let contentType = "?";
    try {
      const res = await fetch(url, { headers: BROWSER_HEADERS });
      status = res.status;
      contentType = res.headers.get("content-type") ?? "?";
      body = await res.text();
    } catch (err) {
      lastErr = new Error(`${label}: network error — ${(err as Error).message}`);
      body = "";
    }

    if (body) {
      const trimmed = body.trimStart();
      if (status >= 200 && status < 300 && (trimmed.startsWith("{") || trimmed.startsWith("["))) {
        try {
          return JSON.parse(trimmed) as T;
        } catch (err) {
          lastErr = new Error(`${label}: invalid JSON (status ${status}) — ${(err as Error).message}`);
        }
      } else if (status < 200 || status >= 300) {
        lastErr = new Error(`${label}: HTTP ${status}`);
      } else {
        // 2xx but not JSON — almost always the bot/WAF challenge HTML page.
        lastErr = new Error(
          `${label}: non-JSON response (status ${status}, content-type ${contentType}) — likely a bot/WAF challenge: ${trimmed.slice(0, 80)}…`,
        );
      }
    }

    if (attempt < MAX_ATTEMPTS) {
      console.warn(`  [toronto] ${lastErr?.message} — retry ${attempt}/${MAX_ATTEMPTS - 1}`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw lastErr ?? new Error(`${label}: failed after ${MAX_ATTEMPTS} attempts`);
}

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

  const data = await fetchJson<CMResponse>(url, `CM API category ${category}`);
  return data.items ?? [];
}

async function isAvailable(sessionId: number): Promise<boolean> {
  const url = `${ACTIVE_API_BASE}/${sessionId}?locale=en-US`;
  const res = await fetch(url, { headers: BROWSER_HEADERS });
  if (!res.ok) {
    console.warn(`  [toronto] Active API returned ${res.status} for session ${sessionId}`);
    return false;
  }
  // Guard against the same non-JSON WAF interstitial. Treat an unparseable
  // detail response as "not bookable" (conservative — a false negative beats a
  // thrown scrape that freezes checked_at), and log it so CI surfaces the block.
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    console.warn(`  [toronto] Active API non-JSON for session ${sessionId} — treating as unavailable`);
    return false;
  }
  const spaceStatus: string | undefined = data?.body?.detail?.space_status;
  const NON_BOOKABLE = ["Full", "On Hold"];
  const blocked = NON_BOOKABLE.includes(spaceStatus ?? "");
  if (blocked) {
    console.log(`  [toronto] Session ${sessionId} skipped (space_status: "${spaceStatus}")`);
  }
  return !blocked;
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
