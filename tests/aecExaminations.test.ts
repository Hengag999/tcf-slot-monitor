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
    await assert.rejects(scrapeOttawa({ fetchImpl: fakeFetch({ "5": computer, "79": body }) }), /Ottawa:/);
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
