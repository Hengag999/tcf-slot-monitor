import { test } from "node:test";
import assert from "node:assert/strict";
import { computeReminders, formatPings, runRegistrationReminders, type RegistrationExam } from "../src/lib/registrationReminders";

const now = Date.parse("2026-10-06T12:00:00Z");
const day = 86_400_000;
function exam(overrides: Partial<RegistrationExam> = {}): RegistrationExam {
  return { id: "one", examKey: "one", examType: "TCF Canada", date: "November 2", label: "November 2 morning", schedule: "November 2 2026 9:30am", registrationWindow: "Oct 10 2026", registrationOpensAt: (now + 4 * day) / 1000, statusClass: "es-status-opens-soon", spotsLeft: 10, bookingUrl: "https://example.com/exams", ...overrides };
}

test("closed/full historical rows baseline without first-sighting spam", () => {
  for (const statusClass of ["es-status-closed", "es-status-full", "es-status-unknown"]) {
    const result = computeReminders([exam({ statusClass, registrationOpensAt: null })], [], now);
    assert.equal(result.pings.length, 0);
    assert.equal(result.tracking.length, 1);
  }
});
test("first future sighting then closest missed threshold, without duplicate catch-up", () => {
  const ex = exam();
  const first = computeReminders([ex], [], now);
  assert.equal(first.pings[0].kind, "new");
  const late = computeReminders([ex], first.tracking, now + 2.5 * day);
  assert.equal(late.pings[0].kind, "2d");
  assert.deepEqual(late.tracking[0].firedReminders.sort(), ["2d", "3d", "new"]);
  assert.equal(computeReminders([ex], late.tracking, now + 2.6 * day).pings.length, 0);
});
test("no countdown reminder after registration opens, including first sighting", () => {
  const ex = exam({ registrationOpensAt: (now - day) / 1000 });
  assert.equal(computeReminders([ex], [], now).pings.length, 0);
  assert.equal(computeReminders([ex], [{ examKey: "one", label: ex.label, registrationOpensAt: ex.registrationOpensAt, firedReminders: ["new"] }], now).pings.length, 0);
});
test("legacy duplicate keys union prior reminders during location-aware migration", () => {
  const ex = exam({ examKey: "new-key", legacyExamKey: "old-key", registrationOpensAt: (now + 2.5 * day) / 1000 });
  const previous = [
    { examKey: "old-key", label: ex.label, registrationOpensAt: ex.registrationOpensAt, firedReminders: ["new"] },
    { examKey: "old-key", label: ex.label, registrationOpensAt: ex.registrationOpensAt, firedReminders: ["new", "3d"] },
  ];
  const result = computeReminders([ex], previous, now);
  assert.equal(result.pings.length, 0);
  assert.equal(result.tracking[0].examKey, "new-key");
});
test("closed baseline can later announce a newly advertised future window", () => {
  const baseline = computeReminders([exam({ statusClass: "es-status-closed", registrationOpensAt: null })], [], now);
  assert.equal(computeReminders([exam()], baseline.tracking, now).pings[0].kind, "new");
});
test("rescheduled future registration resets countdown thresholds", () => {
  const ex = exam({ registrationOpensAt: (now + 2.5 * day) / 1000 });
  const result = computeReminders([ex], [{ examKey: ex.examKey, label: ex.label, registrationOpensAt: (now - day) / 1000, firedReminders: ["new", "3d", "2d", "1d"] }], now);
  assert.equal(result.pings[0].kind, "3d");
});
test("Edmonton formatting uses Mountain time explicitly", () => {
  const ex = exam({ registrationOpensAt: Date.parse("2026-10-10T18:00:00Z") / 1000 });
  const { pings } = computeReminders([ex], [], now);
  const text = formatPings("埃德蒙顿", pings, now, { timeZone: "America/Edmonton", timeZoneLabel: "埃德蒙顿时间" });
  assert.match(text, /12:00（埃德蒙顿时间）/);
  assert.doesNotMatch(text, /温哥华/);
});
test("missing webhook and rejected send never consume reminder state", async () => {
  for (const webhook of [undefined, "https://example.com/webhook"]) {
    let writes = 0;
    await assert.rejects(runRegistrationReminders("test", "测试", [exam()], webhook, false, now, {
      dependencies: { getPrevState: async () => [], upsertState: async () => { writes++; }, postDiscord: async () => { throw new Error("unavailable"); } },
    }));
    assert.equal(writes, 0);
  }
});
test("reminder state uses separate exam type and dry-run never touches external I/O", async () => {
  let writtenType = "";
  await runRegistrationReminders("edmonton", "埃德蒙顿", [exam({ statusClass: "es-status-closed", registrationOpensAt: null })], undefined, false, now, {
    examType: "TCF Canada registration reminders",
    dependencies: { getPrevState: async () => [], upsertState: async (_city, type, _slots, notified) => { writtenType = type; assert.equal(notified, false); }, postDiscord: async () => assert.fail("no send") },
  });
  assert.equal(writtenType, "TCF Canada registration reminders");
  const fail = async () => { throw new Error("unexpected external I/O"); };
  await runRegistrationReminders("test", "测试", [exam()], undefined, true, now, { dependencies: { getPrevState: fail, upsertState: fail, postDiscord: fail } });
});

test("future-only Edmonton reminders avoid duplicating current availability alerts", () => {
  const ex = exam({ statusClass: "es-status-available", registrationOpensAt: null, bookingAvailable: true });
  assert.equal(computeReminders([ex], [], now, { futureOnly: true }).pings.length, 0);
  assert.equal(computeReminders([ex], [], now).pings.length, 1);
});
test("same-date different locations remain distinguishable in notification copy", () => {
  const { pings } = computeReminders([exam({ examKey: "a", location: "Vancouver" }), exam({ examKey: "b", location: "New Westminster" })], [], now);
  const message = formatPings("温哥华", pings, now);
  assert.match(message, /📍 Vancouver/);
  assert.match(message, /📍 New Westminster/);
});
