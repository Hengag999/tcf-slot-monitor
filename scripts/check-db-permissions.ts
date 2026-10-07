import "../src/lib/env";
import { neon } from "@neondatabase/serverless";
import {
  DB_PERMISSION_QUERY, MONITOR_DB_ROLE, MONITOR_DB_TABLE,
  sanitizedDbCheckError, validateDbPermissions, type DbPermissionSnapshot,
} from "../src/lib/dbPermissions";

async function main(): Promise<void> {
  if (!process.env.POSTGRES_URL) throw new Error("Database configuration missing");
  const sql = neon(process.env.POSTGRES_URL);
  const rows = await sql.query(DB_PERMISSION_QUERY, [], {
    fetchOptions: { signal: AbortSignal.timeout(20_000) },
  });
  const snapshot = rows[0]?.permissions as DbPermissionSnapshot;
  const failures = validateDbPermissions(snapshot);
  if (failures.length) {
    console.error(`Database permission check failed: ${failures.join(", ")}`);
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify({
    event: "database_permissions_verified",
    role: MONITOR_DB_ROLE,
    table: MONITOR_DB_TABLE,
    allowed: ["SELECT", "INSERT", "UPDATE"],
    inspectedOtherRelations: snapshot.inspectedRelationCount,
    inspectedSequences: snapshot.inspectedSequenceCount,
    forbiddenPrivileges: 0,
  }));
}

if (process.argv[1]?.endsWith("check-db-permissions.ts")) {
  main().catch(error => {
    console.error(sanitizedDbCheckError(error));
    process.exitCode = 1;
  });
}
