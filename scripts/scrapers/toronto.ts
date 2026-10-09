// Toronto has two independently monitored exam types, discovered through the
// official registration page's CM categories: 367 computer and 368 paper.
// AC search exposes parent aggregates that can show openings but have no bookable
// sub-activities. Confirm actual CM candidates against AC child activity details;
// unknown discovery/detail fails its exam type and preserves the previous state.

export type ExamType = "E-TCF Canada" | "P-TCF Canada";

// A known upstream challenge, not a successful availability snapshot. Only the
// CM paper-list request can produce this type; callers must still preserve state.
export class TorontoPaperChallengeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TorontoPaperChallengeError";
  }
}

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
const BOOKING_BASE = "https://anc.ca.apm.activecommunities.com/aftoronto/activity/search/detail";
const CM_CATEGORY_PTCF = 368;
const CM_CATEGORY_ETCF = 367;
const CLOSED_STATUS = /full|on\s*hold|closed|cancel|wait\s*list|sold\s*out|not\s+(?:yet\s+)?open/i;

// Identify the monitor honestly. On 2026-10-06 the old fixed Chrome/124 UA
// consistently received CM HTTP 403, while this UA received JSON without cookies.
// Access can change; failures still remain explicit rather than becoming [].
const REQUEST_HEADERS = {
  "User-Agent": "TCF-Slot-Monitor/1.0 (+https://github.com/Hengag999/tcf-slot-monitor)",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-CA,en;q=0.9",
};

type NonJsonClassification = "unclassified" | "siteground-challenge" | "cloudflare-challenge" | "access-challenge-signature";

function classifyNonJsonResponse(res: Response, body: string): NonJsonClassification {
  if (res.headers.has("sg-captcha") || /\/\.well-known\/(?:sgcaptcha|captcha)(?:[\s/?#"'<>]|$)/i.test(body)) {
    return "siteground-challenge";
  }
  if (res.headers.get("cf-mitigated") === "challenge" || /\/cdn-cgi\/challenge-platform\//i.test(body)) return "cloudflare-challenge";
  if (/<title[^>]*>\s*(?:captcha|access denied|just a moment|security check|verify you are human)\b/i.test(body)) return "access-challenge-signature";
  return "unclassified";
}

// Only fixed classifications and numeric metadata reach logs. Never print the
// response body, cookies, arbitrary header values, or challenge tokens.
function nonJsonDiagnostics(res: Response, body: string, classification: NonJsonClassification): string {
  const details = [`classification=${classification}`, `bodyChars=${body.length}`];
  const server = res.headers.get("server")?.toLowerCase();
  if (server && ["nginx", "cloudflare", "apache"].includes(server)) details.push(`server=${server}`);
  const cache = res.headers.get("x-proxy-cache")?.toUpperCase();
  if (cache && ["HIT", "MISS", "BYPASS", "EXPIRED", "STALE"].includes(cache)) details.push(`proxyCache=${cache}`);
  const retryAfter = res.headers.get("retry-after");
  if (retryAfter && /^\d{1,8}$/.test(retryAfter)) details.push(`retryAfterSeconds=${Number(retryAfter)}`);
  return details.join(", ");
}

async function fetchJson<T>(
  url: string,
  label: string,
  init: RequestInit = {},
  options: { classifyTorontoPaperChallenge?: boolean } = {},
): Promise<T> {
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
          const classification = classifyNonJsonResponse(res, body);
          const message = `${label}: non-JSON response (HTTP ${res.status}, ${typeLabel}; ${nonJsonDiagnostics(res, body, classification)})`;
          // Scope the policy hook to the exact observed paper-list failure. Other
          // sources, statuses, content types, and unrecognized HTML remain errors.
          error = options.classifyTorontoPaperChallenge && res.status === 202 && contentType === "text/html" && classification === "siteground-challenge"
            ? new TorontoPaperChallengeError(message) : new Error(message);
          // A recognized access challenge does not benefit from rapid retries.
          // Preserve the snapshot and let the next scheduled check try again.
          if (error instanceof TorontoPaperChallengeError) retryable = false;
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
  name: string;
  status: number;
  open_spaces: number;
  other_category: { id: number };
  start_date?: string;
  date_patterns?: DatePattern[];
}

async function fetchCmSessions(category: number, examType: ExamType): Promise<CMSession[]> {
  // Match the public registration page's query, then require a complete response.
  // A successful JSON error or truncated list must not become an empty snapshot.
  const url = `${CM_API_BASE}?enddate=gte&limit=300&openspaces=1&orderby=course.startDate&othercategory=${category}&status=0`;
  const data = await fetchJson<{ items: CMSession[]; page: number; totalItems: number; limit: string | number }>(
    url, `CM API category ${category}`, {}, { classifyTorontoPaperChallenge: category === CM_CATEGORY_PTCF },
  );
  if (!Array.isArray(data?.items)) throw new Error(`CM ${examType} list: missing items array`);
  if (data.page !== 1 || !Number.isInteger(data.totalItems) || data.totalItems < 0
    || ![300, "300"].includes(data.limit) || data.items.length !== data.totalItems || data.items.length >= 300) {
    throw new Error(`CM ${examType} list: incomplete or invalid pagination; availability unknown`);
  }
  const expectedName = examType === "E-TCF Canada" ? /^E[-\s]*TCF\b/i : /^P[-\s]*TCF\b/i;
  for (const session of data.items) {
    if (!Number.isInteger(session?.id) || session.id <= 0 || typeof session.name !== "string"
      || !expectedName.test(session.name) || session.other_category?.id !== category
      || session.status !== 0 || !Number.isInteger(session.open_spaces) || session.open_spaces <= 0) {
      throw new Error(`CM ${examType} list: malformed or unexpected session; availability unknown`);
    }
  }
  if (new Set(data.items.map(session => session.id)).size !== data.items.length) {
    throw new Error(`CM ${examType} list: duplicate sessions; availability unknown`);
  }
  return data.items;
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
    throw new Error(`CM list: invalid session time ${JSON.stringify(value)}`);
  }
  return `${match[1].padStart(2, "0")}:${match[2]}`;
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
      detail.activity_id !== id || typeof detail.is_parent_activity !== "boolean") {
    throw new Error(`AC detail ${id}: missing or invalid availability; preserving this exam type's previous state`);
  }
  if (detail.is_parent_activity) {
    throw new Error(`AC detail ${id}: parent aggregate is not a verified bookable sitting; availability unknown`);
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
      const count = detail.spaceStatus.match(/^(\d+)\s+(?:openings?|spaces?|spots?|seats?)(?:\s+(?:available|remaining))?$/i);
      return {
        ...candidate,
        id: String(candidate.id),
        date,
        bookingUrl: `${BOOKING_BASE}/${candidate.id}`,
        availableSeats: count ? Number(count[1]) : undefined,
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

async function scrapeTorontoFormat(category: number, examType: ExamType, label: string): Promise<Slot[]> {
  const sessions = await fetchCmSessions(category, examType);
  console.log(`[toronto:${label}] ${sessions.length} CM session(s)`);
  return confirmCandidates(sessions.map((session) => {
    const pattern = session.date_patterns?.[0];
    return {
      id: session.id,
      examType,
      date: pattern?.activity_start_date ?? session.start_date?.slice(0, 10),
      startTime: toHHMM(pattern?.activity_start_time),
      endTime: toHHMM(pattern?.activity_end_time),
    };
  }));
}

export async function scrapeTorontoComputer(): Promise<Slot[]> {
  return scrapeTorontoFormat(CM_CATEGORY_ETCF, "E-TCF Canada", "computer");
}

export async function scrapeTorontoPaper(): Promise<Slot[]> {
  return scrapeTorontoFormat(CM_CATEGORY_PTCF, "P-TCF Canada", "paper");
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
