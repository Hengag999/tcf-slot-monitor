# November 4 — Toronto nested computer exam groups

## Diagnosis

The latest 300 workflow conclusions inspected contained a **145-run failure
streak**, starting with [41676560764](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/41676560764)
at **November 4, 00:40:15 China time**. Last preceding success was
[41675720699](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/41675720699)
at **00:35:15**. The streak ended at the inspection boundary,
[41775089191](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/41775089191)
at **12:45:15**, not at a recovered run. All were on `96fd327`.

The onset, two intermediate logs (`41712398135`, `41742251982`) and latest log
all show `AC children of 129466: incomplete or unexpected children; availability
unknown`. Not every intervening failure log was read. The latest log passed
225 tests, typecheck, the restricted `tcf_slot_monitor` guard with zero forbidden
privileges (89 other relations / 43 sequences), and the other eleven sources,
including North York. This is a new Toronto hierarchy failure, not evidence
that yesterday's North York DNS fallback failed.

## Live source and state

The official public booking search and its APIs expose this hierarchy:

| ID | Role | Advertised children | Observed child response |
| --- | --- | --- | --- |
| 129466 | Top-level E-TCF parent | One, explicit `[129467]` | Parent 129467 |
| 129467 | Nested E-TCF parent | One, IDs explicitly `null` | Concrete session 129591 |
| 129591 | Concrete E-TCF session | Zero | Detail reports November 6, 2026, **7 openings remaining**, `is_parent_activity=false` |

The nested parent's detail also reports seven openings but marks itself as a
parent, so it cannot be treated as a bookable sitting. The official UI exposed
two successive `View sub-courses (1)` groups, then session
`SCTCFCB061126-MS`, November 6, and **Enroll Now** linking to activity 129591.
No enrollment button was clicked, form submitted, reservation or payment made.
These are dated public availability observations, not reserved seats.

A **read-only transaction at 12:50:38.616 China time**, as `tcf_slot_monitor`,
confirmed computer state retained `[]` from the last success at
`2026-11-03T16:35:38.588Z`; its prior notification timestamp remained
`2026-11-03T00:30:31.578Z`. All other 13 availability/reminder rows were fresh in
the 12:45 cycle. Health metadata was excluded. Thus the failed source preserved
the old snapshot, but could not announce the newly observed concrete opening.

## Repair

Traverse nested E-TCF navigation groups through the same public child endpoint,
checking each level's response metadata, complete pagination, advertised count
and any explicit child IDs. An explicit null ID list continues to use the public
frontend's empty-string discovery request. Parent status or aggregate seat count
never becomes availability; only concrete leaves reach the existing independent
detail confirmation, where `is_parent_activity=false`, matching ID, valid date
and explicit availability remain required.

A snapshot-wide visited set rejects cycles and reuse of a node across branches
or top-level rows. Traversal is bounded to depth 8 and 500 total activities;
unknown, malformed, over-limit, incomplete, wrong-format, duplicate, failed
request or unreadable detail still fails the entire computer source and preserves
its state. Valid empty navigation groups contribute no seats. The paper source,
approved outage policies, credentials, database grants, notification strategy and
other centre scrapers are unchanged.

All **231 offline tests** and typecheck pass. A minimal fixture contains only
public hierarchy fields and parent/leaf availability detail. New regressions
cover the actual nested chain, descendant pagination, cycles/cross-branch reuse,
missing or wrong-format descendants, traversal bounds, empty parent groups,
and preservation on failed nested requests or a parent masquerading as detail.
Prior tests that categorically rejected nested groups now distinguish valid
navigation from malformed/cyclic metadata; their count/identity/uniqueness
checks remain.

A public-source-only repaired computer check traversed four top-level rows,
found two concrete sessions, and returned only **129591, November 6, 7 openings**.
No local live pipeline, production state write or Discord send was performed.
Deployment, actual delivery and normal automatic-run evidence remain pending.
