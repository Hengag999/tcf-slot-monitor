import "../src/lib/env"; // load .env.local before anything reads process.env
import { scrapeTorontoComputer, scrapeTorontoPaper, TorontoPaperChallengeError } from "./scrapers/toronto";
import { scrapeCalgary } from "./scrapers/calgary";
import { scrapeHalifax } from "./scrapers/halifax";
import { scrapeOttawa } from "./scrapers/ottawa";
import { scrapeAshton } from "./scrapers/ashton";
import { scrapeNorthYork } from "./scrapers/northyork";
import { scrapeWinnipeg, WINNIPEG_PAGE } from "./scrapers/winnipeg";
import { bookableEdmontonSlots, scrapeEdmontonExams } from "./scrapers/edmonton";
import { scrapeTcfListing, type ExamSelectorRow } from "../src/lib/examSelector";
import { getPrevState, upsertState } from "../src/lib/db";
import { notifyDiscord, type PublishedAvailabilityStyle } from "../src/lib/discord";
import { runRegistrationReminders, type RegistrationExam, type ReminderOptions } from "../src/lib/registrationReminders";
import { recordPaperChallenge, recordPaperSuccess } from "../src/lib/torontoPaperHealth";

// Common shape that all scrapers satisfy
export interface MonitorSlot {
  id: string;
  examType: string;
  date: string;
  bookingUrl: string;
  startTime?: string;
  endTime?: string;
  availableSeats?: number;
}

export interface CityConfig {
  key: string;
  source?: string;
  examTypes?: string[];
  reminderOptions?: ReminderOptions;
  label: string;
  scrape: () => Promise<MonitorSlot[]>;
  webhookEnv: string;
  notificationStyle?: PublishedAvailabilityStyle;
  // When true, notify per newly-appeared date instead of only on 0→N
  diffByDate?: boolean;
  // When true, the city runs the registration-reminder engine instead of the
  // availability diff (Vancouver, Victoria — see src/lib/registrationReminders.ts).
  reminderMode?: boolean;
  // Chinese city name used in the reminder message header (reminderMode only).
  zhLabel?: string;
}

const DRY_RUN = process.argv.includes("--dry-run");

export function createSources(): CityConfig[] {
  // Cache only inside one run: both consumers must see the same complete listing.
  let bc: Promise<ExamSelectorRow[]> | undefined;
  let edmonton: Promise<ExamSelectorRow[]> | undefined;
  const bcRows = () => bc ??= scrapeTcfListing();
  const edmontonRows = () => edmonton ??= scrapeEdmontonExams();
  return [
  { key: "toronto", source: "computer", label: "Toronto", scrape: scrapeTorontoComputer, examTypes: ["E-TCF Canada"], webhookEnv: "DISCORD_WEBHOOK_TORONTO" },
  { key: "toronto", source: "paper", label: "Toronto", scrape: scrapeTorontoPaper, examTypes: ["P-TCF Canada"], webhookEnv: "DISCORD_WEBHOOK_TORONTO" },
  { key: "calgary", label: "Calgary", scrape: scrapeCalgary, webhookEnv: "DISCORD_WEBHOOK_CALGARY" },
  { key: "vancouver", label: "Vancouver", scrape: async () => (await bcRows()).filter((row) => !/victoria/i.test(row.location)), webhookEnv: "DISCORD_WEBHOOK_VANCOUVER", reminderMode: true, zhLabel: "温哥华" },
  { key: "halifax", label: "Halifax", scrape: scrapeHalifax, webhookEnv: "DISCORD_WEBHOOK_HALIFAX" },
  { key: "ottawa", label: "Ottawa", scrape: scrapeOttawa, webhookEnv: "DISCORD_WEBHOOK_OTTAWA" },
  { key: "ashton", label: "Ashton", scrape: scrapeAshton, webhookEnv: "DISCORD_WEBHOOK_ASHTON" },
  { key: "northyork", label: "North York", scrape: scrapeNorthYork, webhookEnv: "DISCORD_WEBHOOK_NORTHYORK", diffByDate: true },
  { key: "victoria", label: "Victoria", scrape: async () => (await bcRows()).filter((row) => /victoria/i.test(row.location)), webhookEnv: "DISCORD_WEBHOOK_VICTORIA", reminderMode: true, zhLabel: "维多利亚" },
  { key: "edmonton", source: "availability", label: "Edmonton", scrape: async () => bookableEdmontonSlots(await edmontonRows()), examTypes: ["TCF Canada"], webhookEnv: "DISCORD_WEBHOOK_EDMONTON", diffByDate: true },
  { key: "edmonton", source: "registration", label: "Edmonton", scrape: edmontonRows, webhookEnv: "DISCORD_WEBHOOK_EDMONTON", reminderMode: true, zhLabel: "埃德蒙顿", reminderOptions: { futureOnly: true, examType: "TCF Canada registration reminders", timeZone: "America/Edmonton", timeZoneLabel: "埃德蒙顿时间" } },
  {
    key: "winnipeg", label: "Winnipeg · 温尼伯", scrape: scrapeWinnipeg,
    examTypes: ["TCF Canada"], webhookEnv: "DISCORD_WEBHOOK_WINNIPEG", diffByDate: true,
    notificationStyle: {
      kind: "published-availability", sourceUrl: WINNIPEG_PAGE,
      caveat: "未注明年份的场次，请在报名时向考点确认。需提交报名表、付款并由考点确认，非即时锁位。",
    },
  },
  ];
}

function groupByExamType(slots: MonitorSlot[]): Record<string, MonitorSlot[]> {
  const groups: Record<string, MonitorSlot[]> = {};
  for (const slot of slots) {
    (groups[slot.examType] ??= []).push(slot);
  }
  return groups;
}

export interface MonitorDependencies {
  getPrevState: typeof getPrevState;
  upsertState: typeof upsertState;
  notifyDiscord: typeof notifyDiscord;
  runRegistrationReminders: typeof runRegistrationReminders;
}
const dependencies: MonitorDependencies = { getPrevState, upsertState, notifyDiscord, runRegistrationReminders };

export async function processCity(
  city: CityConfig,
  allSlots: MonitorSlot[],
  dryRun = DRY_RUN,
  io: MonitorDependencies = dependencies,
): Promise<void> {
  // Exam-selector cities run the registration-reminder engine, not the availability diff.
  if (city.reminderMode) {
    await io.runRegistrationReminders(
      city.key,
      city.zhLabel ?? city.label,
      allSlots as unknown as RegistrationExam[],
      process.env[city.webhookEnv],
      dryRun,
      Date.now(),
      city.reminderOptions,
    );
    return;
  }

  console.log(`[${city.key}] ${allSlots.length} available slot(s)`);

  const groups = groupByExamType(allSlots);
  if (city.examTypes && allSlots.some((slot) => !city.examTypes!.includes(slot.examType))) {
    throw new Error(`Source ${city.key}/${city.source} returned an unexpected exam type`);
  }
  const prevRows = dryRun ? [] : (await io.getPrevState(city.key))
    .filter((row) => !city.examTypes || city.examTypes.includes(row.exam_type));

  // Successful scoped empty sources still get freshness; failed sources never
  // enter this function and cannot erase another source's last-known state.
  for (const examType of city.examTypes ?? []) groups[examType] ??= [];

  // Ensure exam types that existed in DB but returned 0 now get updated to []
  for (const row of prevRows) {
    if (!(row.exam_type in groups)) {
      groups[row.exam_type] = [];
    }
  }

  for (const [examType, slots] of Object.entries(groups)) {
    const prev = prevRows.find((r) => r.exam_type === examType);
    const prevSlots = prev ? (prev.slots as any[]) : [];
    const prevCount = prevSlots.length;

    // Determine which slots to notify about
    let slotsToNotify: MonitorSlot[];

    if (city.diffByDate) {
      // Per-date diff: notify only about dates that weren't in the previous set
      const prevDates = new Set(prevSlots.map((s: any) => s.date));
      slotsToNotify = slots.filter((s) => !prevDates.has(s.date));
      if (slotsToNotify.length > 0) {
        console.log(`  [${examType}] ${prevCount} → ${slots.length} — ${slotsToNotify.length} new date(s) — NOTIFY`);
      } else {
        console.log(`  [${examType}] ${prevCount} → ${slots.length}`);
      }
    } else {
      // Original logic: notify only on 0 → N transition
      slotsToNotify = prevCount === 0 && slots.length > 0 ? slots : [];
      if (slotsToNotify.length > 0) {
        console.log(`  [${examType}] 0 → ${slots.length} — NOTIFY`);
      } else {
        console.log(`  [${examType}] ${prevCount} → ${slots.length}`);
      }
    }

    if (slotsToNotify.length > 0) {
      if (dryRun) {
        for (const s of slotsToNotify) {
          const time = s.startTime && s.endTime ? ` — ${s.startTime} to ${s.endTime}` : "";
          const seats = s.availableSeats != null ? ` (${s.availableSeats} seats)` : "";
          console.log(`    📅 ${s.date}${time}${seats}`);
          console.log(`    ${s.bookingUrl}`);
        }
      } else {
        const webhookUrl = process.env[city.webhookEnv];
        if (webhookUrl) {
          await io.notifyDiscord(webhookUrl, city.label, examType, slotsToNotify, city.notificationStyle);
          console.log(`  [${examType}] Discord accepted ${slotsToNotify.length} slot(s)`);
        } else {
          throw new Error(`${city.webhookEnv} missing; notification state was not advanced`);
        }
        await io.upsertState(city.key, examType, slots, true);
      }
    } else {
      if (!dryRun) {
        await io.upsertState(city.key, examType, slots, false);
      }
    }
  }
}

export async function runMonitor(
  sources: CityConfig[] = createSources(),
  dryRun = DRY_RUN,
  io: MonitorDependencies = dependencies,
  now: () => number = Date.now,
): Promise<void> {
  if (dryRun) console.log("=== DRY RUN — no DB writes, no Discord notifications ===\n");
  const failures: string[] = [];
  const results: { source: string; status: string }[] = [];

  for (const city of sources) {
    const source = city.source ? `${city.key}/${city.source}` : city.key;
    let allSlots: MonitorSlot[];
    try {
      allSlots = await city.scrape();
    } catch (err) {
      if (!dryRun && source === "toronto/paper" && err instanceof TorontoPaperChallengeError) {
        try {
          const decision = await recordPaperChallenge(io, now());
          const detail = decision.action === "alert" ? "one-hour outage — alert issued"
            : decision.action === "already-reported" ? "outage already reported — repeats suppressed"
            : "within one-hour grace period";
          console.warn(`[${source}] Known SiteGround challenge: ${detail}; ${decision.minutesWithoutSuccess} min without success; availability state preserved`);
          results.push({ source, status: `DEGRADED — ${detail}; state preserved` });
          if (decision.action === "alert") failures.push(`${source} (one-hour challenge outage)`);
        } catch {
          console.error(`[${source}] Health-state check/persistence failed; cannot safely suppress challenge`);
          failures.push(`${source} (health state)`);
          results.push({ source, status: "HEALTH STATE FAILED — availability state preserved" });
        }
        continue;
      }
      console.error(`[${source}] Scraper error, skipping:`, err);
      failures.push(`${source} (scrape)`);
      results.push({ source, status: "SCRAPE FAILED — state preserved" });
      continue;
    }
    try {
      await processCity(city, allSlots, dryRun, io);
      if (!dryRun && source === "toronto/paper") await recordPaperSuccess(io, now());
      results.push({ source, status: "OK" });
    } catch (err) {
      console.error(`[${source}] Notify/persist error, skipping:`, err);
      failures.push(`${source} (notify/persist)`);
      results.push({ source, status: "NOTIFY/PERSIST FAILED" });
    }
  }
  console.table(results);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFile } = await import("node:fs/promises");
    await appendFile(process.env.GITHUB_STEP_SUMMARY,
      "## Monitor source health\n\n| Source | Result |\n|---|---|\n"
      + results.map((r) => `| ${r.source} | ${r.status} |`).join("\n") + "\n");
  }
  if (failures.length) throw new Error(`Run completed with errors in: ${failures.join(", ")}`);
}

// Importable without executing live I/O, for focused orchestration regression tests.
if (process.argv[1]?.endsWith("scrape-slots.ts")) {
  runMonitor()
    .then(() => console.log("\nDone."))
    .catch((err) => {
      console.error("Fatal error:", err);
      process.exitCode = 1;
    });
}
