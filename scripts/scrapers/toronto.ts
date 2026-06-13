// Toronto scraper (hybrid: two sources, one per exam type)
//
// E-TCF (computer, "4 modules") lives in the Active Communities booking system
//   under category 30. The old CM-API category 367 ("E-TCF - 5 modules") was a
//   different, now-defunct product whose listings are all in the past — keying
//   E-TCF off it was a silent blind spot. So E-TCF is read straight from the
//   Active Communities activities/list API (which exposes availability inline)
//   and confirmed against the detail API.
// P-TCF (paper, "4 modules") exists ONLY in the CM API, category 368 (a keyword
//   search for "P-TCF" in Active Communities returns nothing). So P-TCF keeps
//   the CM-list path, confirmed against the same detail API.
//
// Availability for both is confirmed via the Active Communities detail API by
// activity id — the CM session id and the Active Communities activity id are the
// same number, which is what let the original detail-confirmation step work.
//
// The CM API answers datacenter IPs (GitHub Actions) with a WAF/bot-challenge
// HTML page instead of JSON unless the request carries a real User-Agent; see
// fetchJson() and BROWSER_HEADERS.

export type ExamType = "E-TCF Canada" | "P-TCF Canada";

export interface Slot {
  id: string;
  examType: ExamType;
  date: string;       // "YYYY-MM-DD" (best-effort; never empty)
  startTime?: string; // "HH:MM" (P-TCF only — AC list has no per-row time)
  endTime?: string;   // "HH:MM"
  bookingUrl: string;
  availableSeats?: number;
}

const CM_API_BASE = "https://cm-api.alliance-francaise.ca/groupcourses";
const ACTIVE_API_BASE = "https://anc.ca.apm.activecommunities.com/aftoronto/rest/activity/detail";
const AC_LIST_API = "https://anc.ca.apm.activecommunities.com/aftoronto/rest/activities/list?locale=en-US";
const BOOKING_BASE = "https://anc.ca.apm.activecommunities.com/aftoronto/activity/search/detail";

const CM_CATEGORY_PTCF = 368; // paper-based (CM-only)
const AC_CATEGORY_ETCF = "30"; // computer-based (Active Communities)

// Statuses that mean "not bookable", checked against the detail API's space_status.
const NON_BOOKABLE = ["Full", "On Hold", "Closed", "Cancelled"];
// List-level pre-filter (urgent_message.status_description) to skip the obvious
// full sittings before spending a detail call confirming each one.
const CLOSED_LIST_STATUS = /full|closed|cancel|wait\s*list|sold\s*out/i;

// Node's fetch sends no User-Agent by default, which trips the CM API's WAF from
// datacenter IPs (it answers 200 with an HTML interstitial instead of JSON). A
// real browser UA + Accept header gets past the soft challenge.
const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-CA,en;q=0.9",
};

// GET a URL expecting JSON, with retry + a legible error on persistent non-JSON
// (the WAF interstitial) instead of an opaque "Unexpected token '<'".
async function fetchJson<T>(url: string, label: string): Promise<T> {
  const MAX_ATTEMPTS = 3;
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let body = "";
    let status = 0;
    let contentType = "?";
    try {
      const res = await fetch(url, { headers: BROWSER_HEADERS });
      status = res.status;
      contentType = res.headers.get("content-type") ?? "?";
      body = await res.text();
    } catch (err) {
      lastErr = new Error(`${label}: network error — ${(err as Error).message}`);
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

// ----- P-TCF: CM API list -----

interface DatePattern {
  activity_start_date: string; // "YYYY-MM-DD"
  activity_start_time: string; // "HH:MM:SS"
  activity_end_time: string;   // "HH:MM:SS"
}
interface CMSession {
  id: number;
  name: string;
  start_date: string;
  date_patterns: DatePattern[];
}
interface CMResponse {
  items: CMSession[];
}

async function fetchCmSessions(category: number): Promise<CMSession[]> {
  const url =
    `${CM_API_BASE}?enddate=gte&limit=150&openspaces=1&orderby=course.startDate` +
    `&othercategory=${category}&status=0`;
  const data = await fetchJson<CMResponse>(url, `CM API category ${category}`);
  return data.items ?? [];
}

// ----- E-TCF: Active Communities list -----

interface AcItem {
  id: number;
  name: string;
  number: string;
  statusDescription: string;
  alreadyEnrolled: number;
  totalOpen: number;
}

async function fetchAcCategory(catId: string): Promise<AcItem[]> {
  const out: AcItem[] = [];
  let page = 1;
  let totalPage = 1;
  do {
    const page_info = JSON.stringify({ order_by: "", page_number: page, total_records_per_page: 20 });
    const reqBody = JSON.stringify({
      activity_search_pattern: {
        skills: [], time_after_str: "", days_of_week: null, activity_select_param: 2,
        center_ids: [], time_before_str: "", open_spots: null, activity_id: null,
        activity_category_ids: [catId], date_before: "", min_age: null, date_after: "",
        activity_type_ids: [], site_ids: [], for_map: false, geographic_area_ids: [],
        season_ids: [], activity_department_ids: [], activity_other_category_ids: [],
        child_season_ids: [], activity_keyword: "", instructor_ids: [], max_age: null,
        custom_price_from: "", custom_price_to: "",
      },
      activity_transfer_pattern: {},
    });

    const res = await fetch(AC_LIST_API, {
      method: "POST",
      headers: { ...BROWSER_HEADERS, "Content-Type": "application/json", page_info },
      body: reqBody,
    });
    const text = await res.text();
    const trimmed = text.trimStart();
    if (!res.ok || !trimmed.startsWith("{")) {
      throw new Error(
        `AC list category ${catId}: non-JSON/HTTP ${res.status} — likely a bot/WAF challenge: ${trimmed.slice(0, 80)}…`,
      );
    }
    const json = JSON.parse(trimmed);
    const items = json?.body?.activity_items ?? [];
    for (const it of items) {
      out.push({
        id: it.id,
        name: it.name ?? "",
        number: it.number ?? "",
        statusDescription: it.urgent_message?.status_description ?? "",
        alreadyEnrolled: it.already_enrolled ?? 0,
        totalOpen: it.total_open ?? 0,
      });
    }
    totalPage = json?.headers?.page_info?.total_page ?? 1;
    page++;
  } while (page <= totalPage && page <= 10);
  return out;
}

// Decode the exam date from an Active Communities activity number, e.g.
// "TCFC040926-MS" -> 04/09/26 (DD MM YY) -> "2026-09-04".
function dateFromAcNumber(number: string): string | null {
  const m = number.match(/TCFC(\d{2})(\d{2})(\d{2})/i);
  if (!m) return null;
  const [, dd, mm, yy] = m;
  return `20${yy}-${mm}-${dd}`;
}

// ----- Shared availability confirmation (Active Communities detail) -----

interface AcDetail {
  spaceStatus: string;
  firstDate?: string;
}

async function fetchAcDetail(id: number): Promise<AcDetail | null> {
  const url = `${ACTIVE_API_BASE}/${id}?locale=en-US`;
  const res = await fetch(url, { headers: BROWSER_HEADERS });
  if (!res.ok) {
    console.warn(`  [toronto] Active detail API returned ${res.status} for ${id}`);
    return null;
  }
  // Guard against the same non-JSON WAF interstitial — treat as unknown (caller
  // decides), don't throw the whole scrape.
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    console.warn(`  [toronto] Active detail API non-JSON for ${id} — skipping`);
    return null;
  }
  const detail = data?.body?.detail;
  if (!detail) return null;
  return { spaceStatus: detail.space_status ?? "", firstDate: detail.first_date };
}

function isBookable(detail: AcDetail | null): boolean {
  // No/garbled detail → conservatively treat as not bookable (false negative
  // beats a false ping or a thrown scrape).
  if (!detail) return false;
  return !NON_BOOKABLE.includes(detail.spaceStatus);
}

function toHHMM(time: string): string {
  return time.slice(0, 5);
}

// A bookable candidate awaiting detail confirmation.
interface Candidate {
  id: number;
  examType: ExamType;
  date: string;
  startTime?: string;
  endTime?: string;
  availableSeats?: number;
  bookingUrl: string;
}

export async function scrapeToronto(): Promise<Slot[]> {
  // Gather candidates from both sources in parallel.
  const [ptcfSessions, etcfItems] = await Promise.all([
    fetchCmSessions(CM_CATEGORY_PTCF),
    fetchAcCategory(AC_CATEGORY_ETCF),
  ]);

  // P-TCF: every CM session (already openspaces-filtered) is a candidate.
  const ptcfCandidates: Candidate[] = ptcfSessions.map((s) => {
    const pattern = s.date_patterns?.[0];
    return {
      id: s.id,
      examType: "P-TCF Canada",
      date: pattern?.activity_start_date ?? s.start_date.slice(0, 10),
      startTime: pattern ? toHHMM(pattern.activity_start_time) : undefined,
      endTime: pattern ? toHHMM(pattern.activity_end_time) : undefined,
      bookingUrl: `${BOOKING_BASE}/${s.id}`,
    };
  });

  // E-TCF: drop the obviously-full sittings up front (status_description), keep
  // the rest as candidates to confirm via detail. In steady state every sitting
  // is "Full", so this is usually empty.
  const etcfOpen = etcfItems.filter((it) => !CLOSED_LIST_STATUS.test(it.statusDescription));
  const etcfCandidates: Candidate[] = etcfOpen.map((it) => {
    const seats = it.totalOpen - it.alreadyEnrolled;
    return {
      id: it.id,
      examType: "E-TCF Canada",
      date: dateFromAcNumber(it.number) ?? it.number,
      availableSeats: seats > 0 ? seats : undefined,
      bookingUrl: `${BOOKING_BASE}/${it.id}`,
    };
  });

  console.log(
    `[toronto] P-TCF: ${ptcfSessions.length} CM session(s) | ` +
      `E-TCF: ${etcfItems.length} AC sitting(s), ${etcfOpen.length} not-full — confirming availability...`,
  );
  if (etcfOpen.length > 0) {
    console.log(
      `  [toronto:etcf-candidate] ${etcfOpen
        .map((it) => `${it.number}(${it.statusDescription || "no-status"} ${it.alreadyEnrolled}/${it.totalOpen})`)
        .join(", ")}`,
    );
  }

  const candidates = [...ptcfCandidates, ...etcfCandidates];
  const slots: Slot[] = [];

  // Confirm availability against the detail API, concurrency-capped.
  const CONCURRENCY = 5;
  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    const batch = candidates.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (c) => ({ c, detail: await fetchAcDetail(c.id) })),
    );
    for (const { c, detail } of results) {
      if (!isBookable(detail)) {
        if (detail && c.examType === "E-TCF Canada") {
          console.log(`  [toronto] E-TCF ${c.id} not bookable (space_status: "${detail.spaceStatus}")`);
        }
        continue;
      }
      // For E-TCF, prefer the authoritative detail date when present.
      const date = c.examType === "E-TCF Canada" && detail?.firstDate ? detail.firstDate : c.date;
      if (c.examType === "E-TCF Canada") {
        console.log(`  [toronto:OPEN] E-TCF ${c.id} bookable — date=${date} space_status="${detail?.spaceStatus}"`);
      }
      slots.push({
        id: String(c.id),
        examType: c.examType,
        date,
        startTime: c.startTime,
        endTime: c.endTime,
        bookingUrl: c.bookingUrl,
        availableSeats: c.availableSeats,
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
          const time = s.startTime && s.endTime ? ` — ${s.startTime} to ${s.endTime}` : "";
          const seats = s.availableSeats != null ? ` (${s.availableSeats} seats)` : "";
          console.log(`  [${s.examType}] ${s.date}${time}${seats}`);
          console.log(`  ${s.bookingUrl}\n`);
        }
      }
    })
    .catch((err) => {
      console.error("[toronto] Error:", err);
      process.exit(1);
    });
}
