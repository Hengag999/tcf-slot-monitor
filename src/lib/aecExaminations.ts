// AEC's public widget calls /list/{establishmentBranchId}/{examinationTypeIds}.
// The arguments are not a page number and page size; each response contains all
// sittings for the requested type. Keep malformed snapshots out of persistence.

export interface AecSlot {
  id: string;
  examType: string;
  date: string;
  startTime: string;
  endTime: string;
  bookingUrl: string;
}

export interface AecExamType {
  id: number;
  name: string;
}

export interface AecSource {
  label: string;
  baseUrl: string;
  branchId: number;
  examTypes: AecExamType[];
  bookingOrigins: string[];
  // Opt in only where observed server failures justify bounded GET retries.
  retryServerErrors?: boolean;
  // Halifax and Ottawa have returned HTTP 522 while discovering the public key.
  retryKeyPage522?: boolean;
}

// Only an exhausted, confirmed key-page HTTP 522 can enter the approved grace.
// Network exceptions, other responses, key parsing and inventory errors cannot.
export class AecKeyPage522Error extends Error {
  constructor(readonly origin: string, label: string) {
    super(`${label}: failed to fetch page for API key (522)`);
    this.name = "AecKeyPage522Error";
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validTime(value: unknown): value is string {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(value);
}

export function parseAecExaminations(body: string, status: number, source: AecSource, type: AecExamType): AecSlot[] {
  const fail = (reason: string): never => {
    throw new Error(`${source.label}: invalid examinations response for type ${type.id}: ${reason}`);
  };
  // AEC uses a real 204 for some empty listings. A blank 200 or an error object
  // must not be interpreted as all previously available sessions disappearing.
  if (status === 204) return [];
  if (body.trim() === "") return fail("empty body without HTTP 204");
  let data: unknown;
  try { data = JSON.parse(body); } catch { return fail("malformed JSON"); }
  if (!Array.isArray(data)) return fail("expected examination type array");

  const slots: AecSlot[] = [];
  const ids = new Set<number>();
  for (const group of data) {
    if (!object(group) || group.IDETABLISHMENT_BRANCH !== source.branchId || group.IDEXAMINATION_TYPE !== type.id || group.name !== type.name) {
      return fail("unexpected branch or examination type");
    }
    if (!Array.isArray(group.examinations)) return fail("missing examinations array");
    for (const exam of group.examinations) {
      if (!object(exam) || exam.IDETABLISHMENT_BRANCH !== source.branchId || exam.IDEXAMINATION_TYPE !== type.id || exam.product_name !== type.name) {
        return fail("unexpected examination identity");
      }
      const id = exam.IDEXAMINATION;
      if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0 || ids.has(id)) return fail("invalid or duplicate examination ID");
      ids.add(id);
      if (!validDate(exam.examination_date) || !validTime(exam.start_time) || !validTime(exam.end_time)) return fail("invalid examination date or time");
      if (typeof exam.isFull !== "boolean" || typeof exam.inscriptionIsInFuture !== "boolean") return fail("unknown availability flags");
      const registration = exam.mainRegisterLink;
      if (!object(registration) || typeof registration.link !== "string" || typeof registration.label !== "string") return fail("missing registration status");

      if (exam.isFull || exam.inscriptionIsInFuture) {
        if (registration.link !== "") return fail("registration link conflicts with closed availability");
        continue;
      }
      if (registration.link === "") {
        if (registration.label === "kiosque_examination_enrollment_date_over") continue;
        return fail("unrecognized disabled registration status");
      }
      let booking: URL;
      try { booking = new URL(registration.link); } catch { return fail("invalid registration URL"); }
      if (booking.protocol !== "https:" || !source.bookingOrigins.includes(booking.origin) || booking.username || booking.password || booking.hash !== `#/addExamination/${id}` || registration.label !== "add_to_cart") {
        return fail("unexpected registration destination");
      }
      slots.push({
        id: String(id), examType: type.name, date: exam.examination_date,
        startTime: exam.start_time.slice(0, 5), endTime: exam.end_time.slice(0, 5), bookingUrl: booking.href,
      });
    }
  }
  return slots;
}

export async function scrapeAecExaminations(
  source: AecSource,
  fetchImpl: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
): Promise<AecSlot[]> {
  const pageAttempts = source.retryKeyPage522 ? 3 : 1;
  let page!: Response;
  for (let attempt = 1; attempt <= pageAttempts; attempt++) {
    page = await fetchImpl(`${source.baseUrl}/`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; tcf-slot-monitor/1.0)" },
      signal: AbortSignal.timeout(20_000), redirect: "error",
    });
    if (page.status !== 522 || attempt === pageAttempts) break;
    await page.body?.cancel().catch(() => {});
    console.warn(`[${source.label}] API-key page: HTTP 522; retry ${attempt}/${pageAttempts - 1}`);
    await sleep(attempt * 1000);
  }
  if (page.status === 522 && source.retryKeyPage522) throw new AecKeyPage522Error(source.baseUrl, source.label);
  if (!page.ok) throw new Error(`${source.label}: failed to fetch page for API key (${page.status})`);
  const match = (await page.text()).match(/"APIKEY":"([^"]+)"/);
  if (!match) throw new Error(`${source.label}: APIKEY not found in page source`);

  const groups = await Promise.all(source.examTypes.map(async (type) => {
    const url = `${source.baseUrl}/api/v1/public/examinations/list/${source.branchId}/${type.id}?allBranches=N&CURRENT_LANG=en_US`;
    const attempts = source.retryServerErrors ? 3 : 1;
    let response!: Response;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      response = await fetchImpl(url, {
        headers: { API_KEY: match[1], CURRENT_LANG: "en_US" },
        signal: AbortSignal.timeout(20_000), redirect: "error",
      });
      if (![500, 502, 503, 504].includes(response.status) || attempt === attempts) break;
      // Release the discarded body. Cleanup must not obscure the HTTP failure.
      await response.body?.cancel().catch(() => {});
      console.warn(`[${source.label}] examinations type ${type.id}: HTTP ${response.status}; retry ${attempt}/${attempts - 1}`);
      await sleep(attempt * 1000);
    }
    // Validation and non-server errors are not retried or treated as empty data.
    if (!response.ok) throw new Error(`${source.label}: examinations API returned ${response.status} for type ${type.id}`);
    return parseAecExaminations(await response.text(), response.status, source, type);
  }));
  return groups.flat();
}
