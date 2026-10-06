import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { scrapeToronto, scrapeTorontoComputer, scrapeTorontoPaper } from "../scripts/scrapers/toronto";

const item = (id = 129462, status = "Full", number = "TCFC091026-MS") => ({
  id, number, name: "E-TCF CANADA - 4 modules",
  urgent_message: { status_description: status }, already_enrolled: 14, total_open: 14,
});
const list = (items: ReturnType<typeof item>[], page = 1, pages = 1, total = items.length) => ({
  headers: { response_code: "0000", page_info: { page_number: page, total_page: pages, total_records: total } },
  body: { activity_items: items },
});
const detail = (id: number, status: string, date = "2026-10-09") => ({
  headers: { response_code: "0000" },
  body: { detail: { activity_id: id, space_status: status, first_date: date } },
});
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "content-type": "application/json" },
});
const replaceFetch = (handler: (url: string, init?: RequestInit) => Response | Promise<Response>) =>
  mock.method(globalThis, "fetch", async (input, init) => handler(String(input), init));

afterEach(() => mock.restoreAll());

test("CM 403 does not prevent independent computer monitoring", async () => {
  replaceFetch((url) => url.includes("cm-api") ? response({}, 403) : response(list([item()])));
  const [computer, paper] = await Promise.allSettled([scrapeTorontoComputer(), scrapeTorontoPaper()]);
  assert.deepEqual(computer, { status: "fulfilled", value: [] });
  assert.equal(paper.status, "rejected");
  if (paper.status === "rejected") assert.match(paper.reason.message, /CM API category 368: HTTP 403/);
});

test("complete Toronto aggregate rejects instead of publishing a partial snapshot", async () => {
  replaceFetch((url) => url.includes("cm-api") ? response({}, 403) : response(list([])));
  await assert.rejects(scrapeToronto, /Toronto coverage is incomplete/);
});

test("computer failure does not prevent independent paper monitoring", async () => {
  replaceFetch((url) => url.includes("cm-api") ? response({ items: [] }) : response({}, 403));
  const [computer, paper] = await Promise.allSettled([scrapeTorontoComputer(), scrapeTorontoPaper()]);
  assert.equal(computer.status, "rejected");
  assert.deepEqual(paper, { status: "fulfilled", value: [] });
});

test("valid empty lists are known empty for their own exam type", async () => {
  replaceFetch((url) => response(url.includes("cm-api") ? { items: [] } : list([])));
  assert.deepEqual(await scrapeToronto(), []);
});

test("JSON error envelopes cannot become known-empty lists", async () => {
  replaceFetch(() => response({ error: "Access denied" }));
  await assert.rejects(scrapeTorontoComputer, /availability unknown/);
  await assert.rejects(scrapeTorontoPaper, /missing items array/);
});

test("AC application failure is rejected even with an empty activity array", async () => {
  replaceFetch(() => response({ ...list([]), headers: { ...list([]).headers, response_code: "1001" } }));
  await assert.rejects(scrapeTorontoComputer, /invalid response/);
});

test("all pages must be read before a computer snapshot is returned", async () => {
  const requestedPages: number[] = [];
  replaceFetch((_url, init) => {
    const page = JSON.parse(new Headers(init?.headers).get("page_info")!).page_number;
    requestedPages.push(page);
    return response(list([item(129461 + page)], page, 2, 2));
  });
  assert.deepEqual(await scrapeTorontoComputer(), []);
  assert.deepEqual(requestedPages, [1, 2]);
});

test("truncated or repeated pagination is an unknown snapshot", async () => {
  replaceFetch(() => response(list([item()], 1, 1, 2)));
  await assert.rejects(scrapeTorontoComputer, /incomplete/);
  replaceFetch(() => response(list([item(), item()], 1, 1, 2)));
  await assert.rejects(scrapeTorontoComputer, /duplicate/);
});

test("detail confirms a candidate and supplies the authoritative exam date", async () => {
  replaceFetch((url) => response(url.includes("activities/list")
    ? list([{ ...item(129462, "", "TCFC101026-MS"), already_enrolled: 11 }])
    : detail(129462, "3 openings")));
  const slots = await scrapeTorontoComputer();
  assert.deepEqual(slots, [{
    id: "129462", examType: "E-TCF Canada", date: "2026-10-09", availableSeats: 3,
    bookingUrl: "https://anc.ca.apm.activecommunities.com/aftoronto/activity/search/detail/129462",
  }]);
});

test("closed detail overrides an apparently open computer listing", async () => {
  replaceFetch((url) => response(url.includes("activities/list") ? list([item(129462, "Open")]) : detail(129462, "On Hold")));
  assert.deepEqual(await scrapeTorontoComputer(), []);
});

test("a failed detail rejects the exam type instead of returning partial availability", async () => {
  replaceFetch((url) => {
    if (url.includes("activities/list")) return response(list([item(1, "Open"), item(2, "Open")]));
    return url.includes("/detail/1?") ? response(detail(1, "3 openings")) : response({}, 403);
  });
  await assert.rejects(scrapeTorontoComputer, /detail check\(s\) failed; availability unknown/);
});

test("missing and unrecognized availability cannot generate an opening", async () => {
  for (const status of ["", "Ask the centre"]) {
    replaceFetch((url) => response(url.includes("activities/list") ? list([item(129462, "")]) : detail(129462, status)));
    await assert.rejects(scrapeTorontoComputer, /availability unknown/);
  }
});

test("a missing detail object does not masquerade as all-full", async () => {
  replaceFetch((url) => response(url.includes("activities/list") ? list([item(129462, "Open")]) : { headers: { response_code: "0000" }, body: {} }));
  await assert.rejects(scrapeTorontoComputer, /availability unknown/);
});

test("unknown dates are rejected and valid activity-number dates can fill a missing detail date", async () => {
  replaceFetch((url) => response(url.includes("activities/list") ? list([item(129462, "Open", "unknown")]) : detail(129462, "3 openings", "")));
  await assert.rejects(scrapeTorontoComputer, /availability unknown/);
  replaceFetch((url) => response(url.includes("activities/list") ? list([item(129462, "Open")]) : detail(129462, "3 openings", "")));
  assert.equal((await scrapeTorontoComputer())[0].date, "2026-10-09");
});

test("paper retains exam type and times while confirming its detail", async () => {
  replaceFetch((url) => response(url.includes("cm-api") ? { items: [{ id: 123, date_patterns: [{
    activity_start_date: "2026-11-20", activity_start_time: "9:00:00", activity_end_time: "12:00:00",
  }] }] } : detail(123, "2 openings", "2026-11-20")));
  const [slot] = await scrapeTorontoPaper();
  assert.equal(slot.examType, "P-TCF Canada");
  assert.equal(slot.date, "2026-11-20");
  assert.equal(slot.startTime, "09:00");
  assert.equal(slot.endTime, "12:00");
});


test("paper rows in the shared TCF category are not mislabeled as computer exams", async () => {
  const fetchMock = replaceFetch(() => response(list([{ ...item(123, "Open"), name: "P-TCF CANADA - 4 modules" }])));
  assert.deepEqual(await scrapeTorontoComputer(), []);
  assert.equal(fetchMock.mock.calls.length, 1);
});

test("unrecognized products in the TCF category surface as a changed source", async () => {
  replaceFetch(() => response(list([{ ...item(), name: "TCF Canada new format" }])));
  await assert.rejects(scrapeTorontoComputer, /unrecognized product/);
});
