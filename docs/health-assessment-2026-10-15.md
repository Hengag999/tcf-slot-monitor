# Failure email investigation — October 15, 2026

## Mail and production evidence

Native macOS Mail showed the latest failure email at **16:02 China time**, for
commit `80e1f27`, linking to run `38702711748`. A separate email was visible at
07:46. These were different failures; neither was a Toronto grace-policy alert.

| China time | Run | Actual source result |
| --- | --- | --- |
| October 15 16:01:19 | [38702711748](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/38702711748) | Ottawa examinations type 5 returned HTTP 500. Its entire prior snapshot was preserved; the other 11 sources passed. |
| October 15 16:06:00 | [38703261327](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/38703261327) | Next automatic run recovered all 12 sources; Ottawa returned six computer dates and one paper date. |
| October 15 07:45:57 | [38656065468](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/38656065468) | Calgary, Vancouver, Victoria, and Edmonton received connection refusals to a shared destination. Winnipeg also failed to fetch, without an exposed native cause. Toronto paper's known challenge stayed within grace and did not cause failure. |
| October 15 07:51:02 | [38656565132](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/38656565132) | Next automatic run recovered all 12 sources. |
| October 14 01:36:11 | [38439976905](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/38439976905) | Ashton alone had a connection timeout before parsing/diffing; this was not a per-date alert failure. |

Both October 15 failure runs passed **187 tests** and authenticated as
`tcf_slot_monitor`, with **zero forbidden privileges**. The shared connection
failures do not establish whether the fault was in the runner network or at the
remote host. The Winnipeg error cannot be assigned the same native cause.

The metadata window **October 14 16:00–October 15 16:01 China time** contained
**290 distinct workflow runs: 288 successes and two failures**. The first and
last were created at October 14 16:01:18 and October 15 16:01:19. Median creation
interval was five minutes; the maximum was 5m49s. One pair was only 26 seconds
apart (October 14 19:51:05 and 19:51:31); the `workflow_dispatch` event alone does
not establish whether that extra invocation was manual or timer-driven. No extra
production run was dispatched by this investigation.

A read-only transaction at **16:04:48.110 China time** found Ottawa's previous
six computer dates and one paper date still present, last checked at 15:56:29.
Every other availability/reminder row had refreshed during the 16:01 cycle.
Toronto's separate health metadata recorded a successful check with both incident
markers null. Health metadata was excluded from availability freshness.

A local standalone Ottawa probe separately hit a connection reset while reading
the API-key page. That local network result is not the production HTTP 500 and
does not negate the subsequent successful GitHub run. No local live pipeline or
manual state write was used.

## Scoped hardening

Ottawa previously failed its whole scrape on the first examinations HTTP 500.
Only Ottawa now opts into at most **three attempts** for examinations GET
responses with status **500, 502, 503, or 504**, waiting one second and then two
seconds. Each attempt receives a fresh 20-second timeout; discarded response
bodies are released. Retry diagnostics contain only source, type, status, and
attempt count.

Persistent errors still fail the workflow and preserve both Ottawa formats.
Authentication, rate limits, unknown server statuses, transport exceptions,
malformed content, and API-key discovery keep their existing immediate failure
behavior. Parsing occurs after the retry loop; a partial result cannot replace
the complete snapshot. Halifax and all other source policies are unchanged.
This is a bounded retry, not an alert grace period or an upstream repair.

All **191 offline tests**, typecheck, and whitespace checks pass. New checks cover
recovery, bounded exhaustion, full-snapshot rejection when one format fails,
fresh deadlines, response cleanup, immediate failure cases, and unchanged Halifax
behavior. The old error cannot prove that a same-run retry would have recovered;
only the next automatic run's recovery is observed live.

## Shipment and post-deployment verification

Commit `1d57bb8` shipped to master. Three consecutive normal timer cycles ran it:

| China time, October 15 | Run | Actual source outcomes |
| --- | --- | --- |
| 16:16:02 | [38704439426](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/38704439426) | All 12 OK; Ottawa seven dates, unchanged |
| 16:20:58 | [38705015549](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/38705015549) | All 12 OK; Ottawa seven dates, unchanged |
| 16:26:00 | [38705613372](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/38705613372) | Eleven OK, including Ottawa; Toronto paper recognized SiteGround HTTP 202 challenge, four minutes since success, within approved grace |

Each passed **191 tests**, typecheck, and the scoped database guard with **zero
forbidden privileges**. Creation intervals were 4m56s and 5m02s. No Ottawa retry
or Discord notification occurred in these runs. Thus the retry branch is covered
by regression tests, while normal production behavior is verified; it has not yet
been exercised by another observed live HTTP 500.

At **16:27:08.088 China time**, a final read-only transaction as
`tcf_slot_monitor` found Ottawa's six computer dates checked at
`08:26:27.612Z` and one paper date at `08:26:27.666Z`. All notification timestamps
were unchanged from the 16:04 baseline. Thirteen of fourteen availability/reminder
rows refreshed in the final cycle. Toronto paper appropriately retained its
`08:21:22.566Z` snapshot; separate health metadata recorded last success at
`08:21:22.593Z`, the first accepted degradation at `08:26:21.860Z`, and no
failure-reported marker. Its known upstream challenge is not permanently fixed.

This completes the post-deployment check. No credentials, grants, webhook
configuration, notification grace policy, or unrelated infrastructure changed.
