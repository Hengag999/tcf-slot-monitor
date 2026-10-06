// Registration-reminder engine (Vancouver + Victoria).
//
// The AF "exam-selector" platform (alliancefrancaise.ca) advertises each exam's
// *registration-open* time in advance (a unix epoch in `data-opens-at`). Because
// spots vanish within seconds of opening and the GitHub Actions cron is too
// coarse/unreliable to catch the instant of availability, exam-selector cities
// don't ping on availability. Instead they ping **reminders ahead of each exam's
// registration-open time** so candidates are poised to book the moment
// registration opens.
//
// Reminder schedule (per exam): a one-off "new session" ping the first time a row
// appears, then 3-day / 2-day / 1-day reminders before `registrationOpensAt`.
// Closed/full historical rows are baselined silently; countdowns stop at opening.
// Sub-day reminders are intentionally omitted — the cron can't hit them. On each
// run only the MOST RECENT passed threshold fires (earlier missed ones are marked
// done, never back-fired), so a delayed/recovered cron sends one ping, not a burst.
//
// State persists in the existing slot_monitor_state row for the city: the `slots`
// JSONB column holds the tracking array below (no schema migration needed).

import { getPrevState, upsertState } from "./db";
import { postDiscord } from "./discord";

export interface RegistrationExam {
  // MonitorSlot-compatible fields (so it flows through the orchestrator's scrape type)
  id: string;
  examType: string;
  date: string; // = label
  bookingUrl: string;
  // reminder-specific fields
  legacyExamKey?: string; // previous label-only key, used for a one-time state migration
  bookingAvailable?: boolean; // explicit booking action observed on the source page
  examKey: string; // stable per-sitting key
  label: string; // e.g. "TCF-Canada September 2, 2026"
  location?: string;
  schedule: string; // exam sitting date(s), informational
  registrationWindow: string; // human text, e.g. "Jun 15 2026 12:00pm - Jun 30 2026 4:00pm"
  registrationOpensAt: number | null; // unix SECONDS from data-opens-at (null if not advertised)
  spotsLeft: number | null;
  statusClass: string; // es-status-* class, captured for diagnostics
}

export interface TrackingEntry {
  examKey: string;
  label: string;
  registrationOpensAt: number | null;
  firedReminders: string[]; // subset of "new" | "3d" | "2d" | "1d"
}

export interface ReminderPing {
  location?: string;
  examKey: string;
  label: string;
  kind: "new" | "3d" | "2d" | "1d";
  registrationOpensAt: number | null;
  registrationWindow: string;
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
  exams: RegistrationExam[],
  prevTracking: TrackingEntry[],
  nowMs: number,
  options: { futureOnly?: boolean } = {},
): { pings: ReminderPing[]; tracking: TrackingEntry[] } {
  const prevByKey = new Map<string, TrackingEntry[]>();
  for (const entry of prevTracking) {
    // Old label-only keys could collide; keep the union of consumed thresholds.
    const entries = prevByKey.get(entry.examKey) ?? [];
    entries.push(entry);
    prevByKey.set(entry.examKey, entries);
  }
  const pings: ReminderPing[] = [];
  const tracking: TrackingEntry[] = [];

  for (const ex of exams) {
    const previous = prevByKey.get(ex.examKey)
      ?? (ex.legacyExamKey ? prevByKey.get(ex.legacyExamKey) : undefined)
      ?? [];
    const fired = new Set(previous.flatMap((entry) => entry.firedReminders ?? []));
    const opensAtMs = ex.registrationOpensAt != null ? ex.registrationOpensAt * 1000 : null;
    const futureOpening = opensAtMs != null && opensAtMs > nowMs;
    const unavailable = /es-status-(closed|full|cancelled)/i.test(ex.statusClass);
    const actionable = !unavailable && (futureOpening || (!options.futureOnly && ex.bookingAvailable === true));

    // A rescheduled future opening starts a new countdown, but not another
    // first-sighting announcement. Closed historical rows are tracked silently.
    if (futureOpening && previous.length > 0
      && previous.every((entry) => entry.registrationOpensAt !== ex.registrationOpensAt)) {
      for (const threshold of THRESHOLDS) fired.delete(threshold.key);
    }
    const passed = futureOpening
      ? THRESHOLDS.filter((t) => nowMs >= opensAtMs! - t.leadMs).sort((a, b) => a.leadMs - b.leadMs)
      : [];
    const mostRecent = passed[0];

    if (actionable && !fired.has("new")) {
      pings.push(makePing(ex, "new"));
      fired.add("new");
      for (const t of passed) fired.add(t.key);
    } else if (actionable && mostRecent && !fired.has(mostRecent.key)) {
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

function makePing(ex: RegistrationExam, kind: ReminderPing["kind"]): ReminderPing {
  return {
    examKey: ex.examKey,
    location: ex.location,
    label: ex.label,
    kind,
    registrationOpensAt: ex.registrationOpensAt,
    registrationWindow: ex.registrationWindow,
    spotsLeft: ex.spotsLeft,
    bookingUrl: ex.bookingUrl,
  };
}

export interface ReminderOptions {
  futureOnly?: boolean;
  examType?: string;
  timeZone?: string;
  timeZoneLabel?: string;
  dependencies?: {
    getPrevState: typeof getPrevState;
    upsertState: typeof upsertState;
    postDiscord: typeof postDiscord;
  };
}

export function formatPacific(epochSec: number | null): string {
  return formatOpening(epochSec);
}

function formatOpening(epochSec: number | null, options: ReminderOptions = {}): string {
  if (epochSec == null) return "时间待定";
  const formatted = new Intl.DateTimeFormat("zh-CN", {
    timeZone: options.timeZone ?? "America/Vancouver",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(epochSec * 1000));
  return `${formatted}（${options.timeZoneLabel ?? "温哥华时间"}）`;
}

function formatCountdown(epochSec: number | null, nowMs: number): string {
  if (epochSec == null) return "";
  let s = Math.round((epochSec * 1000 - nowMs) / 1000);
  if (s <= 0) return "";
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  const parts: string[] = [];
  if (d) parts.push(`${d}天`);
  if (h) parts.push(`${h}小时`);
  if (!d && m) parts.push(`${m}分钟`);
  return parts.join("") || "不到 1 分钟";
}

export function formatPings(cityZh: string, pings: ReminderPing[], nowMs: number, options: ReminderOptions = {}): string {
  const lines: string[] = [`@everyone 🇫🇷 **${cityZh} TCF Canada · 报名提醒**`, ""];
  // Share opening details and links without merging distinct sittings. Large
  // registration batches otherwise repeat the same paragraph dozens of times.
  const groups = new Map<string, ReminderPing[]>();
  for (const ping of pings) {
    const key = JSON.stringify([ping.kind, ping.registrationOpensAt,
      ping.registrationOpensAt == null ? ping.registrationWindow : null, ping.bookingUrl]);
    const group = groups.get(key) ?? [];
    group.push(ping);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    const p = group[0];
    const cd = formatCountdown(p.registrationOpensAt, nowMs);
    if (p.kind === "new") {
      lines.push(`🆕 **新场次上线：${group.length} 场**`);
      if (p.registrationOpensAt == null) {
        const window = p.registrationWindow
          ? `报名窗口：**${p.registrationWindow}**（官网当前显示可报名）`
          : "官网当前显示可报名，请查看报名页面。";
        lines.push(window);
      } else {
        const future = p.registrationOpensAt * 1000 > nowMs;
        lines.push(`${future ? "报名将于" : "报名开放时间为"} **${formatOpening(p.registrationOpensAt, options)}**${future ? " 开放" : ""}${cd ? `（还有 ${cd}）` : ""}。`);
      }
    } else {
      const label = p.kind === "3d" ? "3 天" : p.kind === "2d" ? "2 天" : "1 天";
      lines.push(`⏰ **距报名开放约 ${label}：${group.length} 场**`);
      lines.push(`报名将于 **${formatOpening(p.registrationOpensAt, options)}** 开放${cd ? `（还有 ${cd}）` : ""} —— 请提前准备。`);
    }
    const locations = new Map<string, ReminderPing[]>();
    for (const ping of group) {
      const location = ping.location ?? "";
      const sittings = locations.get(location) ?? [];
      sittings.push(ping);
      locations.set(location, sittings);
    }
    for (const [location, sittings] of locations) {
      lines.push("");
      if (location) lines.push(`📍 ${location}（${sittings.length} 场）`);
      for (const sitting of sittings) {
        const label = sitting.label.replace(/^TCF[-\s]+Canada\s+/i, "");
        const spots = sitting.spotsLeft != null ? ` · 剩 ${sitting.spotsLeft} 个名额` : "";
        lines.push(`• ${label}${spots}`);
      }
    }
    lines.push(`👉 ${p.bookingUrl}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}

const EXAM_TYPE = "TCF Canada";

/**
 * Orchestrator entry point: load prev tracking, compute pings, notify, persist.
 * In dry-run, prev state is treated as empty and pings are printed, not sent.
 */
export async function runRegistrationReminders(
  cityKey: string,
  cityZh: string,
  exams: RegistrationExam[],
  webhookUrl: string | undefined,
  dryRun: boolean,
  nowMs: number = Date.now(),
  options: ReminderOptions = {},
): Promise<void> {
  const io = options.dependencies ?? { getPrevState, upsertState, postDiscord };
  const examType = options.examType ?? EXAM_TYPE;
  const prevTracking = dryRun
    ? []
    : (((await io.getPrevState(cityKey)).find((r) => r.exam_type === examType)?.slots as
        | TrackingEntry[]
        | undefined) ?? []);

  const { pings, tracking } = computeReminders(exams, prevTracking, nowMs, options);

  console.log(`[${cityKey}] ${exams.length} exam(s) tracked, ${pings.length} reminder ping(s)`);
  for (const ex of exams) {
    console.log(
      `  - ${ex.label} | opens ${formatOpening(ex.registrationOpensAt, options)} | status=${ex.statusClass} | spots=${ex.spotsLeft}`,
    );
  }

  if (pings.length > 0) {
    const content = formatPings(cityZh, pings, nowMs, options);
    if (dryRun) {
      console.log(`\n[${cityKey}] WOULD notify:\n${content}\n`);
    } else if (webhookUrl) {
      await io.postDiscord(webhookUrl, content);
      console.log(`[${cityKey}] Discord accepted ${pings.length} reminder(s)`);
    } else {
      throw new Error(`[${cityKey}] webhook missing; reminder state was not advanced`);
    }
  }

  if (!dryRun) {
    await io.upsertState(cityKey, examType, tracking, pings.length > 0);
  }
}
