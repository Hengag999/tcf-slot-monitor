# October 22 — AEC origin timeouts

The latest 60 workflow records inspected at 11:23 China time contained five
failures, 54 successes and one cancellation. Detailed logs classify the failures:

| Run creation (China time) | Run | Failure |
| --- | --- | --- |
| 07:45:14 | [39695431339](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/39695431339) | Ashton transport `AggregateError ETIMEDOUT`; not a parser error |
| 10:35:15 | [39712203247](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/39712203247) | Ottawa public API-key page HTTP 522 |
| 11:10:13 | [39715363065](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/39715363065) | Halifax public API-key page HTTP 522 |
| 11:15:13 | [39715817305](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/39715817305) | Halifax public API-key page HTTP 522 |
| 11:20:13 | [39716263928](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/39716263928) | Halifax public API-key page HTTP 522 |

Ashton recovered on the next automatic run `39695961637` at 07:50:16 and remains
fresh. Ottawa later recovered; both its saved formats were fresh at 11:25.
The 11:25 run `39716725000` still failed Halifax. These are different from the
previous Winnipeg layout incidents. The recent source tables show other sources
passing, with the known Toronto paper challenge occasionally within its approved
grace period. Scoped credential checks passed with zero forbidden privileges.

The actual Halifax browser page displayed Cloudflare **522 Connection timed out**,
with browser/Cloudflare working and host error, timestamp 03:26:27 UTC. This is an
observed upstream origin failure, not evidence of changed availability markup.
Ottawa's browser page rendered the normal AEC shell after a slow navigation.
Standalone local Node requests to both hosts failed during TLS connection setup;
those local failures do not establish the cause or recovery of the CI failures.

## Scoped hardening

Halifax and Ottawa now opt into at most **three API-key-page GET attempts** only
for HTTP **522**, with one- and two-second delays and fresh 20-second deadlines.
Discarded response bodies are released. Other HTTP statuses, transport errors,
missing keys and malformed inventory still fail immediately. Exhausted 522
attempts fail the source and preserve state; no grace period or alert suppression
was added. No public API key is cached or pinned. Ottawa's existing examinations
API retries (500/502/503/504) and Halifax's single API request are unchanged.

All **203 offline tests**, typecheck and whitespace checks pass. Tests exercise
both configured city scrapers recovering after one/two 522 responses, exhaustion
at three attempts with no inventory call or partial return, fresh deadlines/body
cleanup, and non-retryable responses/errors before and after a 522.

A read-only transaction at **11:26:08.212 China time**, authenticated as
`tcf_slot_monitor`, confirmed Halifax retained its prior empty snapshot checked at
`2026-10-22T03:05:50.641Z`; its notification time remained
`2026-09-28T15:04:14.680Z`. The other 13 availability/reminder rows were current
in the 11:25 cycle. Health metadata was excluded. No production data was written
for diagnosis, no extra workflow was dispatched, and no credentials or grants
were changed.

Shipment and normal scheduled verification remain pending. This hardening cannot
repair the centre's origin server; successful retries/recovery must be observed
rather than inferred from tests.

## First production retry evidence and approved alert policy

Commit `b13fd3a` shipped the bounded retries. Automatic run
[39717653536](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/39717653536),
created **11:35:13 China time**, passed all 203 tests, typecheck and the scoped
guard with zero forbidden privileges. Halifax actually returned 522 on all three
attempts: retry warnings at `03:35:58.245Z` and `03:36:18.625Z`, then exhaustion
at `03:36:40.336Z`. The workflow correctly failed; the other 11 sources passed.
This observes the retry branch live but does not establish upstream recovery.

The user subsequently approved applying the one-hour grace / one-workflow-failure
per outage policy to **Halifax and Ottawa key-page HTTP 522 only**. A typed error
is emitted only after confirmed 522 exhaustion and matched to the configured
city's exact origin. Unknown errors, generic network exceptions, other HTTP
statuses, missing keys, examination API failures, invalid inventory, and
notification/database errors remain immediate. Dry runs never suppress failures
or access health state.

Health records are separate at `(__monitor_health__, halifax/aec-key-page)` and
`(__monitor_health__, ottawa/aec-key-page)`. They reuse the existing v1 one-hour
state machine; its legacy `firstChallengeAt` field means first confirmed 522 in
these rows. The baseline is the last complete persisted source snapshot; Ottawa
uses the older of both format timestamps, so a partial write cannot rearm an
incident. Missing baselines start an hour at the first observed 522. Malformed
or unreadable/unwritable health state fails immediately. The incident is persisted
before issuing or suppressing its failure. This records a workflow failure, not
proof GitHub delivered an email.

Actual complete scraping and successful notification/persistence reset the
incident; a Discord or availability-write failure cannot reset it. Source summaries
continue to display **DEGRADED** while stale state is preserved. A green job in
that state does not establish availability freshness. Explicit format scopes also
ensure successful empty AEC snapshots have freshness rows on a new installation.
No database grants, schema, credentials, or other-centre alert policies change.

All **212 tests**, typecheck and whitespace checks pass. The new policy tests
cover exact-hour boundaries, one failure until recovery, both centres, partial
Ottawa persistence, complete baseline recovery after a failed health write,
missing baselines, malformed/future timestamps, wrong error/origin/source,
dry-run isolation, other-centre failures, DB/Discord failures, and visible
source-summary degradation.

Policy shipment and scheduled verification remain pending.
