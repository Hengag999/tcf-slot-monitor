import { test } from "node:test";
import assert from "node:assert/strict";
import { processCity, runMonitor, type CityConfig, type MonitorDependencies } from "../scripts/scrape-slots";

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
  assert.deepEqual(writes, [{ type: "P-TCF Canada", count: 0, notified: false }]);
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
  assert.deepEqual(writes, [{ type: "P-TCF Canada", count: 0, notified: false }]);
  delete process.env.TEST_MONITOR_WEBHOOK;
});
test("dry-run avoids database and Discord I/O", async () => {
  const fail = async () => { throw new Error("unexpected external I/O"); };
  await runMonitor([computer], true, { getPrevState: fail, upsertState: fail, notifyDiscord: fail, runRegistrationReminders: fail });
});
