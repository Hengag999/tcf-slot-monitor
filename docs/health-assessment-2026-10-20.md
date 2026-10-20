# October 20 — Winnipeg release-only announcement

The latest 700 workflow records inspected at 11:17 China time included 105
consecutive failures following successful run
[39303086950](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/39303086950),
created October 20 **02:30:34 China time**. The first failure,
[39303775617](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/39303775617),
created **02:35:32**, and the recent **11:15:25** run
[39363327875](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/39363327875)
both report Winnipeg's `Next sessions boundary missing or unrecognized
availability list; state must be preserved`. The latest run passed the other
11 sources and the restricted credential guard with zero forbidden privileges.
The 105 count describes workflow conclusions; the endpoint logs establish the
same Winnipeg error. A middle sample, run `39338255537` created 06:55:26
China time, reports that same failure; Toronto paper was within its approved
challenge grace and other sources passed. Every intervening log was not
inspected. Creation intervals across these 105 failed runs were 295–303 seconds.

The official TCF Canada page was inspected in the browser. Its bounded
`Next sessions` card contains the duplicate-registration warning, blank
`New dates:` heading, and **New dates will be announced on Friday, October 23rd
at 5:00pm**, then the existing refund disclaimer and same-origin registration
link. It lists no exam dates, no positive availability banner, and no remaining
counts. The notice does not state a year or timezone. No registration was
submitted. A minimal public-section fixture captures this observed shape.

The repair recognizes this complete announcement-only card, with a valid
month/day and 12-hour clock, as **no currently published sessions**. It matches
the entire card, retaining context, link, hidden-content and unknown-state
checks. Blank lists, incomplete/unknown announcements, conflicting availability,
extra dates, malformed dates/times, changed links and missing disclaimer still
throw. The release notice never becomes an exam sitting, inferred year or
reminder epoch. Prior positive/date/count/full/closed variants retain coverage.

All **200 offline tests**, typecheck and whitespace checks pass. New tests cover
the captured empty listing and negative contextual/date/time variants.

A read-only transaction at **11:19:25.524 China time** authenticated as
`tcf_slot_monitor`. Winnipeg already held an empty snapshot from
`2026-10-19T18:31:07.513Z`, with `notified_at=2026-10-10T16:56:49.972Z`.
The failure froze its freshness timestamp; it did not erase positive slots.
All other 13 availability/reminder rows were current in the 11:15 cycle.
No credentials, database permissions, notification policy or unrelated
infrastructure were changed.

Commit `b01bc49` shipped the repair after the 11:20 cycle selected old revision
`8612dac`; that cycle's failure is not a failure of the repair.

## Production verification — October 20, China time

Three consecutive automatic runs on `b01bc49` passed all **200 tests**,
typecheck, and the scoped database guard with **zero forbidden privileges**
(84 other relations and 43 sequences inspected). Winnipeg reported **0 → 0**
and source OK in every run, without a Discord send.

| Run | Created | Source outcomes |
| --- | --- | --- |
| [39364207818](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/39364207818) | 11:25:25 | All 12 sources OK |
| [39364646480](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/39364646480) | 11:30:26 | Eleven OK; Toronto paper's recognized SiteGround challenge within approved one-hour grace; state preserved |
| [39365095262](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/39365095262) | 11:35:26 | All 12 sources OK |

The normal timer intervals were **5 minutes 1 second** and **5 minutes**.
No additional production run was dispatched, and the live pipeline was not
run locally. GitHub metadata/log downloads intermittently returned EOF and were
retried; the actual source logs above were ultimately retrieved and inspected.
Toronto paper's third-run success is recovery evidence, not proof its upstream
challenge is permanently fixed.

A final read-only transaction at **11:36:39.022 China time** authenticated as
`tcf_slot_monitor`. All **14 availability/reminder rows**, excluding health
metadata, refreshed during the final cycle between `03:35:43.144Z` and
`03:35:56.324Z`. Winnipeg held `[]`, with
`checked_at=2026-10-20T03:35:56.324Z` and unchanged
`notified_at=2026-10-10T16:56:49.972Z`. Toronto paper's separate health record
showed actual success at `2026-10-20T03:35:43.642Z`, with both incident markers
null. All sources are currently processing successfully; quiet channels are
not being classified solely by notification age.

The repair's three-cycle steady-state verification is complete. The monitor
will continue to fail on unknown content and preserve the prior snapshot;
this is a repair of the observed release-only layout, not a promise that the
centre will never change its website again.

The captured browser section passed the offline scraper test. Local Node/curl
GETs encountered TLS connection interruptions, and a browser background fetch
also failed; those calls do not establish HTTP recovery. The first normal
GitHub run subsequently verified the actual public GET and source processing.
