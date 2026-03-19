import { neon } from "@neondatabase/serverless";

export interface StateRow {
  city: string;
  exam_type: string;
  slots: any[];
}

let _sql: ReturnType<typeof neon>;

function getSql() {
  if (!_sql) {
    if (!process.env.POSTGRES_URL) {
      throw new Error("POSTGRES_URL environment variable is required");
    }
    _sql = neon(process.env.POSTGRES_URL);
  }
  return _sql;
}

export async function getPrevState(city: string): Promise<StateRow[]> {
  const sql = getSql();
  const rows = await sql`
    SELECT city, exam_type, slots
    FROM slot_monitor_state
    WHERE city = ${city}
  `;
  return rows as StateRow[];
}

export async function upsertState(
  city: string,
  examType: string,
  slots: any[],
  notified: boolean,
): Promise<void> {
  const sql = getSql();
  const slotsJson = JSON.stringify(slots);

  if (notified) {
    await sql`
      INSERT INTO slot_monitor_state (city, exam_type, slots, checked_at, notified_at)
      VALUES (${city}, ${examType}, ${slotsJson}::jsonb, NOW(), NOW())
      ON CONFLICT (city, exam_type) DO UPDATE SET
        slots = ${slotsJson}::jsonb,
        checked_at = NOW(),
        notified_at = NOW()
    `;
  } else {
    await sql`
      INSERT INTO slot_monitor_state (city, exam_type, slots, checked_at)
      VALUES (${city}, ${examType}, ${slotsJson}::jsonb, NOW())
      ON CONFLICT (city, exam_type) DO UPDATE SET
        slots = ${slotsJson}::jsonb,
        checked_at = NOW()
    `;
  }
}
