import type { getPrevState, upsertState } from "./db";
import { HEALTH_CITY, challengeDecision, readPaperHealth, type PaperHealth } from "./torontoPaperHealth";

// Reuse the proven one-hour state machine, retaining its v1 JSON field names.
// In these separate AEC rows, firstChallengeAt means first confirmed key-page 522.
export const aecHealthKey = (city: string) => `${city}/aec-key-page`;
type HealthIO = { getPrevState: typeof getPrevState; upsertState: typeof upsertState };

async function previousHealth(io: HealthIO, city: string, now: number): Promise<PaperHealth | undefined> {
  const rows = await io.getPrevState(HEALTH_CITY);
  const matches = rows.filter(row => row.exam_type === aecHealthKey(city));
  if (matches.length > 1) throw new Error("Ambiguous AEC origin health state");
  return matches.length ? readPaperHealth(matches[0].slots, now) : undefined;
}

export async function recordAec522(io: HealthIO, city: string, examTypes: string[], now: number) {
  if (!examTypes.length || new Set(examTypes).size !== examTypes.length) throw new Error("Invalid AEC health exam scope");
  const [previous, rows] = await Promise.all([previousHealth(io, city, now), io.getPrevState(city)]);
  const checked = examTypes.map(type => {
    const matching = rows.filter(row => row.exam_type === type);
    if (matching.length > 1) throw new Error("Ambiguous AEC availability state");
    if (!matching.length) return undefined;
    const value = matching[0].checked_at;
    const ms = value instanceof Date ? value.getTime() : typeof value === "string" ? Date.parse(value) : NaN;
    if (!Number.isFinite(ms) || ms < 0 || ms > now + 60_000) throw new Error("Invalid AEC availability timestamp");
    return ms;
  });
  // Ottawa requires BOTH formats. A partial write cannot rearm a reported outage.
  const baseline = checked.every(value => value !== undefined) ? new Date(Math.min(...checked as number[])) : undefined;
  const decision = challengeDecision(previous, baseline, now);
  // Persist first. Failure here remains immediate and cannot consume an alert.
  await io.upsertState(HEALTH_CITY, aecHealthKey(city), [decision.state], false);
  return decision;
}

export async function recordAecSuccess(io: HealthIO, city: string, now: number): Promise<void> {
  await previousHealth(io, city, now); // Malformed health state must remain visible.
  const state: PaperHealth = {
    version: 1, lastSuccessAt: new Date(now).toISOString(), firstChallengeAt: null, failureReportedAt: null,
  };
  await io.upsertState(HEALTH_CITY, aecHealthKey(city), [state], false);
}
