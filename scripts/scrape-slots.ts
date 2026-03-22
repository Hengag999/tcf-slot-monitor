import { scrapeToronto } from "./scrapers/toronto";
import { scrapeCalgary } from "./scrapers/calgary";
import { scrapeVancouver } from "./scrapers/vancouver";
import { scrapeHalifax } from "./scrapers/halifax";
import { scrapeOttawa } from "./scrapers/ottawa";
import { scrapeAshton } from "./scrapers/ashton";
import { scrapeNorthYork } from "./scrapers/northyork";
import { getPrevState, upsertState } from "../src/lib/db";
import { notifyDiscord } from "../src/lib/discord";

// Common shape that all scrapers satisfy
interface MonitorSlot {
  id: string;
  examType: string;
  date: string;
  bookingUrl: string;
  startTime?: string;
  endTime?: string;
  availableSeats?: number;
}

interface CityConfig {
  key: string;
  label: string;
  scrape: () => Promise<MonitorSlot[]>;
  webhookEnv: string;
  // When true, notify per newly-appeared date instead of only on 0→N
  diffByDate?: boolean;
}

const DRY_RUN = process.argv.includes("--dry-run");

const cities: CityConfig[] = [
  { key: "toronto", label: "Toronto", scrape: scrapeToronto, webhookEnv: "DISCORD_WEBHOOK_TORONTO" },
  { key: "calgary", label: "Calgary", scrape: scrapeCalgary, webhookEnv: "DISCORD_WEBHOOK_CALGARY" },
  { key: "vancouver", label: "Vancouver", scrape: scrapeVancouver, webhookEnv: "DISCORD_WEBHOOK_VANCOUVER" },
  { key: "halifax", label: "Halifax", scrape: scrapeHalifax, webhookEnv: "DISCORD_WEBHOOK_HALIFAX" },
  { key: "ottawa", label: "Ottawa", scrape: scrapeOttawa, webhookEnv: "DISCORD_WEBHOOK_OTTAWA" },
  { key: "ashton", label: "Ashton", scrape: scrapeAshton, webhookEnv: "DISCORD_WEBHOOK_ASHTON" },
  { key: "northyork", label: "North York", scrape: scrapeNorthYork, webhookEnv: "DISCORD_WEBHOOK_NORTHYORK", diffByDate: true },
];

function groupByExamType(slots: MonitorSlot[]): Record<string, MonitorSlot[]> {
  const groups: Record<string, MonitorSlot[]> = {};
  for (const slot of slots) {
    (groups[slot.examType] ??= []).push(slot);
  }
  return groups;
}

async function main() {
  if (DRY_RUN) console.log("=== DRY RUN — no DB writes, no Discord notifications ===\n");

  for (const city of cities) {
    let allSlots: MonitorSlot[];
    try {
      allSlots = await city.scrape();
    } catch (err) {
      console.error(`[${city.key}] Scraper error, skipping:`, err);
      continue;
    }

    console.log(`[${city.key}] ${allSlots.length} available slot(s)`);

    const groups = groupByExamType(allSlots);
    const prevRows = DRY_RUN ? [] : await getPrevState(city.key);

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
        if (DRY_RUN) {
          for (const s of slotsToNotify) {
            const time = s.startTime && s.endTime ? ` — ${s.startTime} to ${s.endTime}` : "";
            const seats = s.availableSeats != null ? ` (${s.availableSeats} seats)` : "";
            console.log(`    📅 ${s.date}${time}${seats}`);
            console.log(`    ${s.bookingUrl}`);
          }
        } else {
          const webhookUrl = process.env[city.webhookEnv];
          if (webhookUrl) {
            await notifyDiscord(webhookUrl, city.label, examType, slotsToNotify);
          } else {
            console.warn(`  ⚠ No webhook URL (${city.webhookEnv} not set)`);
          }
          await upsertState(city.key, examType, slots, true);
        }
      } else {
        if (!DRY_RUN) {
          await upsertState(city.key, examType, slots, false);
        }
      }
    }
  }
}

main()
  .then(() => console.log("\nDone."))
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
