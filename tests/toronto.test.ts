import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, mock, test } from "node:test";
import { scrapeToronto, scrapeTorontoComputer, scrapeTorontoPaper, TorontoPaperChallengeError } from "../scripts/scrapers/toronto";
import { createSources, runMonitor, type MonitorDependencies } from "../scripts/scrape-slots";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/toronto-child-candidates.json", import.meta.url), "utf8"));
const hierarchy = JSON.parse(readFileSync(new URL("./fixtures/toronto-ac-hierarchy.json", import.meta.url), "utf8"));
const nullChildIds = JSON.parse(readFileSync(new URL("./fixtures/toronto-null-child-ids.json", import.meta.url), "utf8"));
const item = (id = 123, format = "paper") => ({
  id, name: `${format === "computer" ? "E" : "P"}-TCF CANADA - 4 modules`,
  status: 0, open_spaces: 1, other_category: { id: format === "computer" ? 367 : 368 },
  start_date: "2026-10-23T00:00:00+00:00",
});
const list = (items: ReturnType<typeof item>[]) => ({ items, page: 1, totalItems: items.length, limit: "300" });
const activity = (id = 129585, status = "Full", children: number[] | null = null) => ({
  id, name: "E-TCF CANADA - 4 modules", number: "SCTCFC231026-MS",
  total_open: 14, already_enrolled: 14,
  parent_activity: children !== null, num_of_sub_activities: children?.length ?? 0,
  sub_activity_ids: children, urgent_message: { status_description: status },
});
const acList = (items: ReturnType<typeof activity>[], field = "activity_items", page = 1, pages = 1, total = items.length) => ({
  headers: { response_code: "0000", page_info: { page_number: page, total_page: pages, total_records: total } },
  body: { [field]: items },
});
const detail = (id: number, status: string, date = "2026-10-23", parent = false) => ({
  headers: { response_code: "0000" },
  body: { detail: { activity_id: id, space_status: status, first_date: date, is_parent_activity: parent } },
});
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "content-type": "application/json" },
});
const replaceFetch = (handler: (url: string, init?: RequestInit) => Response | Promise<Response>) =>
  mock.method(globalThis, "fetch", async (input, init) => handler(String(input), init));

const inheritedSummary = process.env.GITHUB_STEP_SUMMARY;
beforeEach(() => { delete process.env.GITHUB_STEP_SUMMARY; });
afterEach(() => {
  mock.restoreAll();
  if (inheritedSummary === undefined) delete process.env.GITHUB_STEP_SUMMARY;
  else process.env.GITHUB_STEP_SUMMARY = inheritedSummary;
});

test("paper CM failure does not prevent independent computer monitoring", async () => {
  replaceFetch(url => url.includes("cm-api") ? response({}, 403) : response(acList([])));
  const [computer, paper] = await Promise.allSettled([scrapeTorontoComputer(), scrapeTorontoPaper()]);
  assert.deepEqual(computer, { status: "fulfilled", value: [] });
  assert.equal(paper.status, "rejected");
});

test("complete Toronto aggregate rejects instead of publishing a partial snapshot", async () => {
  replaceFetch(url => url.includes("cm-api") ? response({}, 403) : response(acList([])));
  await assert.rejects(scrapeToronto, /Toronto coverage is incomplete/);
});

test("computer AC failure does not prevent independent paper monitoring", async () => {
  replaceFetch(url => url.includes("cm-api") ? response(list([])) : response({}, 403));
  const [computer, paper] = await Promise.allSettled([scrapeTorontoComputer(), scrapeTorontoPaper()]);
  assert.equal(computer.status, "rejected");
  assert.deepEqual(paper, { status: "fulfilled", value: [] });
});

test("valid complete empty lists are known empty for their own exam type", async () => {
  replaceFetch(url => response(url.includes("cm-api") ? list([]) : acList([])));
  assert.deepEqual(await scrapeToronto(), []);
});

test("JSON error envelopes cannot become known-empty lists", async () => {
  replaceFetch(() => response({ error: "Access denied" }));
  await assert.rejects(scrapeTorontoComputer, /invalid response/);
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

test("a SiteGround challenge on AC computer discovery cannot receive the paper policy type", async () => {
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



test("paper CM totals, page and limit must establish complete discovery", async () => {
  for (const broken of [{ items: [] }, { ...list([]), totalItems: 2 }, { ...list([]), page: 2 },
    { ...list([]), limit: "20" }, { ...list([]), totalItems: -1 }, list(Array.from({ length: 300 }, (_, i) => item(i + 1)))]) {
    replaceFetch(() => response(broken));
    await assert.rejects(scrapeTorontoPaper, /incomplete or invalid pagination/);
  }
});

test("duplicate or malformed CM paper candidates cannot become a partial snapshot", async () => {
  for (const entries of [[item(), item()], [{ ...item(), id: -1 }], [{ ...item(), name: "Preparation workshop" }],
    [{ ...item(), other_category: { id: 367 } }], [{ ...item(), status: 4 }], [{ ...item(), open_spaces: 0 }]]) {
    replaceFetch(() => response({ ...list([]), items: entries, totalItems: entries.length }));
    await assert.rejects(scrapeTorontoPaper, /duplicate|malformed or unexpected/);
  }
});

test("configured computer source covers all real advertised children without CM or parent false positives", async () => {
  const childIds: number[] = [];
  const calls = replaceFetch((url, init) => {
    assert.ok(!url.includes("cm-api"), "computer must not depend on the challenged CM host");
    if (url.includes("/activities/list")) return response(hierarchy.listing);
    const parentId = new URL(url).pathname.split("/").at(-1)!;
    assert.ok(hierarchy.children[parentId]);
    const body = JSON.parse(String(init?.body));
    const ids = hierarchy.children[parentId].body.sub_activities.map((i: { id: number }) => i.id);
    assert.equal(body.sub_activity_ids, ids.join(","));
    assert.equal(body.open_spots, 0);
    childIds.push(...ids);
    return response(hierarchy.children[parentId]);
  });
  const source = createSources().find(source => source.key === "toronto" && source.source === "computer")!;
  assert.deepEqual(await source.scrape(), []);
  assert.equal(calls.mock.calls.length, 4);
  assert.deepEqual(childIds.sort(), [129585, 129587, 129702]);
  assert.ok(hierarchy.officialCmCandidates.every((id: number) => childIds.includes(id)));
});

test("observed null child IDs use public child discovery and confirm the real Oct16 child", async () => {
  const requests: string[] = [];
  replaceFetch((url, init) => {
    requests.push(url);
    if (url.includes("/activities/list")) return response(acList([nullChildIds.parent]));
    if (url.includes("/activities/subs/129464?")) {
      assert.deepEqual(JSON.parse(String(init?.body)), {
        sub_activity_ids: "", activity_transfer_pattern: {}, open_spots: 0,
      });
      return response(nullChildIds.childrenResponse);
    }
    assert.match(url, /\/activity\/detail\/129465\?/);
    return response(nullChildIds.detailResponse);
  });
  const source = createSources().find(source => source.key === "toronto" && source.source === "computer")!;
  assert.deepEqual(await source.scrape(), [{
    id: "129465", examType: "E-TCF Canada", date: "2026-10-16", availableSeats: 1,
    bookingUrl: "https://anc.ca.apm.activecommunities.com/aftoronto/activity/search/detail/129465",
  }]);
  assert.equal(requests.length, 3);
  assert.ok(requests.every(url => !url.includes("cm-api") && !url.includes("/detail/129464")));
});

test("null ID discovery still rejects missing, extra, duplicate, wrong-format or parent children", async () => {
  for (const children of [[], [activity(11), activity(12)], [activity(11), activity(11)],
    [{ ...activity(11), name: "P-TCF CANADA - 4 modules" }], [activity(11, "", [])]]) {
    replaceFetch(url => response(url.includes("/activities/list") ? acList([nullChildIds.parent])
      : acList(children, "sub_activities")));
    await assert.rejects(scrapeTorontoComputer, /incomplete|duplicate|unexpected children/);
  }
  replaceFetch(() => response(acList([{ ...nullChildIds.parent, parent_activity: false }])));
  await assert.rejects(scrapeTorontoComputer, /malformed activity hierarchy/);
});

test("null ID discovery traverses every page and enforces its advertised total", async () => {
  const childPages: number[] = [];
  replaceFetch((url, init) => {
    if (url.includes("/activities/list")) return response(acList([{ ...nullChildIds.parent, num_of_sub_activities: 2 }]));
    const page = JSON.parse(new Headers(init?.headers).get("page_info")!).page_number;
    childPages.push(page);
    return response(acList([activity(10 + page)], "sub_activities", page, 2, 2));
  });
  assert.deepEqual(await scrapeTorontoComputer(), []);
  assert.deepEqual(childPages, [1, 2]);
});

test("a parent with no children and a positive aggregate space count is never a candidate", async () => {
  const calls = replaceFetch(() => response(acList([{ ...activity(129464, "", []), total_open: 14, already_enrolled: 13 }])));
  assert.deepEqual(await scrapeTorontoComputer(), []);
  assert.equal(calls.mock.calls.length, 1);
});

test("a closed parent is traversed and its genuinely bookable child is returned", async () => {
  replaceFetch(url => response(url.includes("/activities/list") ? acList([activity(10, "On hold", [11])])
    : url.includes("/subs/") ? acList([activity(11, "")], "sub_activities") : detail(11, "3 openings", "2026-10-24")));
  assert.deepEqual(await scrapeTorontoComputer(), [{
    id: "11", examType: "E-TCF Canada", date: "2026-10-24", availableSeats: 3,
    bookingUrl: "https://anc.ca.apm.activecommunities.com/aftoronto/activity/search/detail/11",
  }]);
});

test("all top-level and child pages must be complete before returning a snapshot", async () => {
  const pages: string[] = [];
  replaceFetch((url, init) => {
    const page = JSON.parse(new Headers(init?.headers).get("page_info")!).page_number;
    const top = url.includes("/activities/list");
    pages.push(`${top ? "top" : "child"}:${page}`);
    return response(top ? acList([activity(page, "On hold", page === 1 ? [11, 12] : [])], "activity_items", page, 2, 2)
      : acList([activity(page + 10)], "sub_activities", page, 2, 2));
  });
  assert.deepEqual(await scrapeTorontoComputer(), []);
  assert.deepEqual(pages, ["top:1", "top:2", "child:1", "child:2"]);
});

test("malformed advertised child counts, IDs and hierarchy metadata fail the source", async () => {
  for (const change of [{ num_of_sub_activities: 2 }, { sub_activity_ids: [11, 11], num_of_sub_activities: 2 },
    { sub_activity_ids: undefined }, { sub_activity_ids: [] }, { parent_activity: undefined }, { parent_activity: false }, { sub_activity_ids: [-1] }]) {
    replaceFetch(() => response(acList([{ ...activity(10, "On hold", [11]), ...change } as ReturnType<typeof activity>])));
    await assert.rejects(scrapeTorontoComputer, /malformed activity hierarchy/);
  }
});

test("missing, duplicate, wrong-format or nested children invalidate the entire computer snapshot", async () => {
  for (const children of [[], [activity(12)], [activity(11), activity(11)],
    [{ ...activity(11), name: "P-TCF CANADA - 4 modules" }], [activity(11, "", [])]]) {
    replaceFetch(url => response(url.includes("/activities/list") ? acList([activity(10, "On hold", [11])])
      : acList(children, "sub_activities")));
    await assert.rejects(scrapeTorontoComputer, /incomplete|duplicate|unexpected children/);
  }
});

test("failed child request cannot return a partial computer snapshot", async () => {
  replaceFetch(url => url.includes("/activities/list") ? response(acList([activity(10, "On hold", [11])])) : response({}, 403));
  await assert.rejects(scrapeTorontoComputer, /AC children of 10/);
});

test("truncated or unstable pagination cannot return a successful empty result", async () => {
  for (const bad of [acList([], "activity_items", 1, 1, 2), acList([activity(1), activity(1)]),
    { ...acList([]), headers: { response_code: "1001" } }]) {
    replaceFetch(() => response(bad));
    await assert.rejects(scrapeTorontoComputer, /incomplete|duplicate|invalid response/);
  }
});

test("paper rows in category30 are not relabeled as computer, while unfamiliar products fail", async () => {
  replaceFetch(() => response(acList([{ ...activity(), name: "P-TCF CANADA - 4 modules" }])));
  assert.deepEqual(await scrapeTorontoComputer(), []);
  replaceFetch(() => response(acList([{ ...activity(), name: "TCF preparation" }])));
  await assert.rejects(scrapeTorontoComputer, /unrecognized TCF product/);
});

test("a detail response unexpectedly identifying a parent cannot generate an opening", async () => {
  replaceFetch(url => response(url.includes("/activities/list") ? acList([activity(129464, "")]) : fixture.parentDetail));
  await assert.rejects(scrapeTorontoComputer, (error: AggregateError) => {
    assert.match(error.errors[0].message, /parent aggregate/); return true;
  });
});

test("missing parent metadata and mismatched IDs fail rather than accepting ambiguous detail", async () => {
  for (const change of [{ is_parent_activity: undefined }, { is_parent_activity: "false" }, { activity_id: undefined }, { activity_id: 99 }]) {
    const data = detail(129585, "1 opening"); Object.assign(data.body.detail, change);
    replaceFetch(url => response(url.includes("/activities/list") ? acList([activity(129585, "")]) : data));
    await assert.rejects(scrapeTorontoComputer, /availability unknown/);
  }
});

test("one failed detail rejects the exam type including other apparently open children", async () => {
  replaceFetch(url => url.includes("/activities/list") ? response(acList([activity(1, ""), activity(2, "")]))
    : url.includes("/detail/1?") ? response(detail(1, "3 openings")) : response({}, 403));
  await assert.rejects(scrapeTorontoComputer, /detail check\(s\) failed; availability unknown/);
});

test("missing, unknown or unsuccessful detail cannot generate an opening", async () => {
  for (const data of [detail(129585, ""), detail(129585, "Ask the centre"), { headers: { response_code: "0000" }, body: {} },
    { ...detail(129585, "1 opening"), headers: { response_code: "1001" } }]) {
    replaceFetch(url => response(url.includes("/activities/list") ? acList([activity(129585, "")]) : data));
    await assert.rejects(scrapeTorontoComputer, /availability unknown/);
  }
});

test("unknown dates fail; concrete activity numbers can fill a missing detail date", async () => {
  replaceFetch(url => response(url.includes("/activities/list") ? acList([{ ...activity(129585, ""), number: "invalid" }]) : detail(129585, "3 openings", "")));
  await assert.rejects(scrapeTorontoComputer, /availability unknown/);
  replaceFetch(url => response(url.includes("/activities/list") ? acList([activity(129585, "")]) : detail(129585, "3 openings", "")));
  assert.equal((await scrapeTorontoComputer())[0].date, "2026-10-23");
});

test("paper retains its CM source, exam type and times while confirming a child detail", async () => {
  replaceFetch(url => {
    if (url.includes("cm-api")) {
      assert.equal(new URL(url).searchParams.get("othercategory"), "368");
      return response({ ...list([item()]), items: [{ ...item(), date_patterns: [{
        activity_start_date: "2026-11-20", activity_start_time: "9:00:00", activity_end_time: "12:00:00",
      }] }] });
    }
    return response(detail(123, "2 openings", "2026-11-20"));
  });
  const [slot] = await scrapeTorontoPaper();
  assert.equal(slot.examType, "P-TCF Canada"); assert.equal(slot.startTime, "09:00"); assert.equal(slot.endTime, "12:00");
});

test("configured computer child failure preserves state; verified empty hierarchy alone clears it", async () => {
  const source = createSources().find(source => source.key === "toronto" && source.source === "computer")!;
  const writes: unknown[] = [];
  const io: MonitorDependencies = {
    getPrevState: async () => [{ city: "toronto", exam_type: "E-TCF Canada", slots: [{ id: "129464" }] }],
    upsertState: async (...args) => { writes.push(args); },
    notifyDiscord: async () => assert.fail("no notification is due"),
    runRegistrationReminders: async () => assert.fail("not a reminder source"),
  };
  replaceFetch(url => url.includes("/activities/list") ? response(acList([activity(10, "On hold", [11])])) : response({}, 403));
  await assert.rejects(runMonitor([source], false, io), /computer \(scrape\)/);
  assert.deepEqual(writes, []);
  replaceFetch(() => response(acList([activity(129464, "", [])])));
  await runMonitor([source], false, io);
  assert.deepEqual(writes, [["toronto", "E-TCF Canada", [], false]]);
});

test("incomplete null ID discovery preserves the previous computer snapshot", async () => {
  const source = createSources().find(source => source.key === "toronto" && source.source === "computer")!;
  const io: MonitorDependencies = {
    getPrevState: async () => [{ city: "toronto", exam_type: "E-TCF Canada", slots: [{ id: "keep" }] }],
    upsertState: async () => assert.fail("an unknown snapshot must not be persisted"),
    notifyDiscord: async () => assert.fail("an unknown snapshot must not notify"),
    runRegistrationReminders: async () => assert.fail("not a reminder source"),
  };
  for (const childResponse of [response(acList([], "sub_activities")), response({}, 403)]) {
    replaceFetch(url => url.includes("/activities/list") ? response(acList([nullChildIds.parent])) : childResponse.clone());
    await assert.rejects(runMonitor([source], false, io), /computer \(scrape\)/);
  }
});
