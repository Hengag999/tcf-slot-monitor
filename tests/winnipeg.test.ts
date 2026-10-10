import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parseWinnipeg, scrapeWinnipeg, WINNIPEG_PAGE, WINNIPEG_REGISTRATION } from "../scripts/scrapers/winnipeg";
import { formatSlotNotification } from "../src/lib/discord";

const observed = readFileSync(new URL("./fixtures/winnipeg-next-sessions.html", import.meta.url), "utf8");
const publishedDates = readFileSync(new URL("./fixtures/winnipeg-published-dates-2026-10-10.html", import.meta.url), "utf8");
const page = (sessions: string, options: { context?: string; registration?: string; boundary?: string } = {}) =>
  `<h2>${options.context ?? "TCF CANADA"}</h2><section><h2>Next sessions</h2>${sessions}`
  + `<h2>${options.boundary ?? "Next dates will be announced on"}</h2><h2>October 09, 2026 at 5 PM</h2>`
  + `<a href="${options.registration ?? WINNIPEG_REGISTRATION}">Registration</a></section>`;
const session = (value: string) => `<h3>${value}</h3>`;
const htmlResponse = (html: string, status = 200) => new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });

test("Winnipeg reads all three observed published sessions without inventing a sitting year", () => {
  const slots = parseWinnipeg(observed);
  assert.deepEqual(slots.map(slot => [slot.date, slot.availableSeats]), [["November 3", 1], ["November 4", 2], ["November 10", 1]]);
  assert.ok(slots.every(slot => slot.examType === "TCF Canada" && slot.bookingUrl === WINNIPEG_REGISTRATION));
  assert.equal(new Set(slots.map(slot => slot.id)).size, 3);
  assert.ok(slots.every(slot => !slot.date.includes("2026") && !slot.date.includes("October")));
});

test("Winnipeg reads the October 10 positive availability list without inventing years or seat counts", () => {
  const slots = parseWinnipeg(publishedDates);
  assert.deepEqual(slots.map(slot => slot.date), ["November 19", "November 23", "November 24", "November 25", "November 27", "December 1", "December 2", "December 4"]);
  assert.ok(slots.every(slot => slot.examType === "TCF Canada" && slot.bookingUrl === WINNIPEG_REGISTRATION));
  assert.ok(slots.every(slot => !Object.hasOwn(slot, "availableSeats") && !/20\d\d/.test(slot.date)));
  assert.equal(new Set(slots.map(slot => slot.id)).size, 8);
  const message = formatSlotNotification("Winnipeg · 温尼伯", "TCF Canada", slots, {
    kind: "published-availability", sourceUrl: WINNIPEG_PAGE,
    caveat: "未注明年份的场次，请在报名时向考点确认。需提交报名表、付款并由考点确认，非即时锁位。",
  });
  assert.match(message, /官网公布余位/);
  assert.match(message, /November 19/);
  assert.match(message, /December 4/);
  assert.doesNotMatch(message, /个名额|undefined|2026/);
});

test("Winnipeg's uncounted date list requires positive availability and exact bounded context", () => {
  const changed = [
    publishedDates.replace("spots available!", "No spots available!"),
    publishedDates.replace("spots available!", "spots available soon!"),
    publishedDates.replace("New dates:", "Future dates:"),
    publishedDates.replace("No</span>\n                    refund", "No</span>\n                    changes or refund"),
    publishedDates.replace("Cancellations for climatic or personal reasons are not possible.", ""),
    publishedDates.replace("Cancellations for climatic or personal reasons are not possible.", "Cancellations for climatic or personal reasons are not possible.<br>No refund or deferment is possible. Cancellations for climatic or personal reasons are not possible."),
    publishedDates.replace("Nov.19", "Nov.19<br>Waitlist only"),
    publishedDates.replace("<p></p>", "<p>Another unpublished date exists</p>"),
    publishedDates.replace("<p></p>", "<h3>Jan.01</h3>"),
    publishedDates.replace(WINNIPEG_REGISTRATION, "https://other.example/register"),
  ];
  for (const html of changed) {
    assert.notEqual(html, publishedDates, "negative fixture mutation must take effect");
    assert.throws(() => parseWinnipeg(html), /Winnipeg:/);
  }
  // The old counted-date branch must not start accepting unexplained bare dates.
  assert.throws(() => parseWinnipeg(page(session("Nov. 19"))), /Winnipeg:/);
});

test("Winnipeg's uncounted date list rejects impossible or duplicate dates and has no implicit empty result", () => {
  assert.throws(() => parseWinnipeg(publishedDates.replace("Nov.19", "Nov.31")), /invalid session date/);
  assert.throws(() => parseWinnipeg(publishedDates.replace("Nov.23", "November 19")), /duplicate/);
  assert.throws(() => parseWinnipeg(publishedDates.replace("Dec.04", "Dec.04 (full)")), /unrecognized session date/);
  const noDates = publishedDates.replace(/Nov\.19[\s\S]*?Dec\.04/, "");
  assert.throws(() => parseWinnipeg(noDates), /boundary changed/);
  const outside = "<h3>January 1 (99 spots available)</h3>";
  assert.deepEqual(parseWinnipeg(outside + publishedDates + outside), parseWinnipeg(publishedDates));
});

test("Winnipeg's bounded public scraper accepts the captured changed layout", async () => {
  const slots = await scrapeWinnipeg({ fetchImpl: async () => htmlResponse(publishedDates) });
  assert.equal(slots.length, 8);
});

test("Winnipeg preserves state for explicitly hidden sections, banners, dates, or registration links", () => {
  const targets = [
    (html: string, attribute: string) => html.replace("<section ", `<section ${attribute} `),
    (html: string, attribute: string) => html.replace("<h3>", `<h3 ${attribute}>`),
    (html: string, attribute: string) => html.replace(/(<h3>[\s\S]*?<\/h3>[\s\S]*?)<h3>/, `$1<h3 ${attribute}>`),
    (html: string, attribute: string) => html.replace("<a class=", `<a ${attribute} class=`),
  ];
  for (const attribute of ["hidden", 'aria-hidden="true"', 'style="display: none !important;"', "style='visibility:hidden'"]) {
    for (const mutate of targets) {
      const hidden = mutate(publishedDates, attribute);
      assert.notEqual(hidden, publishedDates, "hidden target mutation must take effect");
      assert.throws(() => parseWinnipeg(hidden), /explicitly hidden.*state must be preserved/);
    }
  }
  assert.throws(() => parseWinnipeg(observed.replace("<section ", "<section hidden ")), /explicitly hidden/);
});

test("Winnipeg hidden-markup guard is scoped to the selected section and actual attributes", () => {
  const unrelated = '<section hidden><h3>Not a session listing</h3></section>';
  const annotation = publishedDates.replace("<section ", '<section aria-hidden="false" title="display:none hidden text" ');
  assert.equal(parseWinnipeg(unrelated + annotation).length, 8);
});

test("Winnipeg requires explicit positive seats and recognizes dated full, closed, sold-out and zero states", () => {
  const slots = parseWinnipeg(page([
    "Nov. 03 (0 spots available)", "Nov. 4 (FULL)", "Nov. 10 (sold out)",
    "Nov. 11 (closed)", "November 12, 2026 (2 spots available)",
  ].map(session).join("")));
  assert.deepEqual(slots.map(slot => [slot.date, slot.availableSeats]), [["November 12, 2026", 2]]);
  assert.deepEqual(parseWinnipeg(page(session("Nov. 03 (0 spots available)"))), []);
  assert.deepEqual(parseWinnipeg(page(session("Nov. 03 (FULL)"))), []);
});

test("Winnipeg accepts explicit empty notices only inside a valid, linked Next sessions section", () => {
  for (const notice of ["No sessions currently available.", "No upcoming sessions available", "All sessions are full", "All sessions sold out", "No spots available"]) {
    assert.deepEqual(parseWinnipeg(page(`<p>${notice}</p>`)), []);
    assert.deepEqual(parseWinnipeg(page(session(notice))), []);
  }
  assert.throws(() => parseWinnipeg(page("")), /missing or conflicting/);
  assert.throws(() => parseWinnipeg(page("<p>New dates:</p>")), /missing or conflicting/);
  assert.throws(() => parseWinnipeg(page(session("Nov. 3 (1 spot available)") + "<p>All sessions are full</p>")), /conflicting/);
});

test("Winnipeg excludes next-announcement dates and unrelated dates outside the section", () => {
  const body = page(session("Dec. 31 (1 spot available)"));
  const outside = '<h3>Jan. 1, 2027 (99 spots available)</h3>';
  assert.deepEqual(parseWinnipeg(outside + body + outside).map(slot => slot.date), ["December 31"]);
  const afterBoundary = body.replace("<h2>October 09, 2026 at 5 PM</h2>", '<h3>Jan. 1, 2027 (99 spots available)</h3>');
  assert.deepEqual(parseWinnipeg(afterBoundary).map(slot => slot.date), ["December 31"]);
  assert.deepEqual(parseWinnipeg(page(session("Jan. 01 (1 spot available)"), { boundary: "Important Information" })).map(slot => slot.date), ["January 1"]);
});

test("Winnipeg rejects invalid dates, unknown availability, duplicated dates and malformed session markup", () => {
  for (const value of ["Nov. 31 (1 spot available)", "Feb. 29, 2027 (1 spot available)", "Nov. 0 (1 spot available)", "Bogus 3 (1 spot available)", "Nov. 3", "Nov. 3 (available)", "Nov. 3 (-1 spots available)", "Nov. 3 (1 spot available) or waitlist", "Nov. 3 and 4 (2 spots available)"]) {
    assert.throws(() => parseWinnipeg(page(session(value))), /Winnipeg:/);
  }
  assert.throws(() => parseWinnipeg(page(session("Nov. 3 (1 spot available)").repeat(2))), /duplicate/);
  assert.throws(() => parseWinnipeg(page("<h3>Nov. 3 (1 spot available)")), /Winnipeg:/);
  assert.throws(() => parseWinnipeg(page(session("Nov. 3 (1 spot available)") + "<p>New unpublished format</p>")), /unrecognized content/);
  assert.deepEqual(parseWinnipeg(page(session("Feb. 29 (1 spot available)"))).map(slot => slot.date), ["February 29"]);
});

test("Winnipeg fails missing or changed context, section, boundary, or registration links", () => {
  const good = page(session("Nov. 3 (1 spot available)"));
  for (const html of [
    page(session("Nov. 3 (1 spot available)"), { context: "TEF CANADA" }),
    good.replace("Next sessions", "Next classes"),
    good.replace("Next dates will be announced on", "Upcoming information"),
    good.replace("</section>", ""),
    good + good,
    good.replace(`href="${WINNIPEG_REGISTRATION}"`, 'href="https://other.example/register-tcf-canada/"'),
    good.replace(`href="${WINNIPEG_REGISTRATION}"`, 'href="/en/exams/tef/"'),
    good.replace(`href="${WINNIPEG_REGISTRATION}"`, 'href="#"'),
    good.replace('<a href=', '<a aria-disabled="true" href='),
  ]) assert.throws(() => parseWinnipeg(html), /Winnipeg:/);
  assert.equal(parseWinnipeg(good.replace(WINNIPEG_REGISTRATION, "/en/exams/tcf/register-tcf-canada/")).length, 1);
  assert.throws(() => parseWinnipeg('<script>' + good + '</script><h1>Challenge</h1>'), /context missing/);
  assert.throws(() => parseWinnipeg(good.replace(/<a href=.*?<\/a>/, "") + `<a href="${WINNIPEG_REGISTRATION}">Registration</a>`), /registration form missing/);
});

test("Winnipeg performs one bounded official GET with honest identification and no redirects", async () => {
  const requests: { url: unknown; options: RequestInit | undefined }[] = [];
  const slots = await scrapeWinnipeg({ fetchImpl: async (url, options) => {
    requests.push({ url, options });
    return htmlResponse(observed);
  } });
  assert.equal(slots.length, 3);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, WINNIPEG_PAGE);
  assert.ok(requests[0].options?.signal instanceof AbortSignal);
  assert.equal(requests[0].options?.method ?? "GET", "GET");
  assert.equal(requests[0].options?.redirect, "error");
  assert.match(new Headers(requests[0].options?.headers).get("User-Agent")!, /TCF-Slot-Monitor.*github\.com\/Hengag999\/tcf-slot-monitor/);
});

test("Winnipeg source errors never become an empty snapshot and do not leak raw network diagnostics", async () => {
  await assert.rejects(scrapeWinnipeg({ fetchImpl: async () => { throw new Error("private diagnostic"); } }), { message: "Winnipeg: public listing request failed or timed out" });
  for (const response of [htmlResponse("server error", 503), new Response("{}", { headers: { "content-type": "application/json" } }), htmlResponse("<h1>Access challenge</h1>"), htmlResponse("x".repeat(2_000_001))]) {
    await assert.rejects(scrapeWinnipeg({ fetchImpl: async () => response }), /Winnipeg:/);
  }
  const failedBody = htmlResponse(observed);
  failedBody.text = async () => { throw new Error("private body diagnostic"); };
  await assert.rejects(scrapeWinnipeg({ fetchImpl: async () => failedBody }), { message: "Winnipeg: public listing body failed or timed out" });
});
