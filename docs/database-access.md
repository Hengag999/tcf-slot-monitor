# Monitor database access

The monitor shares a Neon database with BonTCF, but uses its own SQL login,
`tcf_slot_monitor`. The application's owner login must not be used by this
repository or its GitHub Actions workflow.

## Required permissions

| Object | Permission |
| --- | --- |
| Database `neondb` | `CONNECT` |
| Schema `public` | `USAGE` |
| Table `public.slot_monitor_state` | `SELECT`, `INSERT`, `UPDATE` |

The monitor and the optional Vancouver reconciliation both fit this scope.
Neither needs deletion, sequences, ownership, grant options, schema creation,
role memberships, or administrative role attributes.

The Toronto paper challenge policy also stores a versioned health record in this
same table at `(__monitor_health__, toronto/paper)`. Its timestamps and incident
marker are separate from availability snapshots and Discord delivery state. This
requires no additional table, schema, or role permissions. See the
[Toronto runbook](scrapers/toronto.md) for the one-hour alert policy.

Create this role through SQL: roles created through the Neon Console/API can
receive elevated Neon membership. Use `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
NOINHERIT NOREPLICATION NOBYPASSRLS`, a separately generated password, no role
memberships, and `search_path = pg_catalog, public`. An administrator applies
these grants:

```sql
GRANT CONNECT ON DATABASE neondb TO tcf_slot_monitor;
GRANT USAGE ON SCHEMA public TO tcf_slot_monitor;
GRANT SELECT, INSERT, UPDATE ON TABLE public.slot_monitor_state TO tcf_slot_monitor;
```

Store the connection string only in the GitHub Actions encrypted `POSTGRES_URL`
secret and, for local use, the gitignored `.env.local`. Preserve the database,
endpoint, and TLS settings while replacing only the login and password. Pass
credentials through stdin or in memory; never put them in source, shell arguments,
logs, issues, or documentation. The Cloudflare timer does not need a database
credential.

## Permission guard

`npx tsx scripts/check-db-permissions.ts` authenticates with `POSTGRES_URL` and
checks catalog metadata without reading customer data or changing monitor state.
GitHub runs it before either reconciliation or scraping. It rejects an incorrect
login, administrative flags/memberships, excess table or column access, sequence
access, permanent schema/database creation, and accessible application
`SECURITY DEFINER` routines. A failure stops the job before notifications or state
writes; investigate the grants instead of substituting an owner credential.

PostgreSQL privileges inherited from `PUBLIC` are additive. This setup leaves
normal database temporary-object access and ordinary public function execution
unchanged. Do not revoke shared `PUBLIC` permissions to tighten this one login:
that could affect BonTCF. This is application-data privilege separation; the
monitor still shares database compute, storage, and billing with BonTCF.

## Rotation and verification

1. Coordinate rotation between completed runs, temporarily stopping new timer
   dispatches if necessary. Generate a new secret privately and use an
   administrative connection to change only this monitor login. Never rotate or
   revoke BonTCF's owner credential as part of monitor maintenance.
2. Authenticate as the new login and run the permission guard. Verify the real
   insert, upsert, and reconciliation operations with a unique synthetic key in
   one transaction that is rolled back. Confirm the test row does not remain.
3. Confirm a query against an unrelated application table is denied, using
   `WHERE false` so no customer data can be returned even if grants are wrong.
4. Update the encrypted GitHub secret and ignored local env value. Keep any
   temporary rollback material outside the repository with owner-only access;
   delete it after verification. Avoid cancelling a running notification job.
5. Verify successive scheduled GitHub runs authenticate as the scoped login,
   pass the guard, and complete all source checks. Check state freshness using a
   read-only query. Do not treat secret-update success alone as a healthy cutover.

## Initial cutover — October 7, 2026

At **05:23:48 UTC / 13:23:48 China time**, GitHub's encrypted `POSTGRES_URL` secret
and the ignored local `.env.local` were switched to the SQL-created login. The
local file is mode `0600`. BonTCF's owner password and shared grants were not
changed.

The new login passed an actual authentication check, had zero role memberships
and zero effective access to the other **71 application relations** and **41
sequences**, and was denied an unrelated-table query. Both upsert branches and
the reconciliation-style update passed in a deliberately aborted atomic
transaction; no synthetic row remained. The same permission guard accepted the
new login and rejected the old owner login. All **90 offline tests** and typecheck
passed.

| Scheduled run creation (UTC) | Run | Credential guard | Source checks |
| --- | --- | --- | --- |
| 05:26:06 | [37576283529](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/37576283529) | Scoped login verified; zero forbidden privileges | 10/11 passed. Toronto paper returned HTTP 202 HTML classified as a SiteGround challenge; its prior state was preserved. |
| 05:31:35 | [37576736775](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/37576736775) | Scoped login verified; zero forbidden privileges | 10/11 passed; the same Toronto paper challenge recurred and prior state was preserved. |
| 05:36:10 | [37577126084](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/37577126084) | Scoped login verified; zero forbidden privileges | 11/11 passed, including Toronto paper; overall success. |

This first run proves the encrypted GitHub secret uses the new login and normal
state writes work. Its overall failure was the previously observed Toronto
upstream challenge, not a database authentication or permission failure. A
read-only follow-up confirmed every other source refreshed its state and Toronto
paper retained its preceding snapshot.

All three scheduled cycles passed the credential guard, 90 tests, and typecheck.
The final cycle passed all 11 source checks, and a final read-only query confirmed
all 12 stored state rows refreshed during that cycle with no permission-probe rows
remaining. The temporary credential rollback copy was removed after verification.
The credential cutover is complete. The existing temporary follow-up monitor was
resumed at 15-minute intervals until three consecutive fully healthy scheduled
runs are observed; Toronto's later success is recovery evidence, not proof its
upstream challenge has been permanently repaired.

**Follow-up completion, October 7, 2026:** the 14:26, 14:31, and 14:36 China-time
scheduled runs each passed the scoped credential guard with zero forbidden
privileges and all 11 source checks. A read-only query confirmed all 12
availability/reminder rows were fresh; Toronto's separate health row showed
recovery and reset incident markers. The local Codex follow-up is now paused.
See the [Toronto verification record](scrapers/toronto.md) for the exact run links
and timestamps. The production timer and restricted database role remain active.

References: [Neon roles](https://neon.com/docs/manage/roles),
[PostgreSQL privileges](https://www.postgresql.org/docs/current/ddl-priv.html).
