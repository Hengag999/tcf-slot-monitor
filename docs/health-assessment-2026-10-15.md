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
**290 automatic runs: 288 successes and two failures**. Median creation interval
was five minutes; the maximum was 5m49s. No extra production run was dispatched.

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

Production shipment and post-deployment verification are pending.
