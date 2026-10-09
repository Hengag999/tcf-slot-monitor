import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createSources, processCity, type MonitorDependencies } from "../scripts/scrape-slots";
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
