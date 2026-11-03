# November 3 — North York connection failures

## Diagnosis

The 100 automatic runs inspected span **09:15:07–17:35:07 China time** on
November 3 (01:15:07–09:35:07 UTC), all on `0277644`. There were **81 successful
and 19 failed workflows**. All 19 failed production logs were read, separating
the real monitor step from offline tests that deliberately print mock failures.

- **18 failures** were North York schedule GET connection failures: 12
  `ECONNREFUSED`, six `UND_ERR_CONNECT_TIMEOUT`. The scraper made only one
  attempt. These are transport failures, not malformed inventory or authentication
  failures. Example: [41612205038](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/41612205038)
  at 17:35:07. Successful cycles between failures demonstrate intermittency,
  without establishing the upstream cause or proving a permanent recovery.
- One run, [41598382319](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/41598382319)
  at 15:45:07, failed Calgary, Vancouver, Victoria, both Edmonton sources and
  Winnipeg public requests. The first five logged connection refusal to the
  same address; Winnipeg deliberately emitted a sanitized transport failure.
  No failing page content was captured, so no parser change is justified.
  All six sources subsequently succeeded, including in
  [41611521765](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/41611521765)
  at 17:30:07, when all 12 sources passed.
- Existing Toronto paper recognized challenges appeared within approved grace
  on some cycles and did not cause these workflow failures. No new suppression
  policy is being introduced for North York or other sources.

The 17:30 comparison run and latest failed run both passed 216 tests, typecheck
and the scoped `tcf_slot_monitor` database guard with **zero forbidden privileges**
(89 other relations and 43 sequences inspected). Timer dispatch creation times
in the inspected window remained five minutes apart, with small second-level
jitter. No manual health-check dispatch was issued.

## Live source and read-only state

Two local public-source-only GETs returned **106 valid TCF Canada records**:
104 Computer and 2 Paper. The complete array still satisfies the existing strict
identity, format, date/time and positive-seat checks. These observations verify
the current successful response, not GitHub runner connectivity.

A **read-only transaction at 17:38:38.502 China time** authenticated as
`tcf_slot_monitor`. Both North York rows retained their successful 17:30 snapshot:
104 Computer, 2 Paper, checked at `09:30:42.217Z` / `09:30:42.250Z`.
Notification timestamps remained `2026-11-03T00:00:38.493Z` for Computer and
`2026-10-26T18:06:21.130Z` for Paper. Thus the 17:35 failure preserved both
formats instead of clearing them. The other 12 availability/reminder rows were
fresh in the 17:35 cycle, excluding all `__monitor_health__` rows. Toronto paper,
Halifax and Ottawa had current successful checks with cleared incident markers.

## Repair and boundaries

North York now retries **only connection establishment `ECONNREFUSED` and
`UND_ERR_CONNECT_TIMEOUT`**, at most three GET attempts, with 1-second then
2-second backoff and a fresh 30-second deadline per attempt. No request body,
registration, payment, alternate endpoint, IP override or challenge workaround
is involved. Unknown/mixed error trees, TLS/DNS errors and all HTTP responses
retain immediate failure; parsing and body-read failures are never retried.
Diagnostics use fixed classifications and never include raw transport messages.

After three eligible failures, North York still fails the current workflow and
preserves both snapshots. This is bounded within-run resilience, not an hourly
grace or suppression policy, and cannot repair an upstream server or guarantee
fewer emails. Existing per-date notification and delivery-before-persistence
rules are unchanged. Other sources, database grants, credentials, schema and
infrastructure are unchanged.

**220 offline tests**, typecheck and a repaired standalone public-source check
passed. New tests cover same-run recovery, bounded exhaustion as a real
orchestration failure without state/Discord access, fresh deadlines, immediate
HTTP/TLS/DNS/unknown/body failures, and strict inventory validation after retry.
Production deployment and automatic-run evidence will be appended below.
