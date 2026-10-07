# Cloudflare timer for TCF Slot Monitor

This small Worker calls the existing GitHub `workflow_dispatch` endpoint every five minutes. GitHub still runs the scraper and holds the database and Discord secrets. The only Worker secret is `GITHUB_TOKEN`, a fine-grained token restricted to `Hengag999/tcf-slot-monitor` with **Actions: Read and write** (plus mandatory Metadata read access).

## Configuration

- Worker: `tcf-monitor-trigger`
- Source: `index.mjs` (plain module JavaScript, suitable for the Cloudflare dashboard editor)
- Cron: `*/5 * * * *` (UTC; an interval schedule independent of timezone)
- Target: `Hengag999/tcf-slot-monitor`, `.github/workflows/monitor.yml`, `master`
- Secret: `GITHUB_TOKEN`; never place its value in source, a plaintext variable, or this repository
- HTTP routes, `workers.dev`, and preview URLs: disabled. The defensive HTTP handler also returns 404.
- Logs: enabled. Logs contain event timestamps and status codes, never tokens or GitHub response bodies.
- GitHub API: `2026-03-10`; accepts HTTP 200 or 204. A numeric workflow run ID from a 200 receipt is logged when available. Receiving a run ID still does not establish that the run succeeded.

The included `wrangler.jsonc` records the same settings for reproducible deployment. No Wrangler dependency is needed by the scraper. Dashboard deployment must preserve these settings and use a Secret binding.

## Initial setup and cutover

1. Create the repository-scoped GitHub token, set an appropriate expiration, and record its expiration date in the deployment evidence below. Create the Worker on the existing Free plan; do not upgrade the account or connect unrelated resources.
2. Deploy `index.mjs`, set `GITHUB_TOKEN` as a Secret, disable public/preview URLs, and configure the cron. Initial cron propagation can take up to 15 minutes.
3. Check Worker logs for `dispatch_accepted`, then check the corresponding GitHub Actions run for its final conclusion and source health summary. Acceptance alone does not prove a successful monitor run or Discord delivery.
4. After two consecutive scheduled invocations and successful GitHub runs are verified, remove only the old native `schedule:` block from `.github/workflows/monitor.yml`. Retain `workflow_dispatch`, recovery input, concurrency, permissions, and job configuration. Verify at least three consecutive five-minute Cloudflare-triggered runs after cutover, each using the pushed commit and passing all 11 source checks. Correlate Worker receipt IDs with GitHub runs and check the Worker's CPU usage and invocation outcomes.

The timer makes one request, with a 10-second bound covering headers and any run receipt body, per fresh event. Events more than five minutes old are skipped. The handler calls Cloudflare's `controller.noRetry()` before doing work and never retries requests itself, including rejected or ambiguous requests. Existing GitHub concurrency prevents two monitor runs executing together. The timer is stateless: it does not promise exactly-once dispatch if the platform duplicates an event. GitHub runner availability can still delay execution.

## Cost and operations

At five-minute intervals the Worker receives 288 scheduled invocations per day, each making one GitHub API request and using no Cloudflare database/storage product. This is designed for Workers Free limits. GitHub execution and Neon usage remain governed by their existing plans; the timer does not cap those providers' charges.

Monitor for `dispatch_rejected` (including expired/revoked tokens) and `dispatch_unconfirmed`. Use GitHub Actions for scraper failures. To rotate credentials, create another token with the same single-repository scope, update the Worker Secret, verify a scheduled run, then revoke the old token. Do not broaden token permissions to fix a transient failure.

The deployed token expires **January 5, 2027**. Renew it before that date. If dispatch fails, no GitHub run is created, so GitHub workflow-failure emails cannot report that timer outage; inspect Cloudflare invocation logs as well as GitHub run freshness.

## Rollback

1. Remove the Worker's cron trigger to stop new external dispatches. Do not cancel an in-flight GitHub run during notification delivery.
2. Restore the native GitHub schedule:

   ```yaml
   schedule:
     - cron: '2-57/5 * * * *'
   ```

3. Confirm the GitHub workflow remains enabled. Native schedule timing is best-effort and previously had multi-hour gaps.
4. If retiring the timer permanently, revoke its dedicated GitHub token and delete the Worker after any active run finishes.

## Verification

Offline checks: `node --import tsx --test tests/external-timer.test.ts` and `npm run typecheck` from repository root. Tests mock all outbound dispatch calls and do not contact GitHub or alter state.

Deployment evidence is recorded here after live cutover. Local files and passing tests alone do not establish a live timer.

- Cloudflare Worker: [tcf-monitor-trigger](https://dash.cloudflare.com/ae53d8cb0820026e009bfcfc6c2b9a05/workers/services/view/tcf-monitor-trigger/production); Workers Free, compatibility date `2026-10-07`, corrected source version `221fb3c9`. Deployed source was checked against `index.mjs` exactly. Production and preview URLs are disabled; `GITHUB_TOKEN` is an encrypted Secret.
- Token expiration: **2027-01-05**. Fine-grained token `tcf-monitor-cloudflare-timer`, limited to this repository, Actions read/write and mandatory Metadata read-only; no account permissions.
- Cron saved: **2026-10-07 04:22 UTC / 12:22 China time**. The old native schedule was retained through the initial verification and failure investigation.
- Startup correction: the first observed scheduled invocation at **04:31:30 UTC** failed before dispatch. `workerd` rejects `redirect: "error"`, despite the Request documentation listing it. A credential-free local `workerd 2026-10-07` reproduction confirmed the exception and the `manual` correction. Version `221fb3c9` uses `manual` and rejects every non-200/204 response without following redirects. All **80 tests** and typecheck passed; the deployed source matches commit `fbe4d84`.
- First corrected scheduled invocation: **04:36:10 UTC / 12:36:10 China time**, HTTP 200 receipt `workflowRunId=37572248671`, matching [successful GitHub run](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/37572248671). All 80 tests, typecheck, and all 11 live source checks passed. Worker outcome `ok`, CPU **1 ms**, wall time **1,272 ms**. This is an observed invocation, not a permanent resource-use guarantee.
- The next dispatch at **04:41:17 UTC** was accepted and matched [run 37572653129](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/37572653129), **307 seconds** after the first. That run exposed the pre-existing intermittent Toronto paper CM HTTP 202 HTML response after three attempts; the other ten sources succeeded and paper state was preserved. Safe response classification diagnostics shipped in `b32b644`; this improves diagnosis, not upstream availability. The cause of the intermittent response remains unconfirmed.
- Subsequent runs at [04:46:22 UTC](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/37573059437) and [04:51:20 UTC](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/37573454805) both passed all 11 live source checks. Cloudflare HTTP 200 receipts matched both run IDs. The latter ran the updated diagnostics and passed **83 tests** plus typecheck. These two consecutive healthy runs satisfied the pre-cutover check.
- Native `schedule:` removal is shipped with this README update. `workflow_dispatch`, recovery input, concurrency, permissions, and job configuration remain intact. Three post-cutover cycles are still being observed.

Official references: [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/), [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [GitHub workflow dispatch API](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event).
