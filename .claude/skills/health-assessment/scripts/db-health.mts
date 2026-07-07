// Query slot_monitor_state freshness — the primary scraper-health signal.
// Run from the repo root so @neondatabase/serverless resolves:
//   npx tsx .claude/skills/health-assessment/scripts/db-health.mts
import { readFileSync } from "fs";
import { neon } from "@neondatabase/serverless";

const line = readFileSync(".env.local", "utf8")
  .split(/\r?\n/).find(l => l.startsWith("POSTGRES_URL"));
if (!line) throw new Error("no POSTGRES_URL in .env.local");
const url = line.slice(line.indexOf("=") + 1).trim()
  .replace(/^["']|["']$/g, "").replace(/[\r\n\s]+$/g, "");
const sql = neon(url);

const rows = await sql`
  SELECT city, exam_type,
         to_char(checked_at, 'YYYY-MM-DD HH24:MI') AS checked_at,
         to_char(notified_at, 'YYYY-MM-DD HH24:MI') AS notified_at,
         jsonb_array_length(slots) AS n_slots,
         round(extract(epoch from (now() - checked_at))/3600, 1) AS checked_h_ago
  FROM slot_monitor_state
  ORDER BY checked_at DESC, city`;
console.table(rows);
