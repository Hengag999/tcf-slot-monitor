import { test } from "node:test";
import assert from "node:assert/strict";
import { createSources, processCity, runMonitor, type MonitorDependencies } from "../scripts/scrape-slots";
import { scrapeMontrealAf } from "../scripts/scrapers/montrealAf";
import { formatSlotNotification } from "../src/lib/discord";
import type { StateRow } from "../src/lib/db";

test("Montréal exhausted key-page retries fail every run without grace, preserve state and let later sources finish", async context => {
  const summary = process.env.GITHUB_STEP_SUMMARY;
  delete process.env.GITHUB_STEP_SUMMARY;
  context.after(() => {
    if (summary === undefined) delete process.env.GITHUB_STEP_SUMMARY; else process.env.GITHUB_STEP_SUMMARY = summary;
  });
  for (const method of ["log", "warn", "error"] as const) context.mock.method(console, method, () => {});
  const table = context.mock.method(console, "table", () => {});
  const source = createSources().find(s => s.key === "montreal-af")!;
  assert.equal(source.aecKeyPageGrace, undefined);
  const previous: StateRow = { city: source.key, exam_type: "TCF Canada", slots: [{ id: "keep", date: "2026-12-01" }], checked_at: "2026-11-12T14:45:00Z" };
  const saved = structuredClone(previous);
  let laterScrapes = 0;
  const reads: string[] = [];
  const writes: string[] = [];
  const io: MonitorDependencies = {
    getPrevState: async key => { reads.push(key); return key === source.key ? [saved] : []; },
    upsertState: async (key, exam_type, slots) => {
      writes.push(key);
      if (key === source.key) Object.assign(saved, { exam_type, slots });
    },
    notifyDiscord: async () => assert.fail("an exhausted scrape must not notify"),
    runRegistrationReminders: async () => assert.fail("not a reminder source"),
  };
  const later = { ...source, key: "later", scrape: async () => { laterScrapes++; return []; } };
  for (const status of [521, 522]) {
    let attempts = 0;
    const sleeps: number[] = [];
    const blocked = { ...source, scrape: () => scrapeMontrealAf({
      fetchImpl: async input => {
        assert.equal(String(input), "https://afmontreal.aec.app/");
        attempts++;
        return new Response("origin unavailable", { status });
      },
      sleep: async ms => { sleeps.push(ms); },
    }) };
    await assert.rejects(runMonitor([blocked, later], false, io), /montreal-af \(scrape\)/);
    assert.equal(attempts, 3);
    assert.deepEqual(sleeps, [1000, 2000]);
    assert.deepEqual(saved, previous, "saved availability and checked_at remain unchanged");
    assert.deepEqual(table.mock.calls.at(-1)!.arguments[0], [
      { source: "montreal-af", status: "SCRAPE FAILED — state preserved" },
      { source: "later", status: "OK" },
    ]);
  }
  assert.equal(laterScrapes, 2);
  assert.deepEqual(reads, ["later", "later"], "no Montréal or outage-health reads");
  assert.deepEqual(writes, ["later", "later"], "no Montréal or outage-health writes");
});

test("two Montréal centres with the same date notify independently and deduplicate within each channel", async () => {
  const sources = createSources();
  const af = sources.find(s => s.key === "montreal-af")!;
  const uqam = sources.find(s => s.key === "montreal-uqam")!;
  const states = new Map<string, StateRow>();
  const messages: { url: string; text: string }[] = [];
  const io: MonitorDependencies = {
    getPrevState: async key => states.has(key) ? [states.get(key)!] : [],
    upsertState: async (city, exam_type, slots) => { states.set(city, { city, exam_type, slots }); },
    notifyDiscord: async (url, ...args) => { messages.push({ url, text: formatSlotNotification(...args) }); },
    runRegistrationReminders: async () => assert.fail("unexpected reminder"),
  };
  const oldAf = process.env[af.webhookEnv], oldUqam = process.env[uqam.webhookEnv];
  try {
    process.env[af.webhookEnv] = "https://example.org/mock-af";
    process.env[uqam.webhookEnv] = "https://example.org/mock-uqam";
    const date = { id: "dec", examType: "TCF Canada", date: "2026-12-04", bookingUrl: "https://example.org/registration" };
    const later = { ...date, id: "jan", date: "2027-01-15" };
    await processCity(af, [date], false, io);
    await processCity(uqam, [date], false, io);
    await processCity(uqam, [date, later], false, io);
    await processCity(uqam, [date, later], false, io);
    assert.deepEqual(messages.map(m => m.url), [process.env[af.webhookEnv], process.env[uqam.webhookEnv], process.env[uqam.webhookEnv]]);
    assert.match(messages[2].text, /官网日历标为开放报名/);
    assert.match(messages[2].text, /2027-01-15/);
    assert.doesNotMatch(messages[2].text, /新开放.*考位|2026-12-04/);
    assert.equal(states.get(af.key)?.slots.length, 1);
    assert.equal(states.get(uqam.key)?.slots.length, 2);
    await processCity(af, [], false, io);
    assert.deepEqual(states.get(af.key)?.slots, []);
    assert.equal(states.get(uqam.key)?.slots.length, 2);
  } finally {
    if (oldAf === undefined) delete process.env[af.webhookEnv]; else process.env[af.webhookEnv] = oldAf;
    if (oldUqam === undefined) delete process.env[uqam.webhookEnv]; else process.env[uqam.webhookEnv] = oldUqam;
  }
});
