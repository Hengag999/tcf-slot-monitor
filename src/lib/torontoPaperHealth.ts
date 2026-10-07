import type { getPrevState, upsertState } from "./db";

// A separate row in the monitor's existing table: never an availability snapshot.
export const HEALTH_CITY = "__monitor_health__";
export const HEALTH_EXAM_TYPE = "toronto/paper";
export const CHALLENGE_GRACE_MS = 60 * 60 * 1000;

export interface PaperHealth {
  version: 1;
  lastSuccessAt: string | null;
  firstChallengeAt: string | null;
  // Records issuing a workflow failure, not a receipt for a GitHub email.
  failureReportedAt: string | null;
}

export interface ChallengeDecision {
  action: "grace" | "alert" | "already-reported";
  state: PaperHealth;
  minutesWithoutSuccess: number;
}

type HealthIO = { getPrevState: typeof getPrevState; upsertState: typeof upsertState };

function timestamp(value: unknown, now: number): number {
  const ms = value instanceof Date ? value.getTime()
    : typeof value === "string" ? Date.parse(value) : NaN;
  // Permit small DB/runner clock skew, but never suppress indefinitely on bad state.
  if (!Number.isFinite(ms) || ms < 0 || ms > now + 60_000) {
    throw new Error("Invalid Toronto paper health timestamp");
  }
  return ms;
}

export function readPaperHealth(slots: unknown, now: number): PaperHealth {
  if (!Array.isArray(slots) || slots.length !== 1 || slots[0]?.version !== 1) {
    throw new Error("Invalid Toronto paper health state");
  }
  const state = slots[0] as PaperHealth;
  for (const value of [state.lastSuccessAt, state.firstChallengeAt, state.failureReportedAt]) {
    if (value !== null) timestamp(value, now);
  }
  if (state.failureReportedAt !== null && state.firstChallengeAt === null) {
    throw new Error("Invalid Toronto paper health incident");
  }
  return { ...state };
}

export function challengeDecision(
  previous: PaperHealth | undefined,
  availabilityCheckedAt: string | Date | undefined,
  now: number,
): ChallengeDecision {
  if (!Number.isFinite(now)) throw new Error("Invalid health-check time");
  const state: PaperHealth = previous ? readPaperHealth([previous], now) : {
    version: 1, lastSuccessAt: null, firstChallengeAt: null, failureReportedAt: null,
  };
  // The availability write can succeed before a health write fails. Its timestamp
  // is also valid recovery evidence, and bootstraps existing installations safely.
  if (availabilityCheckedAt !== undefined) {
    const checked = timestamp(availabilityCheckedAt, now);
    if (state.lastSuccessAt === null || checked > timestamp(state.lastSuccessAt, now)) {
      state.lastSuccessAt = new Date(checked).toISOString();
      state.firstChallengeAt = null;
      state.failureReportedAt = null;
    }
  }
  state.firstChallengeAt ??= new Date(now).toISOString();
  const since = timestamp(state.lastSuccessAt ?? state.firstChallengeAt, now);
  const elapsed = Math.max(0, now - since);
  let action: ChallengeDecision["action"] = "grace";
  if (state.failureReportedAt !== null) action = "already-reported";
  else if (elapsed >= CHALLENGE_GRACE_MS) {
    action = "alert";
    state.failureReportedAt = new Date(now).toISOString();
  }
  return { action, state, minutesWithoutSuccess: Math.floor(elapsed / 60_000) };
}

export async function recordPaperSuccess(io: HealthIO, now: number): Promise<void> {
  const state: PaperHealth = {
    version: 1, lastSuccessAt: new Date(now).toISOString(),
    firstChallengeAt: null, failureReportedAt: null,
  };
  await io.upsertState(HEALTH_CITY, HEALTH_EXAM_TYPE, [state], false);
}

export async function recordPaperChallenge(io: HealthIO, now: number): Promise<ChallengeDecision> {
  const [healthRows, availabilityRows] = await Promise.all([
    io.getPrevState(HEALTH_CITY), io.getPrevState("toronto"),
  ]);
  const row = healthRows.find(row => row.exam_type === HEALTH_EXAM_TYPE);
  const previous = row ? readPaperHealth(row.slots, now) : undefined;
  const checkedAt = availabilityRows.find(row => row.exam_type === "P-TCF Canada")?.checked_at;
  const decision = challengeDecision(previous, checkedAt, now);
  // Persist before suppressing or issuing the one workflow failure. A storage
  // error must fail immediately, never silently consume an incident.
  await io.upsertState(HEALTH_CITY, HEALTH_EXAM_TYPE, [decision.state], false);
  return decision;
}
