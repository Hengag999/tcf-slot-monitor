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
