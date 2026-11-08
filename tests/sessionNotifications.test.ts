import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createSources, processCity, runMonitor, type MonitorSlot, type MonitorDependencies } from "../scripts/scrape-slots";
import type { StateRow } from "../src/lib/db";

const savedEnv = new Map<string, string | undefined>();
beforeEach(() => {
  for (const name of ["GITHUB_STEP_SUMMARY", "DISCORD_WEBHOOK_HALIFAX", "DISCORD_WEBHOOK_OTTAWA"]) {
    savedEnv.set(name, process.env[name]);
    if (name === "GITHUB_STEP_SUMMARY") delete process.env[name];
    else process.env[name] = "https://example.com/mock-session-webhook";
  }
});
afterEach(() => {
  for (const [name, value] of savedEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function slot(id: string, examType: string, startTime = "09:00"): MonitorSlot {
  return { id, examType, date: "2027-01-12", startTime, endTime: "12:00", bookingUrl: `https://example.com/#/addExamination/${id}` };
}

function harness(city: string, baseline: MonitorSlot[]) {
  const state = new Map<string, StateRow>();
  for (const current of baseline) {
    const key = `${city}/${current.examType}`;
    if (!state.has(key)) state.set(key, { city, exam_type: current.examType, slots: [] });
    state.get(key)!.slots.push(structuredClone(current));
  }
  const sent: { type: string; ids: string[] }[] = [];
  const writes: { city: string; type: string; ids: string[]; notified: boolean }[] = [];
  let deliveryFails = false;
  const io: MonitorDependencies = {
    getPrevState: async key => structuredClone([...state.values()].filter(row => row.city === key)),
    upsertState: async (key, type, slots, notified) => {
      state.set(`${key}/${type}`, { city: key, exam_type: type, slots: structuredClone(slots) });
      writes.push({ city: key, type, ids: slots.map(item => item.id), notified });
    },
    notifyDiscord: async (_url, _label, type, slots) => {
      if (deliveryFails) throw new Error("mock delivery unavailable");
      sent.push({ type, ids: (slots as MonitorSlot[]).map(item => item.id) });
    },
    runRegistrationReminders: async () => assert.fail("session alerts are not registration reminders"),
  };
  return { io, sent, writes, state, failDelivery: (value: boolean) => { deliveryFails = value; } };
}

test("only Halifax and Ottawa opt into session-ID alerts; other notification policies stay unchanged", () => {
  const sources = createSources();
  assert.deepEqual(sources.filter(source => source.diffBySessionId).map(source => source.key), ["halifax", "ottawa"]);
  assert.ok(sources.filter(source => source.diffBySessionId).every(source => !source.diffByDate && !source.reminderMode));
  assert.equal(sources.find(source => source.key === "ashton")!.diffByDate, true);
  assert.ok(sources.filter(source => source.key === "toronto" || source.key === "calgary").every(source => !source.diffByDate && !source.diffBySessionId));
});

for (const city of ["halifax", "ottawa"]) {
  const source = createSources().find(item => item.key === city)!;
  const type = source.examTypes![0];

  test(`${city} reuses existing stored IDs without a rollout replay, reorder ping, or seat-increase ping`, async () => {
    const old = { ...slot("100", type), availableSeats: 2 };
    const later = slot("101", type, "12:30");
    const { io, sent, writes } = harness(city, [old, later]);
    await processCity(source, [old, later], false, io);
    await processCity(source, [later, old], false, io);
    await processCity(source, [{ ...old, availableSeats: 3 }, later], false, io);
    assert.deepEqual(sent, []);
    assert.ok(writes.every(write => !write.notified));
  });

  test(`${city} announces new same-date sittings and individual reopenings while another session stays open`, async () => {
    const old = slot("100", type);
    const added = slot("101", type, "12:30");
    const { io, sent } = harness(city, [old]);
    await processCity(source, [old, added], false, io);
    await processCity(source, [added, old], false, io);
    assert.deepEqual(sent, [{ type, ids: ["101"] }]);
    // A validated snapshot no longer includes the full session, but its peer
    // remains open. The returning ID must notify despite the nonempty format.
    await processCity(source, [added], false, io);
    await processCity(source, [old, added], false, io);
    await processCity(source, [old, added], false, io);
    assert.deepEqual(sent, [{ type, ids: ["101"] }, { type, ids: ["100"] }]);
  });

  test(`${city} a failed scrape cannot rearm unchanged availability, but a successful empty snapshot can`, async () => {
    const old = slot("100", type);
    const { io, sent, writes, state } = harness(city, [old]);
    const failedSource = { ...source, scrape: async (): Promise<MonitorSlot[]> => { throw new Error("mock invalid source response"); } };
    await assert.rejects(runMonitor([failedSource], false, io), /\(scrape\)/);
    assert.deepEqual(writes, []);
    assert.deepEqual(state.get(`${city}/${type}`)!.slots, [old]);
    await processCity(source, [old], false, io);
    assert.deepEqual(sent, []);
    await processCity(source, [], false, io);
    assert.deepEqual(state.get(`${city}/${type}`)!.slots, []);
    await processCity(source, [old], false, io);
    assert.deepEqual(sent, [{ type, ids: ["100"] }]);
  });

  test(`${city} missing webhook or failed delivery cannot consume a new session; accepted retry deduplicates`, async () => {
    const old = slot("100", type);
    const added = slot("101", type, "12:30");
    const { io, sent, writes, state, failDelivery } = harness(city, [old]);
    delete process.env[source.webhookEnv];
    await assert.rejects(processCity(source, [old, added], false, io), /missing/);
    assert.deepEqual(writes, []);
    process.env[source.webhookEnv] = "https://example.com/mock-session-webhook";
    failDelivery(true);
    await assert.rejects(processCity(source, [old, added], false, io), /mock delivery unavailable/);
    assert.deepEqual(state.get(`${city}/${type}`)!.slots, [old]);
    assert.deepEqual(writes, []);
    failDelivery(false);
    await processCity(source, [old, added], false, io);
    await processCity(source, [added, old], false, io);
    assert.deepEqual(sent, [{ type, ids: ["101"] }]);
    assert.equal(writes.filter(write => write.notified).length, 1);
  });
}

test("Ottawa computer and paper compare sessions independently, including a first opening of either format", async () => {
  const source = createSources().find(item => item.key === "ottawa")!;
  const [computer, paper] = source.examTypes!;
  const computerSlot = slot("100", computer);
  const paperSlot = slot("100", paper);
  const { io, sent, state } = harness(source.key, [computerSlot]);
  await processCity(source, [computerSlot, paperSlot], false, io);
  assert.deepEqual(sent, [{ type: paper, ids: ["100"] }]);
  await processCity(source, [paperSlot], false, io);
  assert.deepEqual(state.get(`ottawa/${computer}`)!.slots, []);
  assert.deepEqual(state.get(`ottawa/${paper}`)!.slots, [paperSlot]);
  await processCity(source, [computerSlot, paperSlot], false, io);
  await processCity(source, [paperSlot, computerSlot], false, io);
  assert.deepEqual(sent, [{ type: paper, ids: ["100"] }, { type: computer, ids: ["100"] }]);
});

test("Ottawa retries a failed paper delivery without repeating an already persisted computer alert", async () => {
  const source = createSources().find(item => item.key === "ottawa")!;
  const [computer, paper] = source.examTypes!;
  const oldComputer = slot("100", computer);
  const newComputer = slot("101", computer, "12:30");
  const oldPaper = slot("200", paper);
  const newPaper = slot("201", paper, "12:30");
  const current = [oldComputer, newComputer, oldPaper, newPaper];
  const { io, sent, state } = harness(source.key, [oldComputer, oldPaper]);
  const deliver = io.notifyDiscord;
  io.notifyDiscord = async (...args) => {
    if (args[2] === paper) throw new Error("mock paper delivery failure");
    await deliver(...args);
  };
  await assert.rejects(processCity(source, current, false, io), /mock paper delivery failure/);
  assert.deepEqual(sent, [{ type: computer, ids: ["101"] }]);
  assert.deepEqual(state.get(`ottawa/${computer}`)!.slots, [oldComputer, newComputer]);
  assert.deepEqual(state.get(`ottawa/${paper}`)!.slots, [oldPaper]);
  io.notifyDiscord = deliver;
  await processCity(source, current, false, io);
  await processCity(source, current, false, io);
  assert.deepEqual(sent, [{ type: computer, ids: ["101"] }, { type: paper, ids: ["201"] }]);
});
