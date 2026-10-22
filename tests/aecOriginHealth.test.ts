import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp, readFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createSources, runMonitor, type CityConfig, type MonitorDependencies} from "../scripts/scrape-slots";
import {AecKeyPage522Error} from "../src/lib/aecExaminations";
import {aecHealthKey, recordAec522} from "../src/lib/aecOriginHealth";
import {HEALTH_CITY} from "../src/lib/torontoPaperHealth";
import type {StateRow} from "../src/lib/db";

const start = Date.parse("2026-10-22T00:00:00Z");
const minute = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
const inheritedSummary = process.env.GITHUB_STEP_SUMMARY;
delete process.env.GITHUB_STEP_SUMMARY;

function harness(city = "halifax") {
  const source = {...createSources().find(source => source.key === city)!, scrape: async () => []};
  const blocked = {...source, scrape: async () => { throw new AecKeyPage522Error(source.aecKeyPageGrace!.origin, source.label); }};
  const rows: StateRow[] = source.examTypes!.map(exam_type => ({city, exam_type, slots: [{id: "keep", date: "2026-12-01"}], checked_at: iso(start)}));
  let clock = start;
  const io: MonitorDependencies = {
    getPrevState: async key => structuredClone(rows.filter(row => row.city === key)),
    upsertState: async (key, exam_type, slots, notified) => {
      assert.equal(notified, false);
      let row = rows.find(row => row.city === key && row.exam_type === exam_type);
      if (!row) { row = {city: key, exam_type, slots: []}; rows.push(row); }
      row.slots = structuredClone(slots); row.checked_at = iso(clock);
    },
    notifyDiscord: async () => assert.fail("unexpected notification"),
    runRegistrationReminders: async () => assert.fail("not a reminder"),
  };
  const run = async (sources: CityConfig[], minutes: number) => {
    clock = start + minutes * minute;
    return runMonitor(sources, false, io, () => clock);
  };
  const health = () => rows.find(row => row.city === HEALTH_CITY && row.exam_type === aecHealthKey(city));
  return {source, blocked, rows, io, run, health};
}

test("AEC 522 grace is configured only for Halifax and Ottawa with complete exam scopes", () => {
  const sources = createSources().filter(source => source.aecKeyPageGrace);
  assert.deepEqual(sources.map(source => [source.key, source.aecKeyPageGrace!.origin, source.examTypes]), [
    ["halifax", "https://afhalifax.aec.app", ["TCF Canada"]],
    ["ottawa", "https://afottawa.aec.app", ["TCF Canada sur ordinateur", "TCF Canada (papier)"]],
  ]);
});

test("AEC 522 preserves availability, fails once at an hour, suppresses repeats and rearms on persisted recovery", async () => {
  for (const city of ["halifax", "ottawa"]) {
    const h = harness(city); const prior = structuredClone(h.rows);
    await h.run([h.blocked], 59);
    assert.deepEqual(h.rows.filter(row => row.city === city), prior);
    await assert.rejects(h.run([h.blocked], 60), /one-hour AEC key-page HTTP 522 outage/);
    await h.run([h.blocked], 65);
    assert.deepEqual(h.rows.filter(row => row.city === city), prior);
    assert.equal(h.health()!.slots[0].failureReportedAt, iso(start + 60 * minute));
    await h.run([h.source], 70);
    assert.equal(h.health()!.slots[0].failureReportedAt, null);
    assert.equal(h.health()!.slots[0].firstChallengeAt, null);
    await h.run([h.blocked], 75);
    await assert.rejects(h.run([h.blocked], 130), /one-hour AEC key-page HTTP 522 outage/);
  }
});

test("partial Ottawa persistence cannot rearm an incident; both newer formats can recover a failed health write", async () => {
  const h = harness("ottawa");
  await assert.rejects(h.run([h.blocked], 60));
  h.rows[0].checked_at = iso(start + 65 * minute);
  const partial = await recordAec522(h.io, "ottawa", h.source.examTypes!, start + 70 * minute);
  assert.equal(partial.action, "already-reported");
  h.rows[1].checked_at = iso(start + 66 * minute);
  const complete = await recordAec522(h.io, "ottawa", h.source.examTypes!, start + 75 * minute);
  assert.equal(complete.action, "grace");
  assert.equal(complete.minutesWithoutSuccess, 10);
  assert.equal(complete.state.failureReportedAt, null);
});

test("AEC grace never swallows unknown errors, wrong origins, other sources or dry-run failures", async () => {
  const h = harness();
  for (const error of [new Error("failed to fetch page (522)"), new TypeError("fetch failed"), new AecKeyPage522Error("https://other.example", "Halifax")]) {
    await assert.rejects(h.run([{...h.source, scrape: async () => { throw error; }}], 5), /halifax \(scrape\)/);
    assert.equal(h.health(), undefined);
  }
  await assert.rejects(h.run([{...h.blocked, key: "ashton", aecKeyPageGrace: undefined}], 5), /ashton \(scrape\)/);
  const fail = async () => { throw new Error("unexpected I/O"); };
  await assert.rejects(runMonitor([h.blocked], true, {getPrevState: fail, upsertState: fail, notifyDiscord: fail, runRegistrationReminders: fail}), /halifax \(scrape\)/);
});

test("AEC grace and reported outages cannot hide another centre's error", async () => {
  const h = harness();
  const other: CityConfig = {...h.source, key: "ashton", aecKeyPageGrace: undefined, scrape: async () => { throw new Error("unknown markup"); }};
  await assert.rejects(h.run([h.blocked, other], 5), /ashton \(scrape\)/);
  await assert.rejects(h.run([h.blocked], 60));
  await assert.rejects(h.run([h.blocked, other], 65), /ashton \(scrape\)/);
});

test("unreadable, unwritable and malformed AEC health remains immediate while later sources continue", async () => {
  for (const mode of ["read", "write", "malformed"]) {
    const h = harness();
    if (mode === "read") {
      const read = h.io.getPrevState;
      h.io.getPrevState = async city => { if (city === HEALTH_CITY) throw new Error("DB read failed"); return read(city); };
    } else if (mode === "write") {
      const write = h.io.upsertState;
      h.io.upsertState = async (...args) => { if (args[0] === HEALTH_CITY) throw new Error("DB write failed"); return write(...args); };
    } else h.rows.push({city: HEALTH_CITY, exam_type: aecHealthKey("halifax"), slots: [{}]});
    const other = {...h.source, key: "ashton", aecKeyPageGrace: undefined};
    await assert.rejects(h.run([h.blocked, other], 5), /health state/);
    assert.ok(h.rows.some(row => row.city === "ashton"));
    assert.deepEqual(h.rows[0].slots, [{id: "keep", date: "2026-12-01"}]);
    if (mode === "malformed") await assert.rejects(h.run([h.source], 10), /notify\/persist/);
  }
});

test("AEC notification or availability persistence failure does not reset a reported incident", async () => {
  for (const mode of ["notify", "persist"]) {
    const h = harness();
    await assert.rejects(h.run([h.blocked], 60));
    const before = structuredClone(h.health());
    if (mode === "persist") h.io.upsertState = async () => { throw new Error("DB unavailable"); };
    else {
      h.rows[0].slots = [];
      h.io.notifyDiscord = async () => { throw new Error("Discord unavailable"); };
    }
    const previous = process.env.DISCORD_WEBHOOK_HALIFAX;
    process.env.DISCORD_WEBHOOK_HALIFAX = "https://example.com/mock-webhook";
    try {
      const source = mode === "persist" ? h.source : {...h.source, scrape: async () => [{id: "new", date: "2026-12-02", examType: "TCF Canada", bookingUrl: "https://example.com"}]};
      await assert.rejects(h.run([source], 65), /notify\/persist/);
      assert.deepEqual(h.health(), before);
    } finally {
      if (previous === undefined) delete process.env.DISCORD_WEBHOOK_HALIFAX; else process.env.DISCORD_WEBHOOK_HALIFAX = previous;
    }
  }
});

test("AEC with no complete baseline gets an hour from first 522; malformed timestamps never suppress", async () => {
  const h = harness(); h.rows.splice(0);
  await h.run([h.blocked], 0);
  assert.equal(h.health()!.slots[0].lastSuccessAt, null);
  await assert.rejects(h.run([h.blocked], 60), /one-hour AEC key-page HTTP 522 outage/);
  for (const checked_at of [undefined, "invalid", iso(start + 10 * minute)]) {
    const bad = harness(); bad.rows[0].checked_at = checked_at;
    await assert.rejects(bad.run([bad.blocked], 0), /health state/);
    assert.equal(bad.health(), undefined);
  }
});

test("tolerated AEC 522 remains visibly degraded in the real summary format", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tcf-aec-summary-"));
  process.env.GITHUB_STEP_SUMMARY = join(dir, "summary.md");
  try {
    const h = harness(); await h.run([h.blocked], 5);
    assert.match(await readFile(process.env.GITHUB_STEP_SUMMARY, "utf8"), /halifax \| DEGRADED — within one-hour grace period; state preserved; AEC key-page HTTP 522/);
  } finally {
    if (inheritedSummary === undefined) delete process.env.GITHUB_STEP_SUMMARY; else process.env.GITHUB_STEP_SUMMARY = inheritedSummary;
    await rm(dir, {recursive: true, force: true});
  }
});
