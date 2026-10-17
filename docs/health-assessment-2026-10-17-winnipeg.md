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
timeouts in runs `39010170556` and `39010479557`. Their recovery is being checked
separately; they did not originate in the repaired Toronto parser.

Production shipment and scheduled verification are pending.
