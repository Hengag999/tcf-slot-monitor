// Toronto has two independently monitored exam types. Computer sessions use
// Active Communities category 30; paper sessions still use CM category 368.
// A CM failure must not disable the computer source. Both confirm candidates
// against Active Communities detail; unknown detail fails that exam type so the
// orchestrator can preserve its previous state instead of recording a false zero.

export type ExamType = "E-TCF Canada" | "P-TCF Canada";

export interface Slot {
  id: string;
  examType: ExamType;
  date: string; // YYYY-MM-DD
  startTime?: string;
  endTime?: string;
  bookingUrl: string;
  availableSeats?: number;
}

const CM_API_BASE = "https://cm-api.alliance-francaise.ca/groupcourses";
const ACTIVE_API_BASE = "https://anc.ca.apm.activecommunities.com/aftoronto/rest/activity/detail";
const AC_LIST_API = "https://anc.ca.apm.activecommunities.com/aftoronto/rest/activities/list?locale=en-US";
const BOOKING_BASE = "https://anc.ca.apm.activecommunities.com/aftoronto/activity/search/detail";
const CM_CATEGORY_PTCF = 368;
const AC_CATEGORY_ETCF = "30";
const CLOSED_STATUS = /full|on\s*hold|closed|cancel|wait\s*list|sold\s*out|not\s+(?:yet\s+)?open/i;

// Identify the monitor honestly. On 2026-10-06 the old fixed Chrome/124 UA
// consistently received CM HTTP 403, while this UA received JSON without cookies.
// Access can change; failures still remain explicit rather than becoming [].
const REQUEST_HEADERS = {
  "User-Agent": "TCF-Slot-Monitor/1.0 (+https://github.com/Hengag999/tcf-slot-monitor)",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-CA,en;q=0.9",
};

// Only fixed classifications and numeric metadata reach logs. Never print the
// response body, cookies, arbitrary header values, or challenge tokens.
function nonJsonDiagnostics(res: Response, body: string): string {
  let classification = "unclassified";
  if (res.headers.has("sg-captcha") || /\/\.well-known\/(?:sgcaptcha|captcha)(?:[\s/?#"'<>]|$)/i.test(body)) {
    classification = "siteground-challenge";
  } else if (res.headers.get("cf-mitigated") === "challenge" || /\/cdn-cgi\/challenge-platform\//i.test(body)) {
    classification = "cloudflare-challenge";
  } else if (/<title[^>]*>\s*(?:captcha|access denied|just a moment|security check|verify you are human)\b/i.test(body)) {
    classification = "access-challenge-signature";
  }
  const details = [`classification=${classification}`, `bodyChars=${body.length}`];
  const server = res.headers.get("server")?.toLowerCase();
  if (server && ["nginx", "cloudflare", "apache"].includes(server)) details.push(`server=${server}`);
  const cache = res.headers.get("x-proxy-cache")?.toUpperCase();
  if (cache && ["HIT", "MISS", "BYPASS", "EXPIRED", "STALE"].includes(cache)) details.push(`proxyCache=${cache}`);
  const retryAfter = res.headers.get("retry-after");
  if (retryAfter && /^\d{1,8}$/.test(retryAfter)) details.push(`retryAfterSeconds=${Number(retryAfter)}`);
  return details.join(", ");
}

async function fetchJson<T>(url: string, label: string, init: RequestInit = {}): Promise<T> {
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let error: Error;
    let retryable = true;
    try {
      const res = await fetch(url, {
        ...init,
        headers: { ...REQUEST_HEADERS, ...init.headers },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        error = new Error(`${label}: HTTP ${res.status}`);
        // Repeating a denied or nonexistent request does not restore coverage.
        retryable = res.status === 429 || res.status >= 500;
      } else {
        const body = await res.text();
        try {
          return JSON.parse(body) as T;
        } catch {
          const contentType = res.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
          const typeLabel = contentType && ["text/html", "text/plain", "application/json"].includes(contentType)
            ? contentType : "unknown content type";
          error = new Error(`${label}: non-JSON response (HTTP ${res.status}, ${typeLabel}; ${nonJsonDiagnostics(res, body)})`);
        }
      }
    } catch (err) {
      error = new Error(`${label}: request failed — ${(err as Error).message}`);
    }
    if (!retryable || attempt === MAX_ATTEMPTS) throw error;
    console.warn(`  [toronto] ${error.message} — retry ${attempt}/${MAX_ATTEMPTS - 1}`);
    await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
  }
  throw new Error(`${label}: failed`);
}

interface DatePattern {
  activity_start_date: string;
  activity_start_time?: string;
  activity_end_time?: string;
}
interface CMSession {
  id: number;
  start_date?: string;
  date_patterns?: DatePattern[];
}

async function fetchCmSessions(): Promise<CMSession[]> {
  const url = `${CM_API_BASE}?enddate=gte&limit=300&openspaces=1&orderby=course.startDate&othercategory=${CM_CATEGORY_PTCF}&status=0`;
  const data = await fetchJson<{ items: CMSession[] }>(url, `CM API category ${CM_CATEGORY_PTCF}`);
  if (!Array.isArray(data?.items)) throw new Error("CM paper list: missing items array");
  // The public client requests 300. At the limit, completeness is unknown.
  if (data.items.length >= 300) throw new Error("CM paper list reached its 300-row limit; refusing an incomplete snapshot");
  return data.items;
}

interface AcItem {
  id: number;
  name: string;
  number: string;
  statusDescription: string;
  alreadyEnrolled?: number;
  totalOpen?: number;
}

async function fetchAcCategory(): Promise<AcItem[]> {
  const out: AcItem[] = [];
  let totalPages = 1;
  let totalRecords = 0;
  for (let page = 1; page <= totalPages; page++) {
    const page_info = JSON.stringify({ order_by: "", page_number: page, total_records_per_page: 20 });
    const json = await fetchJson<any>(AC_LIST_API, `AC list category ${AC_CATEGORY_ETCF} page ${page}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", page_info },
      body: JSON.stringify({
        activity_search_pattern: {
          skills: [], time_after_str: "", days_of_week: null, activity_select_param: 2,
          center_ids: [], time_before_str: "", open_spots: null, activity_id: null,
          activity_category_ids: [AC_CATEGORY_ETCF], date_before: "", min_age: null, date_after: "",
          activity_type_ids: [], site_ids: [], for_map: false, geographic_area_ids: [],
          season_ids: [], activity_department_ids: [], activity_other_category_ids: [],
          child_season_ids: [], activity_keyword: "", instructor_ids: [], max_age: null,
          custom_price_from: "", custom_price_to: "",
        },
        activity_transfer_pattern: {},
      }),
    });
    const items = json?.body?.activity_items;
    const info = json?.headers?.page_info;
    if (json?.headers?.response_code !== "0000" || !Array.isArray(items) ||
        !Number.isInteger(info?.total_page) || info.total_page < 1 || info.total_page > 50 ||
        !Number.isInteger(info.total_records) || info.total_records < 0 || info.page_number !== page) {
      throw new Error(`AC computer list page ${page}: invalid response or pagination; availability unknown`);
    }
    if (page > 1 && (info.total_page !== totalPages || info.total_records !== totalRecords)) {
      throw new Error("AC computer list changed during pagination; refusing an incomplete snapshot");
    }
    totalPages = info.total_page;
    totalRecords = info.total_records;
    for (const item of items) {
      if (!Number.isInteger(item?.id) || item.id <= 0 || typeof item.name !== "string" || typeof item.number !== "string" ||
          typeof item.urgent_message?.status_description !== "string") {
        throw new Error(`AC computer list page ${page}: malformed activity`);
      }
      out.push({
        id: item.id,
        name: item.name,
        number: item.number,
        statusDescription: item.urgent_message.status_description,
        alreadyEnrolled: item.already_enrolled,
        totalOpen: item.total_open,
      });
    }
  }
  if (out.length !== totalRecords || new Set(out.map((item) => item.id)).size !== out.length) {
    throw new Error("AC computer list is incomplete or contains duplicate activities");
  }
  return out;
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function toHHMM(value: string | undefined): string | undefined {
  if (value == null) return undefined;
  const match = value.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
    throw new Error(`CM paper list: invalid session time ${JSON.stringify(value)}`);
  }
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function dateFromAcNumber(number: string): string | undefined {
  const match = number.match(/TCFC(\d{2})(\d{2})(\d{2})/i);
  if (!match) return undefined;
  const date = `20${match[3]}-${match[2]}-${match[1]}`;
  return validDate(date) ? date : undefined;
}

interface AcDetail {
  spaceStatus: string;
  firstDate?: string;
}

async function fetchAcDetail(id: number): Promise<AcDetail> {
  const data = await fetchJson<any>(`${ACTIVE_API_BASE}/${id}?locale=en-US`, `AC detail ${id}`);
  const detail = data?.body?.detail;
  if (data?.headers?.response_code !== "0000" || !detail ||
      typeof detail.space_status !== "string" || !detail.space_status.trim() ||
      (detail.activity_id != null && detail.activity_id !== id)) {
    throw new Error(`AC detail ${id}: missing or invalid availability; preserving this exam type's previous state`);
  }
  return { spaceStatus: detail.space_status.trim(), firstDate: detail.first_date };
}

function isBookable(detail: AcDetail): boolean {
  if (CLOSED_STATUS.test(detail.spaceStatus)) return false;
  const count = detail.spaceStatus.match(/^(\d+)\s+(?:openings?|spaces?|spots?|seats?)(?:\s+(?:available|remaining))?$/i);
  if (count) return Number(count[1]) > 0;
  // Unlimited openings was observed in current AC details. Numeric openings and
  // explicit Open/Available are supported; unfamiliar wording is not a vacancy.
  if (/^(?:unlimited openings|open|available)$/i.test(detail.spaceStatus)) return true;
  throw new Error(`AC detail has unknown availability status: ${JSON.stringify(detail.spaceStatus)}`);
}

interface Candidate {
  id: number;
  examType: ExamType;
  date?: string;
  startTime?: string;
  endTime?: string;
  availableSeats?: number;
}

async function confirmCandidates(candidates: Candidate[]): Promise<Slot[]> {
  const slots: Slot[] = [];
  const CONCURRENCY = 5;
  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    // Any unknown candidate fails this entire exam type; never return a partial
    // snapshot that would clear a previously observed vacancy in persistence.
    const results = await Promise.allSettled(candidates.slice(i, i + CONCURRENCY).map(async (candidate) => {
      const detail = await fetchAcDetail(candidate.id);
      if (!isBookable(detail)) return null;
      const date = validDate(detail.firstDate) ? detail.firstDate : candidate.date;
      if (!validDate(date)) throw new Error(`AC detail ${candidate.id}: no valid exam date`);
      return {
        ...candidate,
        id: String(candidate.id),
        date,
        bookingUrl: `${BOOKING_BASE}/${candidate.id}`,
      } satisfies Slot;
    }));
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length) {
      throw new AggregateError(failures.map((result) => result.reason),
        `${candidates[i].examType}: ${failures.length} detail check(s) failed; availability unknown`);
    }
    for (const result of results) {
      if (result.status === "fulfilled" && result.value) slots.push(result.value);
    }
  }
  return slots;
}

export async function scrapeTorontoComputer(): Promise<Slot[]> {
  const items = await fetchAcCategory();
  // Category 30 is TCF generally: CM paper records also reference it. Do not
  // mislabel paper sessions if they become visible in the AC listing.
  const computer = items.filter((item) => {
    if (/^E[-\s]*TCF\b/i.test(item.name)) return true;
    if (/^P[-\s]*TCF\b/i.test(item.name)) return false;
    throw new Error(`AC TCF category has an unrecognized product: ${JSON.stringify(item.name)}`);
  });
  const candidates = computer.filter((item) => !CLOSED_STATUS.test(item.statusDescription));
  console.log(`[toronto:computer] ${computer.length} E-TCF sitting(s) of ${items.length} TCF row(s), ${candidates.length} candidate(s)`);
  return confirmCandidates(candidates.map((item) => {
    const seats = (item.totalOpen ?? NaN) - (item.alreadyEnrolled ?? NaN);
    return {
      id: item.id,
      examType: "E-TCF Canada",
      date: dateFromAcNumber(item.number),
      availableSeats: Number.isInteger(seats) && seats > 0 ? seats : undefined,
    };
  }));
}

export async function scrapeTorontoPaper(): Promise<Slot[]> {
  const sessions = await fetchCmSessions();
  console.log(`[toronto:paper] ${sessions.length} CM session(s)`);
  return confirmCandidates(sessions.map((session) => {
    if (!Number.isInteger(session?.id) || session.id <= 0) throw new Error("CM paper list: malformed session ID");
    const pattern = session.date_patterns?.[0];
    return {
      id: session.id,
      examType: "P-TCF Canada",
      date: pattern?.activity_start_date ?? session.start_date?.slice(0, 10),
      startTime: toHHMM(pattern?.activity_start_time),
      endTime: toHHMM(pattern?.activity_end_time),
    };
  }));
}

const sources = [
  { label: "E-TCF Canada", scrape: scrapeTorontoComputer },
  { label: "P-TCF Canada", scrape: scrapeTorontoPaper },
];

// Retained for callers that require complete Toronto coverage. The orchestrator
// uses the independent exports and scopes each result to its own exam type.
export async function scrapeToronto(): Promise<Slot[]> {
  const results = await Promise.allSettled(sources.map((source) => source.scrape()));
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length) throw new AggregateError(failures.map((result) => result.reason), "Toronto coverage is incomplete");
  return results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
}

// Standalone dry-run: report every source, including healthy results when one
// fails, then exit nonzero to make incomplete coverage visible to automation.
if (process.argv[1]?.endsWith("/toronto.ts")) {
  void Promise.allSettled(sources.map((source) => source.scrape())).then((results) => {
    for (const [index, result] of results.entries()) {
      const label = sources[index].label;
      if (result.status === "rejected") {
        console.error(`[toronto] ${label}: FAILED — availability unknown`, result.reason);
        process.exitCode = 1;
        continue;
      }
      console.log(`[toronto] ${label}: ${result.value.length} available slot(s)`);
      for (const slot of result.value) {
        const time = slot.startTime && slot.endTime ? ` — ${slot.startTime} to ${slot.endTime}` : "";
        const seats = slot.availableSeats != null ? ` (${slot.availableSeats} seats)` : "";
        console.log(`  ${slot.date}${time}${seats}\n  ${slot.bookingUrl}`);
      }
    }
  });
}
