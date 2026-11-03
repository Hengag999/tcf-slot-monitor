import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createSources, processCity, runMonitor, type MonitorDependencies } from "../scripts/scrape-slots";
import { NORTH_YORK_API_URL, parseNorthYorkSchedules, scrapeNorthYork } from "../scripts/scrapers/northyork";
import type { StateRow } from "../src/lib/db";

// Four actual public records captured 2026-10-09: one of 171 Computer
// schedules and all three Paper schedules. Unused upstream fields omitted.
const fixture = JSON.parse(readFileSync(new URL("./fixtures/northyork-computer-paper.json", import.meta.url), "utf8"));
function fakeFetch(body: unknown, status = 200): typeof fetch {
  return (async (input, init) => {
    assert.equal(String(input), NORTH_YORK_API_URL);
    assert.equal(new URL(String(input)).searchParams.has("format_id"), false);
    assert.equal(new URL(String(input)).searchParams.get("test_id"), "6");
    assert.equal(new URL(String(input)).searchParams.get("has_available_seats"), "true");
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal);
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
}

test("North York fetches both live TCF Canada formats without changing existing Computer identity", async () => {
  const slots = await scrapeNorthYork({ fetchImpl: fakeFetch(fixture) });
  assert.deepEqual(slots.map(s => [s.id, s.examType, s.date, s.startTime, s.endTime, s.availableSeats]), [
    ["1095", "TCF Canada - Computer", "2026-10-17", "06:00", "09:00", 10],
    ["1426", "TCF Canada - Paper", "2027-01-05", "10:00", "13:00", 13],
    ["1427", "TCF Canada - Paper", "2027-01-26", "10:00", "13:00", 25],
    ["1485", "TCF Canada - Paper", "2027-02-23", "10:00", "13:00", 26],
  ]);
  assert.ok(slots.every(s => s.bookingUrl === "https://www.gblc.ca/en/book-now/choose-date"));
});

test("North York rejects unknown envelopes, identities, and duplicated records", () => {
  assert.throws(() => parseNorthYorkSchedules({ results: fixture, next: "/page/2" }), /complete schedule array/);
  const bad = [
    null,
    { ...fixture[0], tests: { id: 7, title: "TCF Quebec" } },
    { ...fixture[0], tests: { id: 6, title: "TCF Quebec" } },
    { ...fixture[0], formats: { id: 4, title: "Computer" } },
    { ...fixture[0], formats: { id: 8, title: "Unknown" } },
    { ...fixture[0], location: "Unrecognized centre" },
    { ...fixture[0], id: "1095" },
  ];
  for (const row of bad) assert.throws(() => parseNorthYorkSchedules([row]), /identity/);
  assert.throws(() => parseNorthYorkSchedules([fixture[0], fixture[0]]), /duplicate/);
});

test("North York rejects inconsistent availability rather than accepting a partial snapshot", () => {
  const bad = [
    { ...fixture[0], has_available_seats: false },
    { ...fixture[0], taken_seats: fixture[0].seats },
    { ...fixture[0], taken_seats: -1 },
    { ...fixture[0], seats: "40" },
    { ...fixture[0], start_at_date: "2027-02-30" },
    { ...fixture[0], group_time_start: "24:00:00" },
    { ...fixture[0], group_time_end: null },
  ];
  for (const row of bad) assert.throws(() => parseNorthYorkSchedules([fixture[1], row]), /availability/);
});

test("North York accepts a valid empty response and rejects failed requests", async () => {
  assert.deepEqual(await scrapeNorthYork({ fetchImpl: fakeFetch([]) }), []);
  await assert.rejects(scrapeNorthYork({ fetchImpl: fakeFetch({}, 503) }), /503/);
});

function connectionError(code: string): TypeError {
  return new TypeError("private transport details", { cause: Object.assign(new Error("private endpoint"), { code }) });
}

function requestSequence(outcomes: (Error | Response)[]) {
  const signals: AbortSignal[] = [];
  const sleeps: number[] = [];
  let calls = 0;
  const fetchImpl = (async (input, init) => {
    assert.equal(String(input), NORTH_YORK_API_URL);
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal);
    signals.push(init.signal);
    const outcome = outcomes[calls++];
    assert.notEqual(outcome, undefined, "unexpected retry beyond supplied responses");
    if (outcome instanceof Error) throw outcome;
    return outcome;
  }) as typeof fetch;
  return {
    calls: () => calls,
    signals,
    sleeps,
    fetchImpl,
    publicDnsFetchImpl: (signal: AbortSignal) => fetchImpl(NORTH_YORK_API_URL, { signal, redirect: "error" }),
    sleep: async (ms: number) => { sleeps.push(ms); },
  };
}

test("North York recovers observed connection failures with bounded GET backoff and fresh deadlines", async () => {
  const io = requestSequence([connectionError("ECONNREFUSED"), connectionError("UND_ERR_CONNECT_TIMEOUT"),
    new Response(JSON.stringify(fixture))]);
  assert.deepEqual(await scrapeNorthYork(io), parseNorthYorkSchedules(fixture));
  assert.equal(io.calls(), 3);
  assert.deepEqual(io.sleeps, [1000, 2000]);
  assert.equal(new Set(io.signals).size, 3);
});

test("North York exhaustion fails the workflow without reading or overwriting either format", async () => {
  const io = requestSequence(Array.from({ length: 3 }, () => connectionError("ECONNREFUSED")));
  const source = createSources().find(city => city.key === "northyork")!;
  const fail = async () => assert.fail("failed scrape must not access state or Discord");
  const summary = process.env.GITHUB_STEP_SUMMARY;
  delete process.env.GITHUB_STEP_SUMMARY;
  try {
    await assert.rejects(runMonitor([{ ...source, scrape: () => scrapeNorthYork(io) }], false, {
      getPrevState: fail, upsertState: fail, notifyDiscord: fail, runRegistrationReminders: fail,
    }), /northyork \(scrape\)/);
    assert.equal(io.calls(), 3);
    assert.deepEqual(io.sleeps, [1000, 2000]);
  } finally {
    if (summary !== undefined) process.env.GITHUB_STEP_SUMMARY = summary;
  }
  const exhausted = requestSequence(Array.from({ length: 3 }, () => connectionError("UND_ERR_CONNECT_TIMEOUT")));
  await assert.rejects(scrapeNorthYork(exhausted), error => {
    assert.equal((error as Error).message, "GBLC: schedule connection failed after 3 attempts (code=UND_ERR_CONNECT_TIMEOUT)");
    assert.equal((error as Error).cause, undefined);
    return true;
  });
});

test("North York never retries HTTP responses, unknown transport errors, TLS, DNS or response-body failures", async () => {
  const failures = [new Error("unknown"), connectionError("ENOTFOUND"), connectionError("CERT_HAS_EXPIRED"),
    connectionError("ECONNRESET"), new AggregateError([connectionError("ECONNREFUSED"), new Error("unknown")]),
    new TypeError("unknown wrapper", { cause: new Error("unknown") })];
  for (const failure of failures) {
    const io = requestSequence([failure]);
    await assert.rejects(scrapeNorthYork(io), /non-retryable transport error/);
    assert.equal(io.calls(), 1);
    assert.deepEqual(io.sleeps, []);
  }
  for (const status of [301, 401, 403, 429, 500, 503]) {
    const io = requestSequence([new Response("unread error body", { status })]);
    await assert.rejects(scrapeNorthYork(io), new RegExp(`GBLC API error ${status}`));
    assert.equal(io.calls(), 1);
    assert.deepEqual(io.sleeps, []);
  }
  const response = new Response("[]");
  response.json = async () => { throw connectionError("ECONNREFUSED"); };
  const io = requestSequence([response]);
  await assert.rejects(scrapeNorthYork(io));
  assert.equal(io.calls(), 1, "body errors must never replay a response");
});

test("North York connection recovery still requires complete valid inventory and stops on a different failure", async () => {
  for (const response of [new Response(JSON.stringify({ results: fixture })),
    new Response(JSON.stringify([fixture[0], { ...fixture[1], seats: 0 }])),
    new Response("not JSON"), new Response("blocked", { status: 403 }),
    connectionError("CERT_HAS_EXPIRED")]) {
    const io = requestSequence([connectionError("ECONNREFUSED"), response]);
    await assert.rejects(scrapeNorthYork(io));
    assert.equal(io.calls(), 2);
    assert.deepEqual(io.sleeps, [1000]);
  }
});

test("configured North York source sends only new Paper dates and deduplicates each format independently", async (t) => {
  t.mock.method(globalThis, "fetch", fakeFetch(fixture));
  const city = createSources().find(source => source.key === "northyork")!;
  assert.equal(city.diffByDate, true);
  assert.equal(city.webhookEnv, "DISCORD_WEBHOOK_NORTHYORK");
  const slots = await city.scrape();
  const rows: StateRow[] = [{ city: "northyork", exam_type: "TCF Canada - Computer", slots: [slots[0]] }];
  const sent: Parameters<MonitorDependencies["notifyDiscord"]>[] = [];
  const io: MonitorDependencies = {
    getPrevState: async () => structuredClone(rows),
    upsertState: async (key, type, snapshot) => {
      const index = rows.findIndex(row => row.exam_type === type);
      const row = { city: key, exam_type: type, slots: structuredClone(snapshot) };
      if (index < 0) rows.push(row); else rows[index] = row;
    },
    notifyDiscord: async (...args) => { sent.push(structuredClone(args)); },
    runRegistrationReminders: async () => assert.fail("North York uses availability diffs"),
  };
  const webhook = process.env[city.webhookEnv];
  process.env[city.webhookEnv] = "https://example.com/test-webhook";
  try {
    await processCity(city, slots, false, io);
    await processCity(city, slots, false, io);
    assert.equal(sent.length, 1);
    assert.equal(sent[0][2], "TCF Canada - Paper");
    assert.deepEqual(sent[0][3].map(s => s.date), ["2027-01-05", "2027-01-26", "2027-02-23"]);
    assert.deepEqual(rows.map(row => [row.exam_type, row.slots.length]), [["TCF Canada - Computer", 1], ["TCF Canada - Paper", 3]]);
    // A paper date disappearing never clears the unchanged Computer snapshot.
    await processCity(city, [slots[0]], false, io);
    assert.deepEqual(rows.map(row => [row.exam_type, row.slots.length]), [["TCF Canada - Computer", 1], ["TCF Canada - Paper", 0]]);
    assert.equal(sent.length, 1);
  } finally {
    if (webhook === undefined) delete process.env[city.webhookEnv];
    else process.env[city.webhookEnv] = webhook;
  }
});
