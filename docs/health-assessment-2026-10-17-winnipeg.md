# Winnipeg availability annotations — October 17, 2026

The late-evening emails correspond to runs
[39046819153](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/39046819153)
at **23:50:33 China time** and
[39047173585](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/39047173585)
at **23:55:32**. Both failed Winnipeg with `unrecognized session date; state must
be preserved`. Toronto's computer repair continued to pass, as did the other
sources and the scoped database guard with zero forbidden privileges.

The official page now adds availability annotations to its paragraph dates:
November 19, 23, 27 and December 1, 2, 4 are **Sold Out**; November 24 has **1 spot
available**, and November 25 has **4 spots available**. Years remain absent. The
same positive banner, refund disclaimer, and registration link are present.
The public source and rendered browser card agree. No registration was submitted.

The paragraph branch previously accepted bare dates only. It now reuses the
existing strict counted-session parser for annotated dates. Closed/zero entries
are excluded; positive counts are retained; bare dates still use the positive
banner. All listed dates participate in duplicate detection before filtering,
so conflicting open/closed duplicates cannot form a successful partial snapshot.
Date identities and per-date alerting remain unchanged. Unknown status wording,
invalid dates/counts, hidden markup, changed boundaries, and wrong links fail and
preserve state.

All **198 tests**, typecheck, and whitespace checks pass. A captured minimal
public fixture reproduces the changed card. New tests cover its two open dates
and counts, stable identities, mixed bare/counted dates, all-explicitly-closed
states, duplicate closed/open dates, and retained unknown/context rejection.

Two earlier emails at **14:31** and **14:36** correspond to North York API
timeouts in runs `39010170556` and `39010479557`. The next run,
[39010788947](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/39010788947),
created **14:40:36**, recovered North York with 155 published available schedules
and passed the scoped guard. The timeout's upstream cause is unknown. These
were separate from Toronto's pagination incident; no alert suppression or
North York parser change was made.

A read-only transaction at **October 18 00:01:50.473 China time**, using
`tcf_slot_monitor`, confirmed Winnipeg retained its eight prior dates, checked at
October 17 `15:46:06.005Z`, with unchanged notification time
`2026-10-10T16:56:49.972Z`. Toronto computer and North York had fresh state during
the 00:00 cycle. The newly recognized two open dates already exist in Winnipeg's
baseline, so reducing the snapshot to them should not produce a new-date ping.

## Production verification — October 18, China time

Commit `c44ba6d` shipped after the 00:00 cycle had already selected the preceding
revision. The 00:00 run `39047544388` therefore still used `9cc64ee`; it is not a
failed run of the repair.

All three normal runs on the repair passed **198 tests**, typecheck, and
the restricted database guard with zero forbidden privileges. Winnipeg changed
**8 → 2** on the first run and remained **2 → 2** on the second, without a new
notification. Ten other sources passed in each run. Toronto paper returned its
known SiteGround challenge within the existing one-hour grace on those first
two runs, preserving state. The third run passed all **12 sources**, including
Toronto paper. This recovery observation does not establish a permanent repair
to its intermittent upstream challenge.

| Run | Creation (China time, October 18) | Winnipeg | Other sources |
| --- | --- | --- | --- |
| [39047894168](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/39047894168) | 00:05:31 | OK; 8 → 2; no send | Ten OK; Toronto paper in approved challenge grace |
| [39048264811](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/39048264811) | 00:10:39 | OK; 2 → 2; no send | Ten OK; Toronto paper in approved challenge grace |
| [39048621414](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/39048621414) | 00:15:32 | OK; 2 → 2; no send | All eleven other sources OK, including Toronto paper |

These existing timer cycles were created 5 minutes 8 seconds and 4 minutes
53 seconds apart; no additional production run was dispatched for verification.

The final read-only transaction at **00:17:00.519 China time** authenticated as
`tcf_slot_monitor`. All **14 availability/reminder rows**, excluding health
metadata, refreshed during the final cycle between `16:15:54.598Z` and
`16:16:10.614Z` on October 17 UTC. Winnipeg held exactly November 24 with
**1 published place** and November 25 with **4**, both without invented years.
Its `checked_at` was `2026-10-17T16:16:10.614Z`; `notified_at` remained
`2026-10-10T16:56:49.972Z`. The source logs and unchanged notification timestamp
confirm no repeat date notification during the three repaired cycles.
Toronto paper's separate health record recorded actual success at
`2026-10-17T16:15:55.888Z`, with both incident markers reset to null.

The three-cycle steady-state verification is complete. No alert suppression,
credential changes, database grant changes, local live pipeline execution, or
registration submissions were needed. Availability is the centre's published
listing, not a guaranteed reservation or checkout inventory.
