# November 4 afternoon — request resets

The user reported another failure ping after the nested Toronto repair.
The latest 20 workflow conclusions inspected contained **eight failures**:

| Runs (UTC creation, November 4) | Observed production failure |
| --- | --- |
| `41789817520` 07:05, `41790394391` 07:10, `41790978708` 07:15, `41791554028` 07:20 | Toronto computer list request exhausted existing retries with native `ECONNRESET` |
| `41793881309` 07:40 | Toronto computer list returned invalid response/pagination; raw response was not captured |
| `41794453350` 07:45, `41795028503` 07:50, `41796810287` 08:05 | North York request failed immediately with `errorNames=Error|TypeError; codes=ECONNRESET` |

All eight failed logs were read, separating production failures from deliberate
offline test output. The newest ping was North York, not a recurrence of the
nested-group error. Successful runs at 07:55 and 08:00 intervened. Toronto's
earlier resets and invalid envelope had recovered by the latest failed run;
their upstream cause has not been established and is not called permanently
repaired.

A scoped read-only check at **16:10:12.912 China time** confirmed North York's
151 Computer / 2 Paper snapshot was preserved from the 16:00 successful cycle.
Its notification timestamps were unchanged from the earlier check. The other
12 availability/reminder rows were fresh in the 16:05 cycle, excluding health
metadata. Toronto computer retained concrete November 6 activity 129591; its
notification timestamp was still `2026-11-04T04:55:39.370Z`. A public-only Toronto
scrape again returned that concrete sitting with seven openings.

## Narrow repair and diagnostic limit

North York now also retries the **observed request-stage `ECONNRESET`**, using
the existing maximum of three GET attempts, 1s/2s backoff and hostname-scoped
DNS fallback. There is no one-hour grace, incident suppression or blanket green
workflow for these failures. Exhaustion fails the current cycle. Native HTTPS
errors after response headers are explicitly body failures, so adding request
reset retries cannot accidentally replay an incomplete body. Default fetch body
decoding remains outside the retry loop. HTTP, TLS, DNS, unknown/mixed errors and
invalid inventory retain immediate failure and snapshot preservation.

Toronto's existing three request retries are unchanged. Its unknown JSON-envelope
failure now reports only a four-digit response code (otherwise `invalid`), item
count and bounded numeric pagination fields. No raw response, arbitrary text,
session information or credentials are logged. Unknown envelopes still fail
immediately; without the historical response there is no evidenced parser
exception or upstream repair to apply safely.

All **235 offline tests**, typecheck and whitespace checks pass. New regressions
cover reset recovery/exhaustion, unchanged invalid-response handling, a reset
after HTTPS headers remaining non-retryable, and safe structural diagnostics
without raw text or retries. No production state or Discord message was written
by checks; credentials, grants, schema, timer and other alert policies are
unchanged. Deployment and real automatic-cycle evidence follow.

## Deployment and initial observation

Commit `c7afbfc` shipped the reset recovery and structural diagnostics.

| Automatic run | Created (China time, November 4) | Verification | Actual outcomes |
| --- | --- | --- | --- |
| [41798078469](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/41798078469) | 16:15:15 | 235 tests, typecheck, scoped guard with zero forbidden privileges | All 12 sources OK; North York 153 schedules |
| [41798717255](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/41798717255) | 16:20:15 | 235 tests, typecheck, scoped guard with zero forbidden privileges | All 12 sources OK; North York 153 schedules |
| [41799359528](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/41799359528) | 16:25:15 | 235 tests, typecheck, scoped guard with zero forbidden privileges | All 12 sources OK; North York 153 schedules |

None of these runs needed North York reset recovery. These are initial healthy
observations, not evidence that the upstream resets are permanently repaired
or that the new recovery branch has been exercised by a real production failure.
The exact reset and body-error branches are covered by offline tests. The guards
verified `tcf_slot_monitor`, 89 other relations and 43 sequences.

The user's standing request for post-deployment monitoring is continuing through
a temporary in-chat follow-up, **`tcf-network-recovery-follow-up`**, created active
at 15-minute intervals. It inspects intervening runs, new failure logs, safe
diagnostics, all source outcomes and read-only state, remaining quiet for
unchanged/non-actionable findings. On the first check at or after **19:30 China
time / 11:30 UTC on November 4**, it will report the observed window and unresolved
limits once and delete itself. It must not manually dispatch production, write
health-check state, broaden policy, send synthetic notifications or alter
unrelated infrastructure. The production five-minute timer remains unchanged.
At **16:26:39.718 China time**, a final scoped read-only transaction confirmed
all **14 availability/reminder rows** were fresh in the 16:25 cycle, excluding
health metadata. North York retained **151 Computer + 2 Paper**, checked at
`08:25:48.330Z` / `08:25:48.396Z`. Its notification timestamps stayed at
`2026-11-03T21:15:51.551Z` / `2026-10-26T18:06:21.130Z`; no availability event was
consumed by a health check. Toronto computer still held its one concrete sitting,
with notification time unchanged since the earlier real November 6 alert.
Toronto paper and Halifax/Ottawa health records had current successes and clear
incident markers. Normal creation cadence across these three runs was five
minutes. The longer quiet watch remains active; these checks are not a promise
of permanent upstream network recovery.

## First real request-reset recovery — 17:25 China time

Automatic run [41807342658](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/41807342658),
created **17:25:15 China time** on `eb85e63`, encountered North York request-stage
`ECONNRESET`. Its existing bounded retry switched to the isolated DNS/HTTPS
client once, returned **153 valid schedules (151 Computer + 2 Paper)** and
completed with **all 12 sources OK**. The run passed 235 tests, typecheck and
the scoped guard with zero forbidden privileges. This is the first observed
real automatic production scrape exercising the new reset-recovery branch;
it is distinct from the earlier offline cases and public-only fallback probe.

The following 17:30 run
[41808029493](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/41808029493)
also passed all 12 sources with no retry. A scoped read-only check at
**17:33:45.102 China time** confirmed all 14 availability/reminder rows refreshed
in that cycle; North York retained 151 Computer + 2 Paper and unchanged
notification timestamps. Toronto's known paper challenge at 17:20 had recovered,
and all three existing health records had cleared incident markers. No failure
was suppressed by the North York recovery: the request completed successfully
within its retry budget. This verifies that one real reset recovered; it does
not establish a permanent repair of upstream networking. The quiet watch
continues to its scheduled deadline.

Further observed recovery: automatic run
[41809230545](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/41809230545),
created **17:40:18 China time**, encountered another North York `ECONNRESET`
and recovered on its first isolated-DNS retry. All twelve sources, 235 tests,
typecheck and the scoped guard passed. The 17:35 and 17:45 cycles also passed
all twelve sources. At **17:49:10.734**, a scoped read-only check confirmed all
14 availability/reminder rows fresh in the 17:45 cycle, with Toronto/North York
notification timestamps unchanged and all incident markers clear. This is a
second recovered request, not a new outage or proof that resets have stopped.

The **17:55:16** and **18:00:18** automatic runs
[41810744276](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/41810744276)
and [41811273171](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/41811273171)
each encountered North York `ECONNREFUSED` and recovered on the first isolated-DNS
retry. Both passed all twelve sources, 235 tests, typecheck and the scoped guard.
These exercise the previously supported refusal fallback rather than the newly
added reset classification. Toronto paper's accepted challenge at 17:50 cleared
by 17:55. A read-only check at **18:03:25.698** found all 14 state rows refreshed
in the 18:00 cycle, unchanged Toronto/North York notification timestamps and
cleared incident markers. These are two more recovered requests; no workflow
failure was suppressed and no upstream networking repair is inferred.

At **18:15:17**, automatic run
[41812946112](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/41812946112)
encountered North York `UND_ERR_CONNECT_TIMEOUT`, recovered on its first
isolated-DNS retry, and passed all twelve sources, 235 tests, typecheck and the
scoped guard. The 18:05 cycle also passed all twelve sources. A read-only check
at **18:18:34.569** confirmed all 14 state rows refreshed in the 18:15 cycle,
with unchanged Toronto/North York notification timestamps and cleared health
markers. This adds a real recovered timeout to the observed resets/refusals.

The **18:10:24** automatic run
[41812402335](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/41812402335)
was still queued at that check despite the later 18:15 cycle completing. It is
not counted as a passed source check, and was neither cancelled nor rerun.
Production state remains fresh from the later automatic run. Track this queued
run separately if it falls outside the next recent-run listing.

## Provider cadence degradation — 19:19 China time

Automatic run [41818503101](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/41818503101),
created **19:05:17 China time**, passed all twelve sources, 235 tests, typecheck
and the scoped guard with zero forbidden privileges. A read-only check at
**19:18:15.663** confirmed all 14 availability/reminder rows refreshed in that
cycle, unchanged Toronto/North York notification timestamps and clear health
incident markers. The accepted Toronto paper challenge at 18:55 had recovered.

Actual workflow creation cadence has slowed: no 19:00, 19:10 or 19:15 cycles
were listed at this check, and the older 18:10 run remained queued. This is a
coverage delay despite healthy completed scrapes. GitHub's [official status
API](https://www.githubstatus.com/api/v2/summary.json) reported Actions degraded
performance; its active [incident](https://stspg.io/18blsgwnbyy6) reported elevated
errors and delayed requests, with an API degradation update at 11:11:30 UTC and
an ongoing mitigation update at 11:17:52 UTC. This is consistent with the observed
delays; it does not independently prove which missing dispatches GitHub accepted.

The read-only Cloudflare dashboard inspection required a fresh sign-in, so
per-invocation dispatch receipts could not be verified. The agent-created browser
space was closed without changing settings. No production run was dispatched,
cancelled or rerun. Existing timer, snapshots and alert policies remain intact;
the temporary follow-up continues to its existing 19:30 deadline. Provider delay
is separate from a scraper regression and must be disclosed if still unresolved
at completion.

## Follow-up completed — November 4, 19:33 China time

The bounded observation window covered **16:15:15–19:30:15 China time**.
GitHub listed **37 automatic runs: 36 successful conclusions and one still
queued**, with no failed conclusions. Of the completed cycles, **31 passed all
twelve sources**; five reported the recognized Toronto paper challenge within
its approved grace, preserving its snapshot while the other eleven sources
passed. Those challenge cycles were 16:30, 17:20, 17:50, 18:45 and 18:55.
All completed cycles passed 235 tests, typecheck and the scoped database guard
with zero forbidden privileges. No unchanged offline suite was rerun locally.

The final three completed automatic cycles were:

| Run | Created (China time) | Actual source outcomes |
| --- | --- | --- |
| [41820074732](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/41820074732) | 19:20:16 | All 12 OK; North York recovered `ECONNREFUSED` on its first isolated-DNS retry |
| [41820707277](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/41820707277) | 19:25:15 | All 12 OK; no request retry |
| [41821395435](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/41821395435) | 19:30:15 | All 12 OK; no request retry |

Across the window, **six real North York requests recovered on their first
retry: two resets, three refusals and one connection timeout**. The 19:20 refusal
adds to the five documented above. These are actual bounded recovery observations,
not proof that upstream network faults have stopped. Exhaustion and all ineligible
errors retain their existing failure behavior; no email suppression was added.

At **19:33:21.774**, a scoped read-only transaction confirmed all **14**
availability/reminder rows refreshed in the 19:30 cycle, with `checked_at` between
`11:30:39.031Z` and `11:30:54.437Z`. North York retained 151 Computer + 2 Paper;
Toronto retained one concrete computer sitting and zero paper slots. Their
notification timestamps stayed unchanged throughout the watch. Toronto paper
and both AEC health records had current successes and clear incident markers.
The guard inspected 89 other relations and 43 sequences, with zero forbidden
privileges. Health metadata was excluded from availability freshness.

**Remaining limitation:** the observed creation gaps were ten minutes from
18:55 to 19:05 and fifteen minutes from 19:05 to 19:20; 18:10 run `41812402335`
was still queued at the final check. The last three creation intervals returned
to five minutes, but GitHub's official status still reported Actions degradation
at `11:30:42.315Z`. Cloudflare per-invocation receipts remain unverified because
the dashboard requires sign-in. A recovered cadence and healthy scrapes are not
proof of a resolved provider incident. Production execution still uses GitHub
Actions; migration away from it remains pending.

The app confirmed deletion of **`tcf-network-recovery-follow-up`** after this
deadline check (`deleteStatus=deleted`). This ends only the temporary local
follow-up. The production timer, workflow, snapshots, database grants and
existing alert policies were preserved. No manual production dispatch, live
local pipeline, synthetic Discord message or production-state health-check write
was performed.
