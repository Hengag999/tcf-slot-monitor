import assert from "node:assert/strict";
import test from "node:test";
import { challengeDecision, readPaperHealth, recordPaperChallenge, recordPaperSuccess,
  HEALTH_CITY, HEALTH_EXAM_TYPE, type PaperHealth } from "../src/lib/torontoPaperHealth";
import type { StateRow } from "../src/lib/db";

const start = Date.parse("2026-10-07T00:00:00Z");
const minute = 60_000;
const iso = (n: number) => new Date(n).toISOString();
const healthy: PaperHealth = { version: 1, lastSuccessAt: iso(start), firstChallengeAt: null, failureReportedAt: null };

test("known challenges are tolerated until exactly one hour after a successful check", () => {
  assert.equal(challengeDecision(healthy, undefined, start + 59 * minute).action, "grace");
  const due = challengeDecision(healthy, undefined, start + 60 * minute);
  assert.equal(due.action, "alert");
  assert.equal(due.state.failureReportedAt, iso(start + 60 * minute));
  assert.equal(challengeDecision(due.state, undefined, start + 180 * minute).action, "already-reported");
});

test("existing availability freshness bootstraps the policy without rewriting availability", () => {
  assert.equal(challengeDecision(undefined, iso(start), start + 59 * minute).action, "grace");
  assert.equal(challengeDecision(undefined, new Date(start), start + 60 * minute).action, "alert");
});

test("a source with no baseline gets one hour from its first observed challenge", () => {
  const initial = challengeDecision(undefined, undefined, start);
  assert.equal(initial.action, "grace");
  assert.equal(initial.state.lastSuccessAt, null);
  assert.equal(challengeDecision(initial.state, undefined, start + 60 * minute).action, "alert");
});

test("newer availability evidence recovers an incident even if the prior health write failed", () => {
  const alert = challengeDecision(healthy, undefined, start + 60 * minute);
  const next = challengeDecision(alert.state, iso(start + 70 * minute), start + 75 * minute);
  assert.equal(next.action, "grace");
  assert.equal(next.state.failureReportedAt, null);
  assert.equal(next.minutesWithoutSuccess, 5);
  assert.equal(challengeDecision(next.state, undefined, start + 130 * minute).action, "alert");
});

test("malformed health state and implausible future timestamps fail rather than suppress alerts", () => {
  for (const state of [[], [{}], [{ ...healthy, version: 2 }], [{ ...healthy, lastSuccessAt: "invalid" }],
    [{ ...healthy, firstChallengeAt: undefined }], [{ ...healthy, failureReportedAt: iso(start) }]]) {
    assert.throws(() => readPaperHealth(state, start));
  }
  assert.throws(() => challengeDecision(healthy, iso(start + 10 * minute), start));
});

function store() {
  const rows: StateRow[] = [{ city: "toronto", exam_type: "P-TCF Canada", slots: [{ id: "preserved" }], checked_at: iso(start) }];
  const io = {
    getPrevState: async (city: string) => structuredClone(rows.filter(row => row.city === city)),
    upsertState: async (city: string, exam_type: string, slots: any[], notified: boolean) => {
      assert.equal(city, HEALTH_CITY);
      assert.equal(exam_type, HEALTH_EXAM_TYPE);
      assert.equal(notified, false);
      const row = rows.find(row => row.city === city && row.exam_type === exam_type);
      if (row) row.slots = structuredClone(slots);
      else rows.push({ city, exam_type, slots: structuredClone(slots) });
    },
  };
  return { rows, io };
}

test("the incident persists across runs, alerts once, and rearms after successful recovery", async () => {
  const { io, rows } = store();
  const original = structuredClone(rows[0]);
  assert.equal((await recordPaperChallenge(io, start + 55 * minute)).action, "grace");
  assert.equal((await recordPaperChallenge(io, start + 60 * minute)).action, "alert");
  assert.equal((await recordPaperChallenge(io, start + 65 * minute)).action, "already-reported");
  await recordPaperSuccess(io, start + 70 * minute);
  assert.equal((await recordPaperChallenge(io, start + 75 * minute)).action, "grace");
  assert.equal((await recordPaperChallenge(io, start + 130 * minute)).action, "alert");
  assert.deepEqual(rows[0], original);
});

test("a failed health write does not consume the one-time workflow failure", async () => {
  const { io, rows } = store();
  const unavailable = { ...io, upsertState: async () => { throw new Error("database unavailable"); } };
  await assert.rejects(recordPaperChallenge(unavailable, start + 60 * minute), /database unavailable/);
  assert.equal(rows.length, 1);
  assert.equal((await recordPaperChallenge(io, start + 65 * minute)).action, "alert");
});
