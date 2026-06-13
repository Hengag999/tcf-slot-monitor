// Vancouver reminder engine.
//
// AF Vancouver migrated off the Oncord product-combobox to a new "exam-selector"
// platform. The TCF exam listing now advertises each exam's *registration-open*
// time in advance (a unix epoch in `data-opens-at`). Because spots vanish within
// seconds of opening and the GitHub Actions cron is too coarse/unreliable to
// catch the instant of availability, Vancouver no longer pings on availability.
// Instead it pings **reminders ahead of each exam's registration-open time** so
// candidates are poised to book the moment registration opens.
//
// Reminder schedule (per exam): a one-off "new session" ping the first time a row
// appears, then 3-day / 2-day / 1-day reminders before `registrationOpensAt`.
// Sub-day reminders are intentionally omitted — the cron can't hit them. On each
// run only the MOST RECENT passed threshold fires (earlier missed ones are marked
// done, never back-fired), so a delayed/recovered cron sends one ping, not a burst.
//
// State persists in the existing slot_monitor_state row for vancouver: the `slots`
// JSONB column holds the tracking array below (no schema migration needed).

import { getPrevState, upsertState } from "./db";
import { postDiscord } from "./discord";

export interface VancouverExam {
  // MonitorSlot-compatible fields (so it flows through the orchestrator's scrape type)
  id: string;
  examType: "TCF Canada";
  date: string; // = label
  bookingUrl: string;
  // reminder-specific fields
  examKey: string; // stable per-exam key derived from the label
  label: string; // e.g. "TCF-Canada September 2, 2026"
  schedule: string; // exam sitting date(s), informational
  registrationWindow: string; // human text, e.g. "Jun 15 2026 12:00pm - Jun 30 2026 4:00pm"
  registrationOpensAt: number | null; // unix SECONDS from data-opens-at (null if not advertised)
  spotsLeft: number | null;
  statusClass: string; // es-status-* class, captured for diagnostics
}

interface TrackingEntry {
  examKey: string;
  label: string;
  registrationOpensAt: number | null;
  firedReminders: string[]; // subset of "new" | "3d" | "2d" | "1d"
}

export interface ReminderPing {
  examKey: string;
  label: string;
  kind: "new" | "3d" | "2d" | "1d";
  registrationOpensAt: number | null;
  spotsLeft: number | null;
  bookingUrl: string;
}

const DAY_MS = 86_400_000;
const THRESHOLDS: { key: "3d" | "2d" | "1d"; leadMs: number }[] = [
  { key: "3d", leadMs: 3 * DAY_MS },
  { key: "2d", leadMs: 2 * DAY_MS },
  { key: "1d", leadMs: 1 * DAY_MS },
];

/**
 * Pure reminder computation. Given the exams currently on the page, the previous
 * tracking state, and the current time, decide which pings to send and return the
 * updated tracking. No I/O — unit-testable.
 */
export function computeReminders(
  exams: VancouverExam[],
  prevTracking: TrackingEntry[],
  nowMs: number,
): { pings: ReminderPing[]; tracking: TrackingEntry[] } {
  const prevByKey = new Map(prevTracking.map((t) => [t.examKey, t]));
  const pings: ReminderPing[] = [];
  const tracking: TrackingEntry[] = [];

  for (const ex of exams) {
    const prev = prevByKey.get(ex.examKey);
    const fired = new Set<string>(prev?.firedReminders ?? []);
    const opensAtMs = ex.registrationOpensAt != null ? ex.registrationOpensAt * 1000 : null;

    // Thresholds whose trigger time (opensAt - lead) has passed, closest-to-open first.
    const passed =
      opensAtMs == null
        ? []
        : THRESHOLDS.filter((t) => nowMs >= opensAtMs - t.leadMs).sort((a, b) => a.leadMs - b.leadMs);
    const mostRecent = passed[0]; // smallest lead = closest to open = most recent

    if (!prev) {
      // Brand-new session: one "new" ping. Record any already-passed thresholds so
      // we don't immediately also fire a day reminder for the same sighting.
      pings.push(makePing(ex, "new"));
      fired.add("new");
      for (const t of passed) fired.add(t.key);
    } else if (mostRecent && !fired.has(mostRecent.key)) {
      // Existing session crossed a new threshold: fire only the most recent and
      // mark every passed threshold done (catch-up without back-firing the rest).
      pings.push(makePing(ex, mostRecent.key));
      for (const t of passed) fired.add(t.key);
    }

    tracking.push({
      examKey: ex.examKey,
      label: ex.label,
      registrationOpensAt: ex.registrationOpensAt,
      firedReminders: [...fired],
    });
  }

  return { pings, tracking };
}

function makePing(ex: VancouverExam, kind: ReminderPing["kind"]): ReminderPing {
  return {
    examKey: ex.examKey,
    label: ex.label,
    kind,
    registrationOpensAt: ex.registrationOpensAt,
    spotsLeft: ex.spotsLeft,
    bookingUrl: ex.bookingUrl,
  };
}

export function formatPacific(epochSec: number | null): string {
  if (epochSec == null) return "an unannounced time";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Vancouver",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(epochSec * 1000));
}

function formatCountdown(epochSec: number | null, nowMs: number): string {
  if (epochSec == null) return "";
  let s = Math.round((epochSec * 1000 - nowMs) / 1000);
  if (s <= 0) return "now";
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (!d && m) parts.push(`${m}m`);
  return parts.join(" ") || "<1m";
}

export function formatPings(pings: ReminderPing[], nowMs: number): string {
  const lines: string[] = ["@everyone 🇫🇷 **TCF Vancouver — registration update**", ""];
  for (const p of pings) {
    const when = formatPacific(p.registrationOpensAt);
    const cd = formatCountdown(p.registrationOpensAt, nowMs);
    const spots = p.spotsLeft != null ? ` · ${p.spotsLeft} spots left` : "";
    if (p.kind === "new") {
      lines.push(`🆕 **New session posted:** ${p.label}`);
      lines.push(`   Registration opens **${when}**${cd ? ` (in ${cd})` : ""}${spots}.`);
    } else {
      const label = p.kind === "3d" ? "3 days" : p.kind === "2d" ? "2 days" : "1 day";
      lines.push(`⏰ **~${label} until registration:** ${p.label}`);
      lines.push(`   Opens **${when}**${cd ? ` (in ${cd})` : ""}${spots} — be ready, spots go fast.`);
    }
    lines.push(`   👉 ${p.bookingUrl}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}

const CITY = "vancouver";
const EXAM_TYPE = "TCF Canada";

/**
 * Orchestrator entry point: load prev tracking, compute pings, notify, persist.
 * In dry-run, prev state is treated as empty and pings are printed, not sent.
 */
export async function runVancouverReminders(
  exams: VancouverExam[],
  webhookUrl: string | undefined,
  dryRun: boolean,
  nowMs: number = Date.now(),
): Promise<void> {
  const prevTracking = dryRun
    ? []
    : (((await getPrevState(CITY)).find((r) => r.exam_type === EXAM_TYPE)?.slots as
        | TrackingEntry[]
        | undefined) ?? []);

  const { pings, tracking } = computeReminders(exams, prevTracking, nowMs);

  console.log(`[vancouver] ${exams.length} exam(s) tracked, ${pings.length} reminder ping(s)`);
  for (const ex of exams) {
    console.log(
      `  - ${ex.label} | opens ${formatPacific(ex.registrationOpensAt)} | status=${ex.statusClass} | spots=${ex.spotsLeft}`,
    );
  }

  if (pings.length > 0) {
    const content = formatPings(pings, nowMs);
    if (dryRun) {
      console.log(`\n[vancouver] WOULD notify:\n${content}\n`);
    } else if (webhookUrl) {
      await postDiscord(webhookUrl, content);
    } else {
      console.warn("[vancouver] no webhook URL set — skipping notify");
    }
  }

  if (!dryRun) {
    await upsertState(CITY, EXAM_TYPE, tracking as unknown as any[], pings.length > 0);
  }
}
