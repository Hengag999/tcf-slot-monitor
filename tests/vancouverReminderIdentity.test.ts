import assert from "node:assert/strict";
import { test } from "node:test";
import { parseExamSelectorPage } from "../src/lib/examSelector";
import { computeReminders, runRegistrationReminders } from "../src/lib/registrationReminders";
import { createSources } from "../scripts/scrape-slots";

const now = Date.parse("2026-11-13T22:31:00Z");
const options = { matchVancouverBookingIdentity: true };
const location = "Alliance Francaise - 6161 Cambie St., Vancouver";
interface Sitting {
  label: string;
  id: string;
  schedule: string;
  seats: number;
  location?: string;
  status?: "closed" | "full" | "opens-soon";
  link?: string;
  attrId?: string;
}
function row(sitting: Sitting): string {
  const { label, id, schedule, seats, status, link, attrId } = sitting;
  const booking = status
    ? `<span class="es-status es-status-${status}"${status === "opens-soon" ? ` data-opens-at="${now / 1000 + 3600}"` : ""}>Not yet available</span>`
    : `<a class="es-status es-status-available" exam_id="${attrId ?? id}" href="${link ?? `/af/exam-selector/order/?exam_id=${id}`}">Book Now</a>`;
  return `<tr class="tableRow"><td>${label}</td>
    <td><div class="es-schedule-group"><span>Written &amp; Oral</span><div>${schedule}</div></div></td>
    <td>Nov 13 2026 3:15pm - Nov 16 2026 4:00pm</td><td>${sitting.location ?? location}</td>
    <td>${seats}</td><td>$390.00</td><td>${booking}</td></tr>`;
}
function parse(sittings: Sitting[], capture = true) {
  return parseExamSelectorPage(`<table class="es-exams-table">${sittings.map(row).join("")}</table>`,
    undefined, undefined, capture).exams;
}

// Confirmed by the Nov 14 Discord messages: the French and English captions
// share each booking ID; Nov 27 is a genuinely different booking.
const old23 = { label: "TCF-Canada-Lundi, 23 novembre 2026", id: "324", schedule: "Monday 23 Nov 2026 - 9am▸4pm", seats: 14 };
const old24 = { label: "TCF-Canada-Mardi, 24 novembre 2026", id: "325", schedule: "Tuesday 24 Nov 2026 - 9am▸4pm", seats: 4 };
const new23 = { ...old23, label: "TCF-Canada- November 23, 2026", seats: 11 };
const new24 = { ...old24, label: "TCF-Canada-November 24 2026", seats: 3 };
const new27 = { label: "TCF-Canada November 27 , 2026", id: "327", schedule: "Friday 27 Nov 2026 - 9am▸4pm", seats: 7 };
const upcoming25: Sitting = { label: "TCF-Canada November 25 , 2026", id: "326", schedule: "Wednesday 25 Nov 2026 - 9am▸4pm", seats: 8, status: "opens-soon" };

test("confirmed Vancouver sequence: announces new sittings, suppresses both language-only repeats", () => {
  const a = computeReminders(parse([old23]), [], now, options);
  assert.deepEqual(a.pings.map(p => p.label), [old23.label]);
  const b = computeReminders(parse([old23, old24, upcoming25]), a.tracking, now, options);
  assert.deepEqual(b.pings.map(p => p.label), [old24.label, upcoming25.label]);
  const open25 = { ...upcoming25, status: undefined, seats: 5 };
  const current = parse([new23, new24, new27, open25]);
  assert.notEqual(current[0].examKey, b.tracking[0].examKey, "existing key remains label-sensitive");
  assert.equal(current[0].vancouverBooking!.fingerprint, b.tracking[0].vancouverBooking!.fingerprint);
  const c = computeReminders(current, b.tracking, now, options);
  assert.deepEqual(c.pings.map(p => p.label), [new27.label]);
  assert.deepEqual(c.tracking.map(e => e.firedReminders.includes("new")), [true, true, true, true]);
  assert.deepEqual(computeReminders(current, c.tracking, now, options).pings, []);
});

test("pre-deployment persisted JSON learns a booking ID without re-alerting or changing its key", () => {
  const old = computeReminders(parse([old23], false), [], now);
  const previous = JSON.parse(JSON.stringify(old.tracking));
  assert.equal(previous[0].vancouverBooking, undefined);
  const present = parse([old23]);
  assert.equal(present[0].examKey, previous[0].examKey);
  const seeded = computeReminders(present, previous, now, options);
  assert.deepEqual(seeded.pings, []);
  const { vancouverBooking, ...originalFields } = seeded.tracking[0];
  assert.deepEqual(originalFields, previous[0]);
  assert.equal(vancouverBooking!.providerId, "324");
  assert.deepEqual(computeReminders(parse([new23]), seeded.tracking, now, options).pings, []);
  assert.equal(computeReminders(parse([new23]), previous, now, options).pings.length, 1,
    "a rename before the first exact-key observation does not infer historical identity");
});

test("same date alone, a changed location/schedule, or an inconsistent title cannot merge separate sittings", () => {
  const before = computeReminders(parse([old23]), [], now, options).tracking;
  for (const distinct of [
    { ...new23, id: "400" },
    { ...new23, location: "Alliance Francaise - 320 Columbia St., New Westminster" },
    { ...new23, schedule: "Monday 23 Nov 2026 - 8am▸4pm" },
    { ...new23, label: "TCF-Canada November 24, 2026" },
    { ...new23, label: "TCF-Canada-Mardi, 23 novembre 2026" }, // Wrong weekday.
    { ...new23, label: "TCF-Canada November 23, 2026*" },
    { ...new23, attrId: "400" },
    { ...new23, link: "/another/path/?exam_id=324" },
    { ...new23, link: "/af/exam-selector/order/?exam_id=324&amp;exam_id=324" },
  ]) {
    const results = computeReminders(parse([distinct]), before, now, options);
    assert.equal(results.pings.length, 1, JSON.stringify(distinct));
  }
  const sameDate = { ...new23, location: "Alliance Francaise - 320 Columbia St., New Westminster", id: "400" };
  const result = computeReminders(parse([new23, sameDate]), before, now, options);
  assert.deepEqual(result.pings.map(p => p.location), [sameDate.location]);
});

test("nonunique current IDs, nonunique prior IDs, and claimed exact keys use existing matching", () => {
  const old = computeReminders(parse([old23]), [], now, options).tracking;
  const invalidTitle = { ...new23, label: "TCF-Canada November 23, 2026*" };
  const conflict = computeReminders(parse([new23, invalidTitle]), old, now, options);
  assert.deepEqual(conflict.pings.map(p => p.label), [new23.label, invalidTitle.label]);
  assert.ok(conflict.tracking.every(e => !e.vancouverBooking));
  const duplicate = computeReminders(parse([new23]), [...old, { ...old[0], examKey: "duplicate" }], now, options);
  assert.equal(duplicate.pings.length, 1);
  const stillClaimed = computeReminders(parse([{ ...old23, status: "closed" }, new23]), old, now, options);
  assert.equal(stillClaimed.pings.length, 1);
  assert.deepEqual(stillClaimed.tracking[0].firedReminders, ["new"]);
});

test("full/closed/absent transitions preserve exact-key policy with no booking alias carryover", () => {
  const before = computeReminders(parse([old23]), [], now, options);
  for (const status of ["full", "closed"] as const) {
    const mid = computeReminders(parse([{ ...old23, status }]), before.tracking, now, options);
    assert.deepEqual(mid.pings, []);
    assert.equal(mid.tracking[0].vancouverBooking, undefined);
    assert.deepEqual(mid.tracking[0].firedReminders, ["new"]);
    assert.deepEqual(computeReminders(parse([old23]), mid.tracking, now, options).pings, []);
    assert.equal(computeReminders(parse([new23]), mid.tracking, now, options).pings.length, 1);
  }
  const vanished = computeReminders([], before.tracking, now, options);
  assert.equal(computeReminders(parse([new23]), vanished.tracking, now, options).pings.length, 1);
});

test("matching is opt-in only for the production Vancouver reminder path", () => {
  const sources = createSources();
  assert.deepEqual(sources.filter(source => source.reminderOptions?.matchVancouverBookingIdentity)
    .map(source => [source.key, source.reminderMode]), [["vancouver", true]]);
  assert.equal(parse([old23], false)[0].vancouverBooking, undefined);
  const prior = computeReminders(parse([old23]), [], now, options).tracking;
  assert.equal(computeReminders(parse([new23]), prior, now).pings.length, 1);
});

test("mocked Vancouver delivery sends only genuinely new sitting and does not persist a failed send", async () => {
  const prior = computeReminders(parse([old23, old24]), [], now, options).tracking;
  const current = parse([new23, new24, new27]);
  let writes = 0;
  let failed = true;
  const delivered: string[] = [];
  const dependencies = {
    getPrevState: async () => [{ city: "vancouver", exam_type: "TCF Canada", slots: prior }],
    upsertState: async () => { writes++; },
    postDiscord: async (_url: string, message: string) => {
      if (failed) throw new Error("mock offline failure");
      delivered.push(message);
    },
  };
  const run = () => runRegistrationReminders("vancouver", "温哥华", current, "https://example.test/mock",
    false, now, { ...options, dependencies });
  await assert.rejects(run, /mock offline failure/);
  assert.equal(writes, 0);
  failed = false;
  await run();
  assert.equal(writes, 1);
  assert.equal(delivered.length, 1);
  assert.match(delivered[0], /exam_id=327/);
  assert.doesNotMatch(delivered[0], /exam_id=32[45]/);
});
