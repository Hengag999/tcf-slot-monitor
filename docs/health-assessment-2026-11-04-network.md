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
