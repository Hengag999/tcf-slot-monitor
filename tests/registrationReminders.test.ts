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

test("37 BC recovery sittings retain every date and seat count in one Discord message", () => {
  // Public snapshot observed 2026-10-06: one opening, one URL, two locations.
  const opening = Date.parse("2026-11-02T23:00:00Z") / 1000;
  const bookingUrl = "https://www.alliancefrancaise.ca/en/language/exams/tcf-canada/";
  const northwest = "Alliance Francaise - 320 Columbia St., New Westminster";
  const vancouver = "Alliance Francaise - 6161 Cambie St., Vancouver";
  const rows: [string, string, number][] = [
    ...[["01", 16], ["03", 16], ["05", 14], ["08", 16], ["10", 16], ["12", 14],
      ["17", 16], ["19", 14], ["22", 16], ["23", 16], ["24", 16], ["25", 16], ["26", 14]]
      .map(([date, seats]): [string, string, number] => [northwest, `February ${date}, 2027`, Number(seats)]),
    ...[["06", 16], ["08", 14], ["09", 16], ["11", 16], ["13", 16], ["15", 14],
      ["18", 16], ["20", 16], ["22", 14], ["25", 16], ["27", 8], ["29", 14]]
      .map(([date, seats]): [string, string, number] => [northwest, `January ${date}, 2027`, Number(seats)]),
    ...[["11", 40], ["13", 40], ["15", 28], ["18", 40], ["20", 40], ["22", 40],
      ["25", 40], ["27", 28], ["29", 40], ["4", 40], ["6", 40], ["8", 40]]
      .map(([date, seats]): [string, string, number] => [vancouver, `January ${date}, 2027`, Number(seats)]),
  ];
  const exams = rows.map(([location, label, spotsLeft], index) => exam({
    examKey: `sitting-${index}`, location, label: `TCF-Canada ${label}`,
    spotsLeft, registrationOpensAt: opening, bookingUrl,
  }));
  const message = formatPings("温哥华", computeReminders(exams, [], now).pings, now);
  assert.equal(rows.length, 37);
  assert.ok(message.length <= 2000, `Discord content is ${message.length} characters`);
  assert.equal(message.match(/@everyone/g)?.length, 1);
  assert.equal(message.match(/报名将于/g)?.length, 1);
  assert.equal(message.split(bookingUrl).length - 1, 1);
  assert.equal(message.match(/^• /gm)?.length, 37);
  assert.ok(message.includes(`${northwest}（25 场）`));
  assert.ok(message.includes(`${vancouver}（12 场）`));
  for (const [location, label, seats] of rows) {
    const block = message.split(`📍 ${location}`)[1].split(/📍 |👉 /)[0];
    assert.ok(block.includes(`• ${label} · 剩 ${seats} 个名额`));
  }
});

test("compact copy keeps reminder kinds, openings, destinations and unknown-time windows separate", () => {
  const base = computeReminders([exam()], [], now).pings[0];
  const pings = [
    { ...base, examKey: "a", label: "TCF-Canada November 2 morning", location: "Vancouver" },
    { ...base, examKey: "b", label: "TCF Canada November 2 morning*", location: "New Westminster", spotsLeft: null },
    { ...base, examKey: "c", label: "November 2 afternoon", kind: "1d" as const },
    { ...base, examKey: "d", label: "November 3", registrationOpensAt: base.registrationOpensAt! + day / 1000 },
    { ...base, examKey: "e", label: "November 4", bookingUrl: "https://example.com/other" },
    { ...base, examKey: "f", label: "November 5", registrationOpensAt: null, registrationWindow: "Window A", spotsLeft: 0 },
    { ...base, examKey: "g", label: "November 6", registrationOpensAt: null, registrationWindow: "Window B" },
  ];
  const message = formatPings("测试", pings, now);
  assert.equal(message.match(/👉 /g)?.length, 6);
  assert.equal(message.match(/^• /gm)?.length, 7);
  assert.equal(message.match(/🆕 /g)?.length, 5);
  assert.match(message, /新场次上线：2 场/);
  assert.match(message, /距报名开放约 1 天：1 场/);
  assert.ok(message.includes("• November 2 morning*\n"));
  assert.ok(message.includes("• November 5 · 剩 0 个名额"));
  assert.match(message, /报名窗口：\*\*Window A\*\*/);
  assert.match(message, /报名窗口：\*\*Window B\*\*/);
  assert.doesNotMatch(message, /TCF-Canada November/);
  assert.equal(message.match(/@everyone/g)?.length, 1);
});
