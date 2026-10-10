import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSources, processCity, runMonitor, type CityConfig, type MonitorDependencies } from "../scripts/scrape-slots";
import { TorontoPaperChallengeError } from "../scripts/scrapers/toronto";
import { parseWinnipeg } from "../scripts/scrapers/winnipeg";
import { HEALTH_CITY, HEALTH_EXAM_TYPE } from "../src/lib/torontoPaperHealth";
import type { StateRow } from "../src/lib/db";

// Do not put mock failures/recoveries into the real GitHub job's source summary.
const inheritedSummary = process.env.GITHUB_STEP_SUMMARY;
beforeEach(() => { delete process.env.GITHUB_STEP_SUMMARY; });
afterEach(() => {
  if (inheritedSummary === undefined) delete process.env.GITHUB_STEP_SUMMARY;
  else process.env.GITHUB_STEP_SUMMARY = inheritedSummary;
});

const computer: CityConfig = { key: "toronto", source: "computer", label: "Toronto", scrape: async () => [], examTypes: ["E-TCF Canada"], webhookEnv: "TEST_MONITOR_WEBHOOK" };
const paper: CityConfig = { ...computer, source: "paper", examTypes: ["P-TCF Canada"] };
function harness() {
  const writes: { type: string; count: number; notified: boolean }[] = [];
  const sent: string[] = [];
  const io: MonitorDependencies = {
    getPrevState: async () => [
      { city: "toronto", exam_type: "E-TCF Canada", slots: [{ date: "2026-10-09" }] },
      { city: "toronto", exam_type: "P-TCF Canada", slots: [{ date: "2026-11-01" }] },
    ],
    upsertState: async (_city, type, slots, notified) => { writes.push({ type, count: slots.length, notified }); },
    notifyDiscord: async (_url, _label, type) => { sent.push(type); },
    runRegistrationReminders: async () => assert.fail("not a reminder"),
  };
  return { writes, sent, io };
}
test("failed paper preserves paper state while successful empty computer clears only computer", async () => {
  const { io, writes } = harness();
  await assert.rejects(runMonitor([{ ...paper, scrape: async () => { throw new Error("HTTP 403"); } }, computer], false, io), /paper \(scrape\)/);
  assert.deepEqual(writes, [{ type: "E-TCF Canada", count: 0, notified: false }]);
});
test("failed computer preserves computer state while successful paper clears only paper", async () => {
  const { io, writes } = harness();
  await assert.rejects(runMonitor([{ ...computer, scrape: async () => { throw new Error("timeout"); } }, paper], false, io));
  assert.deepEqual(writes, [{ type: "P-TCF Canada", count: 0, notified: false }, { type: HEALTH_EXAM_TYPE, count: 1, notified: false }]);
});
test("unexpected exam types reject before writes", async () => {
  const { io, writes } = harness();
  await assert.rejects(processCity(computer, [{ id: "wrong", date: "2026-11-01", examType: "P-TCF Canada", bookingUrl: "https://example.com" }], false, io), /unexpected exam type/);
  assert.equal(writes.length, 0);
});
test("missing webhook cannot consume a new availability notification", async () => {
  delete process.env.TEST_MONITOR_WEBHOOK;
  const { io, writes } = harness();
  io.getPrevState = async () => [];
  await assert.rejects(processCity(computer, [{ id: "new", date: "2026-11-01", examType: "E-TCF Canada", bookingUrl: "https://example.com" }], false, io), /webhook|WEBHOOK/);
  assert.equal(writes.length, 0);
});
test("notify failure does not stop subsequent source and does not persist failed notification", async () => {
  process.env.TEST_MONITOR_WEBHOOK = "https://example.com/webhook";
  const { io, writes } = harness();
  io.getPrevState = async () => [];
  io.notifyDiscord = async () => { throw new Error("Discord 500"); };
  const slots = [{ id: "new", date: "2026-11-01", examType: "E-TCF Canada", bookingUrl: "https://example.com" }];
  await assert.rejects(runMonitor([{ ...computer, scrape: async () => slots }, paper], false, io), /notify\/persist/);
  assert.deepEqual(writes, [{ type: "P-TCF Canada", count: 0, notified: false }, { type: HEALTH_EXAM_TYPE, count: 1, notified: false }]);
  delete process.env.TEST_MONITOR_WEBHOOK;
});
test("dry-run avoids database and Discord I/O", async () => {
  const fail = async () => { throw new Error("unexpected external I/O"); };
  await runMonitor([computer], true, { getPrevState: fail, upsertState: fail, notifyDiscord: fail, runRegistrationReminders: fail });
});

test("configured Winnipeg source forwards its published-data style and alerts only for new dates", async () => {
  const city = createSources().find(source => source.key === "winnipeg")!;
  assert.ok(city);
  assert.deepEqual(city.examTypes, ["TCF Canada"]);
  assert.equal(city.diffByDate, true);
  assert.equal(city.webhookEnv, "DISCORD_WEBHOOK_WINNIPEG");
  assert.equal(city.notificationStyle?.kind, "published-availability");
  const originalWebhook = process.env[city.webhookEnv];
  process.env[city.webhookEnv] = "https://example.com/test-webhook";
  const rows: StateRow[] = [];
  const sent: Parameters<MonitorDependencies["notifyDiscord"]>[] = [];
  const writes: { count: number; notified: boolean }[] = [];
  const slots = [3, 4, 10].map(day => ({
    id: `winnipeg-november-${day}`, date: `November ${day}`, examType: "TCF Canada",
    bookingUrl: "https://www.afmanitoba.ca/en/exams/tcf/register-tcf-canada/", availableSeats: 1,
  }));
  const io: MonitorDependencies = {
    getPrevState: async key => structuredClone(rows.filter(row => row.city === key)),
    upsertState: async (key, examType, snapshot, notified) => {
      assert.equal(key, "winnipeg");
      assert.equal(examType, "TCF Canada");
      rows.splice(0, rows.length, { city: key, exam_type: examType, slots: structuredClone(snapshot) });
      writes.push({ count: snapshot.length, notified });
    },
    notifyDiscord: async (...args) => { sent.push(structuredClone(args)); },
    runRegistrationReminders: async () => assert.fail("Winnipeg uses published availability, not registration reminders"),
  };
  try {
    await processCity(city, [], false, io); // First empty snapshot still proves freshness.
    await processCity(city, slots, false, io);
    await processCity(city, slots.map(slot => ({ ...slot, availableSeats: 2 })), false, io);
    const extra = { ...slots[0], id: "winnipeg-november-12", date: "November 12" };
    await processCity(city, [...slots, extra], false, io);
    await processCity(city, [...slots, extra], false, io);
    assert.deepEqual(sent.map(args => args[3].map(slot => slot.date)), [["November 3", "November 4", "November 10"], ["November 12"]]);
    assert.ok(sent.every(args => args[0] === "https://example.com/test-webhook" && args[1] === city.label && args[2] === "TCF Canada"));
    assert.ok(sent.every(args => JSON.stringify(args[4]) === JSON.stringify(city.notificationStyle)));
    assert.deepEqual(writes, [
      { count: 0, notified: false }, { count: 3, notified: true }, { count: 3, notified: false },
      { count: 4, notified: true }, { count: 4, notified: false },
    ]);
  } finally {
    if (originalWebhook === undefined) delete process.env[city.webhookEnv];
    else process.env[city.webhookEnv] = originalWebhook;
  }
});

test("Winnipeg layout recovery announces only the added date and preserves state on a later unknown page", async () => {
  const [oldHtml, newHtml] = await Promise.all([
    readFile(new URL("./fixtures/winnipeg-published-dates-2026-10-10.html", import.meta.url), "utf8"),
    readFile(new URL("./fixtures/winnipeg-paragraph-dates-2026-10-11.html", import.meta.url), "utf8"),
  ]);
  let html = newHtml;
  const configured = createSources().find(source => source.key === "winnipeg")!;
  const source = { ...configured, scrape: async () => parseWinnipeg(html) };
  const originalWebhook = process.env[source.webhookEnv];
  process.env[source.webhookEnv] = "https://example.com/test-webhook";
  let rows: StateRow[] = [{ city: "winnipeg", exam_type: "TCF Canada", slots: parseWinnipeg(oldHtml) }];
  const notifiedDates: string[][] = [];
  const writes: boolean[] = [];
  const io: MonitorDependencies = {
    getPrevState: async () => structuredClone(rows),
    upsertState: async (city, exam_type, slots, notified) => {
      rows = [{ city, exam_type, slots: structuredClone(slots) }];
      writes.push(notified);
    },
    notifyDiscord: async (_webhook, _label, _examType, slots) => { notifiedDates.push(slots.map(slot => slot.date)); },
    runRegistrationReminders: async () => assert.fail("not a reminder source"),
  };
  try {
    await runMonitor([source], false, io);
    await runMonitor([source], false, io);
    assert.deepEqual(notifiedDates, [["October 20"]]);
    assert.deepEqual(writes, [true, false]);
    assert.deepEqual(rows[0].slots, parseWinnipeg(newHtml));
    html = newHtml.replace("spots available!", "Waitlist only!");
    await assert.rejects(runMonitor([source], false, io), /winnipeg \(scrape\)/);
    assert.deepEqual(writes, [true, false]);
    assert.deepEqual(rows[0].slots, parseWinnipeg(newHtml));
    assert.deepEqual(notifiedDates, [["October 20"]]);
  } finally {
    if (originalWebhook === undefined) delete process.env[source.webhookEnv];
    else process.env[source.webhookEnv] = originalWebhook;
  }
});

const t0 = Date.parse("2026-10-07T00:00:00Z");
const minute = 60_000;
const blockedPaper: CityConfig = { ...paper, scrape: async () => { throw new TorontoPaperChallengeError("known challenge"); } };
function policyHarness() {
  let time = t0;
  const rows: StateRow[] = [{ city: "toronto", exam_type: "P-TCF Canada", slots: [{ id: "keep" }], checked_at: new Date(t0).toISOString() }];
  const io: MonitorDependencies = {
    getPrevState: async city => structuredClone(rows.filter(row => row.city === city)),
    upsertState: async (city, exam_type, slots) => {
      const next = { city, exam_type, slots: structuredClone(slots), checked_at: new Date(time).toISOString() };
      const index = rows.findIndex(row => row.city === city && row.exam_type === exam_type);
      if (index < 0) rows.push(next); else rows[index] = next;
    },
    notifyDiscord: async () => assert.fail("no notifications expected"),
    runRegistrationReminders: async () => assert.fail("no reminders expected"),
  };
  return { io, rows, run: (sources: CityConfig[], mins: number) => {
    time = t0 + mins * minute;
    return runMonitor(sources, false, io, () => time);
  } };
}

test("a recognized Toronto paper challenge is degraded without failing or changing availability", async () => {
  const { rows, run } = policyHarness();
  const prior = structuredClone(rows[0]);
  await run([blockedPaper, computer], 15);
  assert.deepEqual(rows[0], prior);
  assert.ok(rows.some(row => row.city === HEALTH_CITY));
  assert.ok(rows.some(row => row.exam_type === "E-TCF Canada"));
});

test("one sustained challenge fails once per incident and recovery rearms the one-hour alert", async () => {
  const { rows, run } = policyHarness();
  await run([blockedPaper], 59);
  await assert.rejects(run([blockedPaper], 60), /one-hour challenge outage/);
  await run([blockedPaper], 65);
  await run([paper], 70);
  await run([blockedPaper], 75);
  await assert.rejects(run([blockedPaper], 130), /one-hour challenge outage/);
  assert.deepEqual(rows.find(row => row.exam_type === "P-TCF Canada")?.slots, []);
});

test("other locations still fail while Toronto is in grace or an already-reported outage", async () => {
  const { run } = policyHarness();
  const failedCalgary = { ...computer, key: "calgary", source: undefined, scrape: async () => { throw new Error("upstream timeout"); } };
  await assert.rejects(run([blockedPaper, failedCalgary], 15), /calgary \(scrape\)/);
  await assert.rejects(run([blockedPaper], 60), /one-hour challenge outage/);
  await assert.rejects(run([blockedPaper, failedCalgary], 65), /calgary \(scrape\)/);
});

test("unknown Toronto errors and typed challenges on another source never receive grace", async () => {
  const { rows, run } = policyHarness();
  await assert.rejects(run([{ ...paper, scrape: async () => { throw new Error("classification=siteground-challenge"); } }], 5), /paper \(scrape\)/);
  await assert.rejects(run([{ ...computer, scrape: blockedPaper.scrape }], 10), /computer \(scrape\)/);
  assert.equal(rows.some(row => row.city === HEALTH_CITY), false);
});

test("health storage failures remain workflow failures and later sources still run", async () => {
  for (const method of ["read", "write"] as const) {
    const { io, rows, run } = policyHarness();
    if (method === "read") {
      const read = io.getPrevState;
      io.getPrevState = async city => { if (city === HEALTH_CITY) throw new Error("database read failed"); return read(city); };
    } else {
      const write = io.upsertState;
      io.upsertState = async (...args) => { if (args[0] === HEALTH_CITY) throw new Error("database write failed"); return write(...args); };
    }
    await assert.rejects(run([blockedPaper, computer], 15), /health state/);
    assert.ok(rows.some(row => row.exam_type === "E-TCF Canada"));
    assert.equal(rows.some(row => row.city === HEALTH_CITY), false);
    assert.deepEqual(rows[0].slots, [{ id: "keep" }]);
  }
});

test("a paper notification failure never resets an ongoing challenge incident", async () => {
  const { io, rows, run } = policyHarness();
  await assert.rejects(run([blockedPaper], 60), /one-hour challenge outage/);
  const previousHealth = structuredClone(rows.find(row => row.city === HEALTH_CITY));
  rows[0].slots = [];
  const priorWebhook = process.env.TEST_MONITOR_WEBHOOK;
  process.env.TEST_MONITOR_WEBHOOK = "https://example.com/webhook";
  io.notifyDiscord = async () => { throw new Error("Discord unavailable"); };
  try {
    await assert.rejects(run([{ ...paper, scrape: async () => [{ id: "new", examType: "P-TCF Canada", date: "2026-11-01", bookingUrl: "https://example.com" }] }], 65), /notify\/persist/);
    assert.deepEqual(rows.find(row => row.city === HEALTH_CITY), previousHealth);
  } finally {
    if (priorWebhook === undefined) delete process.env.TEST_MONITOR_WEBHOOK; else process.env.TEST_MONITOR_WEBHOOK = priorWebhook;
  }
});

test("dry-run challenges remain explicit failures without reading or writing health state", async () => {
  const fail = async () => { throw new Error("unexpected external I/O"); };
  await assert.rejects(runMonitor([blockedPaper], true, { getPrevState: fail, upsertState: fail, notifyDiscord: fail, runRegistrationReminders: fail }), /paper \(scrape\)/);
});

test("a tolerated challenge remains visibly degraded in the GitHub source summary", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tcf-health-summary-"));
  process.env.GITHUB_STEP_SUMMARY = join(directory, "summary.md");
  try {
    await policyHarness().run([blockedPaper, computer], 15);
    const summary = await readFile(process.env.GITHUB_STEP_SUMMARY, "utf8");
    assert.match(summary, /toronto\/paper \| DEGRADED — within one-hour grace period; state preserved/);
    assert.match(summary, /toronto\/computer \| OK/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
