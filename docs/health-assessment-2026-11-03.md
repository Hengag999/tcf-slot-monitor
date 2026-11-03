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
in the inspected window were normally five minutes apart (minimum 298 seconds),
with one ten-minute gap from **13:00:07 to 13:10:07 China time**. The GitHub run
list does not establish the cause of that missing cycle or guarantee future
cadence. No manual health-check dispatch was issued.

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
Deployment and subsequent investigation are recorded below.

## Initial deployment observations — investigation remains open

`03d1dfb` shipped the bounded retry repair. The 17:45:07 automatic run
[41613558170](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/41613558170)
passed 220 tests, typecheck and the scoped guard, but North York exhausted two
connection timeouts followed by a connection refusal. The workflow correctly
failed while the other eleven sources succeeded. Thus retries alone have not
established recovery. At 17:50:07,
[41614229388](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/41614229388)
passed all 12 sources with 106 North York records and no retry; the intermittent
pattern persists.

The earlier failed connections used `74.220.199.6`. During investigation, Google
and Cloudflare recursive DNS and **both domain-authoritative nameservers**
(`ns1.bluehost.com`, `ns2.bluehost.com`) returned `209.38.8.99` for `api.gblc.ca`.
This discrepancy warrants runner-side investigation; it does not by itself prove
which component returned the earlier address. Local DNS is mediated by the
user's proxy, so its synthetic `198.18.*` answers are not evidence about GitHub.
The official booking page rendered 106 TCF Canada cards and loaded the same
`api.gblc.ca/candidates/test-schedules/` endpoint. No booking was selected or
submitted.

Commits `b366aed` / `0c6c9b9` add a read-only CI DNS comparison: runner recursive
DNS, OS lookup, Google and Cloudflare public recursive answers. These requests
carry no secrets, are bounded, and never alter DNS/hosts settings or affect the
real scraper's success/failure decision.

## Confirmed DNS inconsistency and targeted fallback

Automatic run [41614903078](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/41614903078),
created **17:55:07 China time** on `0c6c9b9`, confirmed different public answers
from the same runner at 17:55:38:

| Lookup | API IPv4 answer |
| --- | --- |
| Runner recursive resolver | `209.38.8.99` |
| Runner OS lookup | `209.38.8.99` |
| Google public resolver | `209.38.8.99` |
| Cloudflare public resolver | `74.220.199.6` |

The normal request succeeded with 106 records and all 12 sources passed. Combined
with earlier connection-refusal logs to `74.220.199.6`, this is direct evidence
of inconsistent DNS answers that explains at least the refused connections.
The destination of every earlier timeout was not logged, so those cannot all
be conclusively assigned to that address. The centre's authoritative DNS and
public caches have not been repaired by this repository.

The final repair retains ordinary system resolution for the first GET. After
either approved connection-establishment failure, attempts two/three use an
**isolated Google DNS resolver for `api.gblc.ca` only**, then Node HTTPS with
the original hostname, normal hostname/SNI certificate verification explicitly
enabled, no shared pooled agent, and the same exact public schedule path/query.
There is no pinned destination IP, global resolver/hosts edit, TLS bypass,
alternate API, or request with credentials. DNS queries have a 2-second,
single-query bound; each full HTTPS attempt keeps the 30-second abort deadline.
The fallback rejects incomplete or oversized bodies, never follows redirects,
and still runs the existing complete-inventory parser. HTTP/TLS/DNS/unknown
failures remain immediate; three eligible connection failures still fail the
workflow and preserve state. No grace or repeat-email suppression was added.

All **225 tests** and typecheck pass. Additional tests cover lookup target scope,
both Node callback forms, invalid DNS results, original HTTPS identity and
certificate settings, no redirect following, broken/oversized responses and
fallback activation only after the approved connection failures. A public-only
GET through the actual fallback, with real certificate verification, returned
the same **104 Computer + 2 Paper** valid records. Final deployment and normal
automatic-cycle verification follows.

## Final repair deployment verification

Commit `c47f8c3` shipped the isolated fallback. First normal run
[41616984159](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/41616984159),
created **18:10:07 China time**, passed **225 tests**, typecheck and the scoped
guard with zero forbidden privileges (89 other relations / 43 sequences).
North York succeeded with **104 Computer + 2 Paper**, and eleven sources were
actually OK. Toronto paper returned its recognized challenge within approved
grace, preserving its snapshot; this was not a new workflow failure. The runner
and Google resolved `209.38.8.99`, while Cloudflare still returned `74.220.199.6`.
The initial GET succeeded, so this run did not exercise the fallback branch.

A scoped **read-only check at 18:12:03.362 China time** confirmed both North York
rows had refreshed (`10:10:40.847Z` / `10:10:40.914Z`) with counts 104 / 2 and
unchanged notification timestamps from the initial check. No duplicate
notification was consumed. The remaining automatic-cycle evidence follows.

Second normal run
[41617688592](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/41617688592),
created **18:15:07 China time**, again passed 225 tests, typecheck, the scoped
guard with zero forbidden privileges and all eleven non-paper sources. Toronto
paper remained explicitly within its approved challenge grace. North York's
first GET succeeded with the same 106 records; the fallback was not needed.
DNS diagnostics again showed runner/OS/Google `209.38.8.99` and Cloudflare
`74.220.199.6`.

Commit `b997391` adds a temporary **public-only fallback probe** to the existing
diagnostic step, so the next automatic runner can verify the native HTTPS client
with the isolated resolver even if its ordinary source GET succeeds. This probe
has no DB/Discord imports or credentials and does not change production state.
It is distinct from an actual production scrape recovering after failure; its
result is recorded below. The temporary diagnostic/probe was removed after
verification.

The four Oncord sites' current Google A records all matched `163.52.34.11`, the
address in the one earlier shared connection-refusal incident. No matching DNS
discrepancy was established there, and subsequent source checks recovered; the
North York resolver change is not applied to those sources.

## Completed verification — 18:21 China time

| Automatic run / revision | Created (China time) | Actual source outcome | North York |
| --- | --- | --- | --- |
| [41616984159](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/41616984159) / `c47f8c3` | 18:10:07 | Eleven OK; Toronto paper in approved grace | 104 Computer + 2 Paper; first GET succeeded |
| [41617688592](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/41617688592) / `c47f8c3` | 18:15:07 | Eleven OK; Toronto paper in approved grace | Same inventory; first GET succeeded |
| [41618392245](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/41618392245) / `b997391` | 18:20:07 | **All 12 OK**, including Toronto paper | Same inventory; first GET succeeded |

Each normal workflow passed **225 tests**, typecheck and the scoped
`tcf_slot_monitor` guard with **zero forbidden privileges**. Creation intervals
were five minutes. The temporary public-only fallback probe in the final run
returned **HTTP 200, 106 records (104 Computer / 2 Paper)** at
`2026-11-03T10:20:30.310Z`. Thus the actual fallback HTTPS/DNS client was exercised
successfully on GitHub with normal certificate verification. This was a
read-only probe; none of these three production scrape requests required the
fallback, so an automatic scrape recovering through that branch has **not** yet
been observed. This distinction limits the live recovery claim.

A final scoped **read-only transaction at 18:21:37.567 China time** confirmed
all **14 availability/reminder rows** were refreshed during the 18:20 cycle,
excluding health metadata. North York had 104 Computer and 2 Paper records,
checked at `10:20:41.511Z` / `10:20:41.583Z`. Its notification timestamps remained
`2026-11-03T00:00:38.493Z` and `2026-10-26T18:06:21.130Z`, unchanged from the
initial check; all three production logs had no North York notification send.
Toronto paper, Halifax and Ottawa health records all had current successful
checks with cleared incident markers. Toronto's recovery is an observation,
not a permanent repair of its intermittent challenge.

The temporary DNS diagnostic and public probe are removed from CI after this
verification; production retains only the bounded, hostname-scoped fallback and
regression tests. No further production probe or dispatch was requested, no
local follow-up automation was created, and no DB/Discord state was written by
the checks. The monitor is currently healthy; upstream DNS inconsistency may
persist, and exhausted or ineligible failures will still alert normally.
