import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { scrapeHalifax } from "../scripts/scrapers/halifax";
import { scrapeOttawa } from "../scripts/scrapers/ottawa";

// Minimal public API fields captured 2026-10-09. No API key, customer data,
// descriptions, media metadata or account-specific URLs are stored here.
const halifax = readFileSync(new URL("./fixtures/aec-halifax-2026-10-09.json", import.meta.url), "utf8");
const computer = readFileSync(new URL("./fixtures/aec-ottawa-computer-2026-10-09.json", import.meta.url), "utf8");
const paper = readFileSync(new URL("./fixtures/aec-ottawa-paper-2026-10-09.json", import.meta.url), "utf8");

function fakeFetch(types: Record<string, string | number>, requests: string[] = []): typeof fetch {
  return (async (input, options) => {
    const url = new URL(String(input));
    requests.push(url.pathname);
    assert.ok(options?.signal, "public requests have a timeout");
    assert.equal(options?.redirect, "error");
    if (url.pathname === "/") return new Response('{"APIKEY":"public-test-fixture"}');
    assert.equal(new Headers(options?.headers).get("API_KEY"), "public-test-fixture");
    assert.equal(url.searchParams.get("allBranches"), "N");
    const id = url.pathname.split("/").at(-1)!;
    assert.ok(Object.hasOwn(types, id), `unexpected examination type ${id}`);
    const body = types[id];
    return typeof body === "number"
      ? new Response(body === 204 ? null : "unavailable", { status: body })
      : new Response(body);
  }) as typeof fetch;
}

function changeHalifax(change: (data: any[]) => void): string {
  const data = JSON.parse(halifax);
  change(data);
  return JSON.stringify(data);
}

test("Halifax captures all 17 bookable sittings from the 29-row official type, including rows past 16", async () => {
  const requests: string[] = [];
  const slots = await scrapeHalifax({ fetchImpl: fakeFetch({ "16": halifax }, requests) });
  assert.deepEqual(requests, ["/", "/api/v1/public/examinations/list/1/16"]);
  assert.equal(slots.length, 17);
  assert.deepEqual(slots.map(slot => slot.id), ["1059", "1176", "1149", "1150", "1163", "1164", "1151", "1152", "1153", "1154", "1155", "1156", "1157", "1158", "1159", "1160", "1161"]);
  assert.equal(slots[0].date, "2026-10-14");
  assert.equal(slots.at(-1)!.date, "2026-12-16");
  assert.equal(slots[0].startTime, "12:30");
  assert.ok(slots.every(slot => slot.examType === "TCF Canada" && slot.bookingUrl.endsWith(`#/addExamination/${slot.id}`)));
});

test("Ottawa validates both current Canada formats and retains stable product labels", async () => {
  const requests: string[] = [];
  const slots = await scrapeOttawa({ fetchImpl: fakeFetch({ "5": computer, "79": paper }, requests) });
  assert.deepEqual(requests, ["/", "/api/v1/public/examinations/list/1/5", "/api/v1/public/examinations/list/1/79"]);
  assert.equal(slots.length, 4);
  assert.ok(slots.every(slot => slot.examType === "TCF Canada sur ordinateur"));
  assert.deepEqual(slots.map(slot => slot.date), ["2026-12-02", "2026-12-07", "2026-12-08", "2026-12-09"]);
});

test("explicit HTTP 204 and validated empty arrays remain accepted empty states", async () => {
  for (const body of [204, "[]", changeHalifax(data => { data[0].examinations = []; })]) {
    assert.deepEqual(await scrapeHalifax({ fetchImpl: fakeFetch({ "16": body }) }), []);
  }
  const slots = await scrapeOttawa({ fetchImpl: fakeFetch({ "5": computer, "79": 204 }) });
  assert.equal(slots.length, 4);
});

test("blank 200, objects and malformed group arrays reject instead of clearing availability", async () => {
  for (const body of ["", " ", "{}", '{"error":"not available"}', "null", "not-json", "[null]", "[{}]", changeHalifax(data => { delete data[0].examinations; })]) {
    await assert.rejects(scrapeHalifax({ fetchImpl: fakeFetch({ "16": body }) }), /invalid examinations response/);
  }
});

test("a malformed or failed Ottawa paper endpoint rejects the complete source even when computer succeeds", async () => {
  for (const body of ["{}", 503]) {
    await assert.rejects(scrapeOttawa({ fetchImpl: fakeFetch({ "5": computer, "79": body }), sleep: async () => {} }), /Ottawa:/);
  }
});

function ottawaSequence(sequence: Array<string | number | Error>, failedType = "5") {
  const requests: string[] = [];
  const sleeps: number[] = [];
  const signals: AbortSignal[] = [];
  const discarded: Response[] = [];
  const valid = fakeFetch({ "5": computer, "79": paper }, requests);
  let attempts = 0;
  const fetchImpl = (async (input, options) => {
    const path = new URL(String(input)).pathname;
    if (!path.endsWith(`/list/1/${failedType}`)) return valid(input, options);
    assert.equal(options?.redirect, "error");
    assert.equal(new Headers(options?.headers).get("API_KEY"), "public-test-fixture");
    assert.ok(options?.signal);
    assert.ok(discarded.every(response => response.bodyUsed), "discarded responses released before retry");
    signals.push(options.signal);
    const outcome = sequence[attempts++];
    assert.notEqual(outcome, undefined, "retry budget exceeded");
    if (outcome instanceof Error) throw outcome;
    if (typeof outcome === "number") {
      const response = new Response("upstream error", { status: outcome });
      discarded.push(response);
      return response;
    }
    return new Response(outcome);
  }) as typeof fetch;
  return {
    fetchImpl, requests, signals, sleeps,
    sleep: async (ms: number) => { sleeps.push(ms); },
    attempts: () => attempts,
  };
}

test("Ottawa recovers selected server errors within the same complete scrape", async () => {
  for (const sequence of [[500, computer], [502, 503, computer], [504, computer]]) {
    const io = ottawaSequence(sequence);
    const slots = await scrapeOttawa(io);
    assert.equal(slots.length, 4);
    assert.equal(io.attempts(), sequence.length);
    assert.deepEqual(io.sleeps, sequence.length === 3 ? [1000, 2000] : [1000]);
    assert.equal(new Set(io.signals).size, sequence.length, "fresh deadline for every attempt");
    assert.deepEqual(io.requests, ["/", "/api/v1/public/examinations/list/1/79"]);
  }
});

test("Ottawa exhausts at three server errors and never returns the other format alone", async () => {
  const io = ottawaSequence([500, 500, 500], "79");
  await assert.rejects(scrapeOttawa(io), /Ottawa: examinations API returned 500 for type 79/);
  assert.equal(io.attempts(), 3);
  assert.deepEqual(io.sleeps, [1000, 2000]);
  assert.deepEqual(io.requests, ["/", "/api/v1/public/examinations/list/1/5"]);
});

test("Ottawa does not retry auth, rate limits, unknown server statuses, malformed data or transport failures", async () => {
  for (const outcome of [401, 403, 404, 429, 501, 505, 522, "{}", "not-json", new TypeError("fetch failed")]) {
    const io = ottawaSequence([outcome]);
    await assert.rejects(scrapeOttawa(io));
    assert.equal(io.attempts(), 1);
    assert.deepEqual(io.sleeps, []);
  }
  const mixed = ottawaSequence([500, "{}"]);
  await assert.rejects(scrapeOttawa(mixed), /invalid examinations response/);
  assert.equal(mixed.attempts(), 2);
  assert.deepEqual(mixed.sleeps, [1000]);
});

test("non-522 key discovery errors and Halifax examination errors retain single-request failure behavior", async () => {
  for (const outcome of [500, "missing key"]) {
    let calls = 0;
    await assert.rejects(scrapeOttawa({
      fetchImpl: (async () => { calls++; return typeof outcome === "number" ? new Response("error", { status: outcome }) : new Response(outcome); }) as typeof fetch,
      sleep: async () => assert.fail("key discovery must not retry"),
    }));
    assert.equal(calls, 1);
  }
  const requests: string[] = [];
  await assert.rejects(scrapeHalifax({ fetchImpl: fakeFetch({ "16": 503 }, requests) }), /examinations API returned 503/);
  assert.deepEqual(requests, ["/", "/api/v1/public/examinations/list/1/16"]);
});

function keyPageSequence(sequence: Array<string | number | Error>) {
  const requests: string[] = [];
  const sleeps: number[] = [];
  const signals: AbortSignal[] = [];
  const discarded: Response[] = [];
  const valid = fakeFetch({"16": halifax, "5": computer, "79": paper}, requests);
  let attempts = 0;
  const fetchImpl = (async (input, options) => {
    if (new URL(String(input)).pathname !== "/") return valid(input, options);
    requests.push("/");
    assert.equal(options?.redirect, "error");
    assert.ok(options?.signal);
    assert.ok(discarded.every(response => response.bodyUsed), "release 522 bodies before retrying");
    signals.push(options.signal);
    const outcome = sequence[attempts++];
    assert.notEqual(outcome, undefined, "key-page retry budget exceeded");
    if (outcome instanceof Error) throw outcome;
    const response = new Response(typeof outcome === "number" ? "upstream timeout" : outcome,
      {status: typeof outcome === "number" ? outcome : 200});
    if (outcome === 522) discarded.push(response);
    return response;
  }) as typeof fetch;
  return {fetchImpl, requests, signals, sleeps, attempts: () => attempts,
    sleep: async (ms: number) => { sleeps.push(ms); }};
}

test("both AEC centres recover key-page 522 responses before validating complete inventory", async () => {
  for (const scrape of [scrapeHalifax, scrapeOttawa]) {
    for (const errors of [1, 2]) {
      const io = keyPageSequence([...Array(errors).fill(522), '{"APIKEY":"public-test-fixture"}']);
      const slots = await scrape(io);
      assert.equal(slots.length, scrape === scrapeHalifax ? 17 : 4);
      assert.equal(io.attempts(), errors + 1);
      assert.equal(new Set(io.signals).size, errors + 1, "fresh deadline for each GET");
      assert.deepEqual(io.sleeps, errors === 1 ? [1000] : [1000, 2000]);
      assert.equal(io.requests.filter(path => path !== "/").length, scrape === scrapeHalifax ? 1 : 2);
    }
  }
});

test("persistent AEC key-page 522 stops after three attempts without fetching or returning inventory", async () => {
  for (const scrape of [scrapeHalifax, scrapeOttawa]) {
    const io = keyPageSequence([522, 522, 522]);
    await assert.rejects(scrape(io), /failed to fetch page for API key \(522\)/);
    assert.equal(io.attempts(), 3);
    assert.deepEqual(io.sleeps, [1000, 2000]);
    assert.deepEqual(io.requests, ["/", "/", "/"]);
  }
});

test("AEC key-page retries remain exclusive to HTTP 522, including after an earlier timeout", async () => {
  for (const scrape of [scrapeHalifax, scrapeOttawa]) {
    for (const outcome of [401, 403, 404, 429, 500, 503, "missing key", new TypeError("fetch failed")]) {
      for (const prefix of [[], [522]]) {
        const io = keyPageSequence([...prefix, outcome]);
        await assert.rejects(scrape(io));
        assert.equal(io.attempts(), prefix.length + 1);
        assert.deepEqual(io.sleeps, prefix.length ? [1000] : []);
        assert.ok(io.requests.every(path => path === "/"), "never call inventory with unknown key");
      }
    }
  }
});

test("all validated matching groups are read instead of silently using only the first group", async () => {
  const split = changeHalifax(data => {
    const secondHalf = data[0].examinations.splice(15);
    data.push({ ...data[0], examinations: secondHalf });
  });
  const slots = await scrapeHalifax({ fetchImpl: fakeFetch({ "16": split }) });
  assert.equal(slots.length, 17);
  const unexpectedSecond = changeHalifax(data => { data.push({ ...data[0], IDEXAMINATION_TYPE: 17 }); });
  await assert.rejects(scrapeHalifax({ fetchImpl: fakeFetch({ "16": unexpectedSecond }) }), /unexpected branch or examination type/);
});

test("wrong branch, exam category and product identities reject rather than masquerading as TCF Canada", async () => {
  for (const change of [
    (data: any[]) => { data[0].IDETABLISHMENT_BRANCH = 2; },
    (data: any[]) => { data[0].name = "TEF Canada"; },
    (data: any[]) => { data[0].examinations[0].IDEXAMINATION_TYPE = 17; },
    (data: any[]) => { data[0].examinations[0].product_name = "TCF Québec"; },
  ]) {
    await assert.rejects(scrapeHalifax({ fetchImpl: fakeFetch({ "16": changeHalifax(change) }) }), /unexpected/);
  }
});

test("unknown or conflicting availability cannot become a positive or empty snapshot", async () => {
  for (const change of [
    (exam: any) => { delete exam.isFull; },
    (exam: any) => { exam.isFull = "false"; },
    (exam: any) => { delete exam.inscriptionIsInFuture; },
    (exam: any) => { delete exam.mainRegisterLink; },
    (exam: any) => { exam.mainRegisterLink = { link: "", label: "unknown_status" }; },
    (exam: any) => { exam.isFull = true; },
    (exam: any) => { exam.inscriptionIsInFuture = true; },
  ]) {
    await assert.rejects(scrapeHalifax({ fetchImpl: fakeFetch({ "16": changeHalifax(data => change(data[0].examinations[0])) }) }), /invalid examinations response/);
  }
});

test("known expired registration and explicit future registration are excluded", async () => {
  const body = changeHalifax(data => {
    data[0].examinations = data[0].examinations.slice(0, 2);
    data[0].examinations[0].mainRegisterLink = { link: "", label: "kiosque_examination_enrollment_date_over" };
    data[0].examinations[1].inscriptionIsInFuture = true;
    data[0].examinations[1].mainRegisterLink = { link: "", label: "examination_registration_opens_on" };
  });
  assert.deepEqual(await scrapeHalifax({ fetchImpl: fakeFetch({ "16": body }) }), []);
});

test("wrong destinations, IDs, dates and times invalidate the complete response", async () => {
  for (const change of [
    (exam: any) => { exam.mainRegisterLink.link = "javascript:alert(1)"; },
    (exam: any) => { exam.mainRegisterLink.link = "https://example.com/#/addExamination/1059"; },
    (exam: any) => { exam.mainRegisterLink.link = "https://afhalifax.ca/user/cart/#/addExamination/9999"; },
    (exam: any) => { exam.mainRegisterLink.label = "join_waitlist"; },
    (exam: any) => { exam.IDEXAMINATION = null; },
    (exam: any) => { exam.examination_date = "2026-02-30"; },
    (exam: any) => { exam.start_time = "25:00:00"; },
  ]) {
    await assert.rejects(scrapeHalifax({ fetchImpl: fakeFetch({ "16": changeHalifax(data => change(data[0].examinations[0])) }) }), /invalid examinations response/);
  }
  const duplicated = changeHalifax(data => { data[0].examinations.push(data[0].examinations[0]); });
  await assert.rejects(scrapeHalifax({ fetchImpl: fakeFetch({ "16": duplicated }) }), /duplicate examination ID/);
});
