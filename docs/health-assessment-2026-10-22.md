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
