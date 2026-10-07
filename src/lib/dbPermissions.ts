export const MONITOR_DB_ROLE = "tcf_slot_monitor";
export const MONITOR_DB_TABLE = "public.slot_monitor_state";

export interface DbPermissionSnapshot {
  currentUser: string;
  sessionUser: string;
  adminFlags: boolean;
  membershipCount: number;
  targetExists: boolean;
  targetOwned: boolean;
  targetReadable: boolean;
  targetInsertable: boolean;
  targetUpdatable: boolean;
  targetForbiddenPrivileges: boolean;
  targetGrantOptions: boolean;
  otherTablePrivilegeCount: number;
  otherColumnPrivilegeCount: number;
  sequencePrivilegeCount: number;
  schemaCreateCount: number;
  databaseCreateCount: number;
  securityDefinerCount: number;
  inspectedRelationCount: number;
  inspectedSequenceCount: number;
}

// Catalogs and privilege-inquiry functions only: never reads application rows.
// Check effective privileges, including PUBLIC grants and column-level grants.
// Ordinary PUBLIC TEMPORARY and SECURITY INVOKER functions are intentionally allowed.
// CASE guards object-specific inquiry functions: PostgreSQL may reorder WHERE
// predicates or inline CTEs and otherwise call a sequence function on a table.
export const DB_PERMISSION_QUERY = `
WITH app_schemas AS (
  SELECT oid FROM pg_catalog.pg_namespace
  WHERE nspname !~ '^pg_' AND nspname <> 'information_schema'
), app_relations AS (
  SELECT c.oid, c.relkind, c.relowner
  FROM pg_catalog.pg_class c JOIN app_schemas n ON n.oid = c.relnamespace
), target AS (
  SELECT c.oid, c.relowner FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'slot_monitor_state' AND c.relkind IN ('r', 'p')
), login_role AS (
  SELECT * FROM pg_catalog.pg_roles WHERE rolname = current_user
), table_privileges AS (
  SELECT c.oid,
    CASE WHEN c.relkind IN ('r', 'p', 'v', 'm', 'f') THEN
      pg_catalog.has_table_privilege(c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
      OR CASE WHEN current_setting('server_version_num')::int >= 170000
        THEN pg_catalog.has_table_privilege(c.oid, 'MAINTAIN') ELSE false END
      ELSE false END AS table_access,
    CASE WHEN c.relkind IN ('r', 'p', 'v', 'm', 'f') THEN
      pg_catalog.has_any_column_privilege(c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
      ELSE false END AS column_access
  FROM app_relations c WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND c.oid NOT IN (SELECT oid FROM target)
)
SELECT pg_catalog.json_build_object(
  'currentUser', current_user,
  'sessionUser', session_user,
  'adminFlags', (SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls FROM login_role),
  'membershipCount', (SELECT count(*) FROM pg_catalog.pg_auth_members WHERE member = (SELECT oid FROM login_role)),
  'targetExists', EXISTS(SELECT 1 FROM target),
  'targetOwned', EXISTS(SELECT 1 FROM target WHERE relowner = (SELECT oid FROM login_role)),
  'targetReadable', (SELECT pg_catalog.has_table_privilege(oid, 'SELECT') FROM target),
  'targetInsertable', (SELECT pg_catalog.has_table_privilege(oid, 'INSERT') FROM target),
  'targetUpdatable', (SELECT pg_catalog.has_table_privilege(oid, 'UPDATE') FROM target),
  'targetForbiddenPrivileges', (SELECT
    pg_catalog.has_table_privilege(oid, 'DELETE, TRUNCATE, REFERENCES, TRIGGER')
    OR pg_catalog.has_any_column_privilege(oid, 'REFERENCES')
    OR CASE WHEN current_setting('server_version_num')::int >= 170000
      THEN pg_catalog.has_table_privilege(oid, 'MAINTAIN') ELSE false END FROM target),
  'targetGrantOptions', (SELECT
    pg_catalog.has_table_privilege(oid, 'SELECT WITH GRANT OPTION, INSERT WITH GRANT OPTION, UPDATE WITH GRANT OPTION')
    OR pg_catalog.has_any_column_privilege(oid, 'SELECT WITH GRANT OPTION, INSERT WITH GRANT OPTION, UPDATE WITH GRANT OPTION')
    FROM target),
  'otherTablePrivilegeCount', (SELECT count(*) FROM table_privileges WHERE table_access),
  'otherColumnPrivilegeCount', (SELECT count(*) FROM table_privileges WHERE column_access),
  'sequencePrivilegeCount', (SELECT count(*) FROM app_relations
    WHERE CASE WHEN relkind = 'S'
      THEN pg_catalog.has_sequence_privilege(oid, 'USAGE, SELECT, UPDATE') ELSE false END),
  'schemaCreateCount', (SELECT count(*) FROM pg_catalog.pg_namespace
    WHERE nspname !~ '^pg_(toast_)?temp_' AND pg_catalog.has_schema_privilege(oid, 'CREATE')),
  'databaseCreateCount', (SELECT count(*) FROM pg_catalog.pg_database WHERE pg_catalog.has_database_privilege(oid, 'CREATE')),
  'securityDefinerCount', (SELECT count(*) FROM pg_catalog.pg_proc p JOIN app_schemas n ON n.oid = p.pronamespace
    WHERE p.prosecdef AND pg_catalog.has_schema_privilege(n.oid, 'USAGE')
      AND pg_catalog.has_function_privilege(p.oid, 'EXECUTE')),
  'inspectedRelationCount', (SELECT count(*) FROM table_privileges),
  'inspectedSequenceCount', (SELECT count(*) FROM app_relations WHERE relkind = 'S')
) AS permissions
`;

/** Fixed diagnostic labels only; do not include database errors or connection strings. */
export function validateDbPermissions(snapshot: DbPermissionSnapshot): string[] {
  const failures: string[] = [];
  if (snapshot.currentUser !== MONITOR_DB_ROLE || snapshot.sessionUser !== MONITOR_DB_ROLE) failures.push("role identity");
  if (snapshot.adminFlags !== false) failures.push("administrative role privileges");
  if (snapshot.membershipCount !== 0) failures.push("role memberships");
  if (snapshot.targetExists !== true || snapshot.targetReadable !== true
    || snapshot.targetInsertable !== true || snapshot.targetUpdatable !== true) failures.push("required monitor table privileges");
  if (snapshot.targetOwned !== false) failures.push("table ownership");
  if (snapshot.targetForbiddenPrivileges !== false) failures.push("forbidden monitor table privileges");
  if (snapshot.targetGrantOptions !== false) failures.push("grant options");
  const counts = [
    ["otherTablePrivilegeCount", "other table privileges"],
    ["otherColumnPrivilegeCount", "other column privileges"],
    ["sequencePrivilegeCount", "sequence privileges"],
    ["schemaCreateCount", "schema CREATE"],
    ["databaseCreateCount", "database CREATE"],
    ["securityDefinerCount", "callable SECURITY DEFINER routines"],
  ] as const;
  for (const [field, label] of counts) if (snapshot[field] !== 0) failures.push(label);
  if (![snapshot.inspectedRelationCount, snapshot.inspectedSequenceCount]
    .every(count => Number.isSafeInteger(count) && count >= 0)) failures.push("invalid scope counts");
  return failures;
}

export function sanitizedDbCheckError(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  return "Database permission check could not complete"
    + (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? ` (SQLSTATE ${code})` : "");
}
