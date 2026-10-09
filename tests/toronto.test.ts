import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, mock, test } from "node:test";
import { scrapeToronto, scrapeTorontoComputer, scrapeTorontoPaper, TorontoPaperChallengeError } from "../scripts/scrapers/toronto";
import { createSources, runMonitor, type MonitorDependencies } from "../scripts/scrape-slots";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/toronto-child-candidates.json", import.meta.url), "utf8"));
const item = (id = 129585, format = "computer") => ({
  id, name: `${format === "computer" ? "E" : "P"}-TCF CANADA - 4 modules`,
  status: 0, open_spaces: 1, other_category: { id: format === "computer" ? 367 : 368 },
  start_date: "2026-10-23T00:00:00+00:00",
});
const list = (items: ReturnType<typeof item>[]) => ({ items, page: 1, totalItems: items.length, limit: "300" });
const detail = (id: number, status: string, date = "2026-10-23", parent = false) => ({
  headers: { response_code: "0000" },
  body: { detail: { activity_id: id, space_status: status, first_date: date, is_parent_activity: parent } },
});
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "content-type": "application/json" },
});
const replaceFetch = (handler: (url: string, init?: RequestInit) => Response | Promise<Response>) =>
  mock.method(globalThis, "fetch", async (input, init) => handler(String(input), init));

// Mock failures must not enter the real GitHub source-health step summary.
const inheritedSummary = process.env.GITHUB_STEP_SUMMARY;
beforeEach(() => { delete process.env.GITHUB_STEP_SUMMARY; });
afterEach(() => {
  mock.restoreAll();
  if (inheritedSummary === undefined) delete process.env.GITHUB_STEP_SUMMARY;
  else process.env.GITHUB_STEP_SUMMARY = inheritedSummary;
});

test("paper CM failure does not prevent independent computer monitoring", async () => {
  replaceFetch(url => new URL(url).searchParams.get("othercategory") === "368" ? response({}, 403) : response(list([])));
  const [computer, paper] = await Promise.allSettled([scrapeTorontoComputer(), scrapeTorontoPaper()]);
  assert.deepEqual(computer, { status: "fulfilled", value: [] });
  assert.equal(paper.status, "rejected");
  if (paper.status === "rejected") assert.match(paper.reason.message, /CM API category 368: HTTP 403/);
});

test("complete Toronto aggregate rejects instead of publishing a partial snapshot", async () => {
  replaceFetch(url => new URL(url).searchParams.get("othercategory") === "368" ? response({}, 403) : response(list([])));
  await assert.rejects(scrapeToronto, /Toronto coverage is incomplete/);
});

test("computer CM failure does not prevent independent paper monitoring", async () => {
  replaceFetch(url => new URL(url).searchParams.get("othercategory") === "367" ? response({}, 403) : response(list([])));
  const [computer, paper] = await Promise.allSettled([scrapeTorontoComputer(), scrapeTorontoPaper()]);
  assert.equal(computer.status, "rejected");
  assert.deepEqual(paper, { status: "fulfilled", value: [] });
});

test("valid complete empty CM lists are known empty for their own exam type", async () => {
  replaceFetch(() => response(list([])));
  assert.deepEqual(await scrapeToronto(), []);
});

test("JSON error envelopes cannot become known-empty lists", async () => {
  replaceFetch(() => response({ error: "Access denied" }));
  await assert.rejects(scrapeTorontoComputer, /missing items array/);
  await assert.rejects(scrapeTorontoPaper, /missing items array/);
});

test("HTML challenges remain failed snapshots and log only bounded diagnostic metadata", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  mock.method(globalThis, "setTimeout", (callback, _delay, ...args) => originalSetTimeout(callback, 0, ...args));
  const warnings = mock.method(console, "warn", () => {});
  const secret = "PRIVATE_CHALLENGE_VALUE_MUST_NOT_APPEAR";
  const fetchMock = replaceFetch(() => new Response(`<html><script>${secret}</script></html>`, {
    status: 202,
    headers: {
      "content-type": "text/html; charset=utf-8", "sg-captcha": secret,
      "set-cookie": `challenge=${secret}`, server: "nginx", "x-proxy-cache": "MISS", "retry-after": "30",
    },
  }));
  await assert.rejects(scrapeTorontoPaper, (error: Error) => {
    assert.ok(error instanceof TorontoPaperChallengeError);
    assert.match(error.message, /HTTP 202, text\/html; classification=siteground-challenge/);
    assert.match(error.message, /server=nginx, proxyCache=MISS, retryAfterSeconds=30/);
    assert.doesNotMatch(error.message, new RegExp(secret));
    return true;
  });
  assert.equal(fetchMock.mock.calls.length, 1);
  assert.equal(warnings.mock.calls.length, 0);
  for (const call of warnings.mock.calls) assert.doesNotMatch(String(call.arguments[0]), new RegExp(secret));
});

test("unrecognized HTTP 202 HTML does not become a diagnosed challenge or an empty list", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  mock.method(globalThis, "setTimeout", (callback, _delay, ...args) => originalSetTimeout(callback, 0, ...args));
  mock.method(console, "warn", () => {});
  replaceFetch(() => new Response("<html>Temporary response</html>", { status: 202, headers: { "content-type": "text/html" } }));
  await assert.rejects(scrapeTorontoPaper, (error: Error) => {
    assert.ok(!(error instanceof TorontoPaperChallengeError));
    assert.match(error.message, /HTTP 202, text\/html; classification=unclassified/);
    return true;
  });
});

test("the known paper challenge also recognizes the fixed SiteGround body path", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  mock.method(globalThis, "setTimeout", (callback, _delay, ...args) => originalSetTimeout(callback, 0, ...args));
  mock.method(console, "warn", () => {});
  replaceFetch(() => new Response('<html><script src="/.well-known/sgcaptcha/">', {
    status: 202, headers: { "content-type": "text/html" },
  }));
  await assert.rejects(scrapeTorontoPaper, TorontoPaperChallengeError);
});

test("other paper HTTP failures and HTML classifications are not the known challenge", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  mock.method(globalThis, "setTimeout", (callback, _delay, ...args) => originalSetTimeout(callback, 0, ...args));
  mock.method(console, "warn", () => {});
  const cases = [
    { status: 401, headers: { "content-type": "text/html" }, body: "Unauthorized" },
    { status: 403, headers: { "content-type": "text/html" }, body: "Forbidden" },
    { status: 200, headers: { "content-type": "text/html", "sg-captcha": "1" }, body: "Challenge" },
    { status: 202, headers: { "content-type": "text/html", "cf-mitigated": "challenge" }, body: "Challenge" },
    { status: 202, headers: { "content-type": "application/json", "sg-captcha": "1" }, body: "{invalid" },
  ];
  for (const entry of cases) {
    replaceFetch(() => new Response(entry.body, { status: entry.status, headers: entry.headers }));
    await assert.rejects(scrapeTorontoPaper, (error: Error) => {
      assert.ok(!(error instanceof TorontoPaperChallengeError));
      return true;
    });
  }
});

test("a SiteGround challenge on CM computer discovery cannot receive the paper policy type", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  mock.method(globalThis, "setTimeout", (callback, _delay, ...args) => originalSetTimeout(callback, 0, ...args));
  mock.method(console, "warn", () => {});
  replaceFetch(() => new Response("Challenge", { status: 202, headers: { "content-type": "text/html", "sg-captcha": "1" } }));
  await assert.rejects(scrapeTorontoComputer, (error: Error) => {
    assert.ok(!(error instanceof TorontoPaperChallengeError));
    assert.match(error.message, /classification=siteground-challenge/);
    return true;
  });
});

test("a SiteGround challenge on paper AC detail remains a normal incomplete snapshot", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  mock.method(globalThis, "setTimeout", (callback, _delay, ...args) => originalSetTimeout(callback, 0, ...args));
  mock.method(console, "warn", () => {});
  replaceFetch((url) => url.includes("cm-api")
    ? response(list([item(123, "paper")]))
    : new Response("Challenge", { status: 202, headers: { "content-type": "text/html", "sg-captcha": "1" } }));
  await assert.rejects(scrapeTorontoPaper, (error: Error) => {
    assert.ok(error instanceof AggregateError);
    assert.ok(error.errors.every((cause) => !(cause instanceof TorontoPaperChallengeError)));
    assert.match(error.message, /availability unknown/);
    return true;
  });
});

test("a later valid JSON retry recovers from a transient HTML response", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  mock.method(globalThis, "setTimeout", (callback, _delay, ...args) => originalSetTimeout(callback, 0, ...args));
  mock.method(console, "warn", () => {});
  let requests = 0;
  replaceFetch(() => ++requests === 1
    ? new Response("<html>Temporary response</html>", { status: 202, headers: { "content-type": "text/html" } })
    : response(list([])));
  assert.deepEqual(await scrapeTorontoPaper(), []);
  assert.equal(requests, 2);
});


test("CM totals, page and limit must establish complete discovery", async () => {
  for (const broken of [
    { items: [] }, { ...list([]), totalItems: 2 }, { ...list([]), page: 2 },
    { ...list([]), limit: "20" }, { ...list([]), totalItems: -1 },
    list(Array.from({ length: 300 }, (_, i) => item(i + 1))),
  ]) {
    replaceFetch(() => response(broken));
    await assert.rejects(scrapeTorontoComputer, /incomplete or invalid pagination/);
    await assert.rejects(scrapeTorontoPaper, /incomplete or invalid pagination/);
  }
});

test("duplicate or malformed CM candidates cannot become a partial snapshot", async () => {
  for (const entries of [
    [item(), item()], [{ ...item(), id: -1 }], [{ ...item(), name: "Preparation workshop" }],
    [{ ...item(), other_category: { id: 368 } }], [{ ...item(), status: 4 }],
    [{ ...item(), open_spaces: 0 }], [{ ...item(), open_spaces: "1" }],
  ]) {
    replaceFetch(() => response({ ...list([]), items: entries, totalItems: entries.length }));
    await assert.rejects(scrapeTorontoComputer, /duplicate|malformed or unexpected/);
  }
});

test("configured computer source follows official child discovery, not the false-positive parent search", async () => {
  const requests: string[] = [];
  replaceFetch(url => {
    requests.push(url);
    const parsed = new URL(url);
    if (parsed.hostname === "cm-api.alliance-francaise.ca") {
      assert.equal(parsed.searchParams.get("othercategory"), "367");
      assert.equal(parsed.searchParams.get("enddate"), "gte");
      assert.equal(parsed.searchParams.get("openspaces"), "1");
      assert.equal(parsed.searchParams.get("status"), "0");
      assert.equal(parsed.searchParams.get("limit"), "300");
      return response(fixture.cmComputer);
    }
    const id = parsed.pathname.split("/").at(-1)!;
    assert.ok(fixture.details[id], "only discovered actual child details should be requested");
    return response(fixture.details[id]);
  });
  const source = createSources().find(source => source.key === "toronto" && source.source === "computer")!;
  assert.deepEqual(source.examTypes, ["E-TCF Canada"]);
  assert.deepEqual(await source.scrape(), []);
  assert.equal(requests.length, 3);
  assert.ok(requests.every(url => !url.includes("activities/list") && !url.includes("129464")));
});

test("a parent aggregate reporting an opening is not a verified bookable sitting", async () => {
  replaceFetch(url => response(url.includes("cm-api") ? list([item(129464)]) : fixture.parentDetail));
  await assert.rejects(scrapeTorontoComputer, (error: AggregateError) => {
    assert.match(error.message, /availability unknown/);
    assert.match(error.errors[0].message, /parent aggregate/);
    return true;
  });
});

test("missing parent metadata and mismatched IDs fail rather than accepting ambiguous detail", async () => {
  for (const change of [{ is_parent_activity: undefined }, { is_parent_activity: "false" }, { activity_id: undefined }, { activity_id: 99 }]) {
    const data = detail(129585, "1 opening");
    Object.assign(data.body.detail, change);
    replaceFetch(url => response(url.includes("cm-api") ? list([item()]) : data));
    await assert.rejects(scrapeTorontoComputer, /availability unknown/);
  }
});

test("detail supplies the authoritative exam date and seat count for a real child", async () => {
  replaceFetch(url => response(url.includes("cm-api") ? list([item()]) : detail(129585, "3 openings", "2026-10-24")));
  assert.deepEqual(await scrapeTorontoComputer(), [{
    id: "129585", examType: "E-TCF Canada", date: "2026-10-24", availableSeats: 3,
    startTime: undefined, endTime: undefined,
    bookingUrl: "https://anc.ca.apm.activecommunities.com/aftoronto/activity/search/detail/129585",
  }]);
});

test("closed detail overrides an apparently open CM computer child", async () => {
  replaceFetch(url => response(url.includes("cm-api") ? list([item()]) : detail(129585, "On Hold")));
  assert.deepEqual(await scrapeTorontoComputer(), []);
});

test("one failed detail rejects the entire exam type, including other apparently open children", async () => {
  replaceFetch(url => {
    if (url.includes("cm-api")) return response(list([item(1), item(2)]));
    return url.includes("/detail/1?") ? response(detail(1, "3 openings")) : response({}, 403);
  });
  await assert.rejects(scrapeTorontoComputer, /detail check\(s\) failed; availability unknown/);
});

test("missing, unknown or unsuccessful detail cannot generate an opening", async () => {
  for (const data of [
    detail(129585, ""), detail(129585, "Ask the centre"), { headers: { response_code: "0000" }, body: {} },
    { ...detail(129585, "1 opening"), headers: { response_code: "1001" } },
  ]) {
    replaceFetch(url => response(url.includes("cm-api") ? list([item()]) : data));
    await assert.rejects(scrapeTorontoComputer, /availability unknown/);
  }
});

test("unknown dates fail and the official CM date can fill a missing detail date", async () => {
  replaceFetch(url => response(url.includes("cm-api") ? list([{ ...item(), start_date: "invalid" }]) : detail(129585, "3 openings", "")));
  await assert.rejects(scrapeTorontoComputer, /availability unknown/);
  replaceFetch(url => response(url.includes("cm-api") ? list([item()]) : detail(129585, "3 openings", "")));
  assert.equal((await scrapeTorontoComputer())[0].date, "2026-10-23");
});

test("paper retains its source, exam type and times while confirming a child detail", async () => {
  replaceFetch(url => {
    if (url.includes("cm-api")) {
      assert.equal(new URL(url).searchParams.get("othercategory"), "368");
      return response({ ...list([item(123, "paper")]), items: [{ ...item(123, "paper"), date_patterns: [{
        activity_start_date: "2026-11-20", activity_start_time: "9:00:00", activity_end_time: "12:00:00",
      }] }] });
    }
    return response(detail(123, "2 openings", "2026-11-20"));
  });
  const [slot] = await scrapeTorontoPaper();
  assert.equal(slot.examType, "P-TCF Canada");
  assert.equal(slot.date, "2026-11-20");
  assert.equal(slot.startTime, "09:00");
  assert.equal(slot.endTime, "12:00");
  assert.equal(slot.availableSeats, 2);
});

test("real configured computer request failure preserves prior state; only a verified empty result clears it", async () => {
  const source = createSources().find(source => source.key === "toronto" && source.source === "computer")!;
  const writes: unknown[] = [];
  const prior = [{ city: "toronto", exam_type: "E-TCF Canada", slots: [{ id: "129464" }] }];
  const io: MonitorDependencies = {
    getPrevState: async () => structuredClone(prior),
    upsertState: async (...args) => { writes.push(args); },
    notifyDiscord: async () => assert.fail("no notification is due"),
    runRegistrationReminders: async () => assert.fail("not a reminder source"),
  };
  replaceFetch(() => response({}, 403));
  await assert.rejects(runMonitor([source], false, io), /computer \(scrape\)/);
  assert.deepEqual(writes, []);
  replaceFetch(() => response(list([])));
  await runMonitor([source], false, io);
  assert.deepEqual(writes, [["toronto", "E-TCF Canada", [], false]]);
});
