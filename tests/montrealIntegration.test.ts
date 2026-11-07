import { test } from "node:test";
import assert from "node:assert/strict";
import { createSources, processCity, type MonitorDependencies } from "../scripts/scrape-slots";
import { formatSlotNotification } from "../src/lib/discord";
import type { StateRow } from "../src/lib/db";

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
