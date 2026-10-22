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

Initial retry shipment and production evidence are recorded below. This hardening cannot
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

The initial 522-only policy was deployed as `e434b92`; its later 521 result and
user-approved extension are recorded below.

## Confirmed HTTP 521 and approved shared origin-outage policy

The first 522-policy run on `e434b92`,
[39718571709](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/39718571709),
created **11:45:13 China time**, passed 212 tests and the scoped guard but failed
Halifax on a newly observed **HTTP 521**. The 522-only policy correctly did not
suppress it. Cloudflare documents 521 as an origin refusing its connections;
this does not establish whether this origin's cause is an offline process or a
firewall. The user explicitly approved extending the same grace/one-alert policy
to **521 and 522 together**, with one continuous incident across status changes.

The final typed origin error admits only exhausted key-page 521/522 from the
configured centre origin. Both statuses receive the same bounded retries and
share the existing health key and hour baseline; alternating them never resets
the clock or creates another alert. Every other failure remains immediate.
The current policy is this approved 521/522 scope, superseding the initial
522-only scope described above. All **213 tests**, typecheck and whitespace checks
pass, including mixed-status retries and one incident across alternating errors.
A local Node 22 test-worker IPC deserialization error occurred once; the focused
file passed, and reducing expected synthetic console output resolved the full
suite. CI's actual Node 20 result still needs production verification.

Reference: [Cloudflare HTTP 521](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-521/).


## Final-policy production observation and continuing follow-up

Commit `a569c75` shipped the combined 521/522 policy. Automatic run
[39719473973](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/39719473973),
created **11:55:11 China time**, selected that revision. The completed job and
all execution steps succeeded, including offline tests, typecheck, the scoped
credential guard and scraping. The full text log was unavailable at this check
because repeated GitHub log downloads returned EOF; the successful job/step
metadata and read-only production state were inspected independently. This is
not being counted as all 12 sources actually healthy.

At **11:57:38.259 China time**, a read-only transaction as `tcf_slot_monitor`
confirmed Halifax still held its last successful empty snapshot at
`2026-10-22T03:05:50.641Z`, with unchanged
`notified_at=2026-09-28T15:04:14.680Z`. The separate `halifax/aec-key-page`
health row held the same last success, first observed approved outage at
`2026-10-22T03:55:39.004Z`, and `failureReportedAt=null` — inside the approved
hour. It did not reset the baseline to deployment time. Ottawa health showed
actual complete success at `03:55:39.574Z`, with incident markers null. All
other 13 availability/reminder rows refreshed during the 11:55 cycle.

| Centre | Current evidence at the read-only check |
| --- | --- |
| Toronto | Both format snapshots fresh; paper health records success |
| Calgary | Fresh successful empty snapshot |
| Vancouver | Fresh 97-row reminder state |
| Halifax | **DEGRADED upstream origin outage**; snapshot preserved, grace active |
| Ottawa | Fresh four computer and two paper slots; successful health reset |
| Ashton | Fresh empty state after earlier isolated transport recovery |
| North York | Fresh 138 computer and two paper schedules |
| Victoria | Fresh 21-row reminder state |
| Edmonton | Fresh empty availability and 30-row reminder state |
| Winnipeg | Fresh empty published-availability state |

These are processing/freshness observations, not a new independent completeness
audit of every booking platform.

The one-hour threshold remains **12:05:50.641 China time** unless an actual
successful Halifax check occurs first. The first qualifying automatic cycle may
be 12:05 or 12:10 depending on when its source check finishes. The exact live
threshold failure and following repeat suppression are **not yet verified**;
regression tests cover those transitions. A green grace run is alert control,
not a repair to Halifax's origin.

The previous temporary automation no longer existed. A new **15-minute**
`tcf-aec-outage-recovery` thread follow-up is active. It checks the threshold,
subsequent suppression, scoped guard and all source outcomes using read-only
state. It stays quiet for unchanged outages and will pause after three truly
healthy automatic cycles with fresh state. If the continuous outage reaches
24 hours since last actual success, it will notify once that the upstream
operator must act and pause the local follow-up, leaving production monitoring
and snapshots intact. Actual upstream recovery is still pending.
