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

## First automatic recovery and actual Discord delivery

Commit `a351034` shipped the hierarchy repair. Normal run
[41776072487](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/41776072487),
created **12:55:15 China time**, passed **231 tests**, typecheck, the scoped
database guard with **zero forbidden privileges**, and **all 12 real sources**.
Computer discovery found two concrete sessions, with only November 6 available.
The pipeline accepted one Discord notification before persisting its snapshot.

The actual existing Toronto-channel message was independently read in Ego:
[1567401907494846625](https://discord.com/channels/1484038585907810535/1484040090144608346/1567401907494846625),
timestamp `2026-11-04T04:55:35.666Z`. It contains one `@everyone`, November 6,
seven seats and the booking link for **129591**, with neither parent advertised.
No synthetic message or manual production dispatch was used. Subsequent-cycle
deduplication and final read-only state evidence remain pending.

## Earlier intervening failures and diagnostic limit

All six failed runs between yesterday's final verification and the sustained
Toronto streak were also inspected. Three (`41661067372`, `41661951459`,
`41662820639`) already showed the same Toronto hierarchy failure intermittently.
Four (`41657629868`, `41662820639`, `41667980340`, `41669641285`; one overlaps)
failed North York with only `non-retryable transport error`. Those logs omit the
underlying code, so they do **not** establish a repeat of the earlier refused-DNS
connection or a reason to expand retry/grace eligibility. The latest North York
scrapes and persistence succeeded (152 Computer + 2 Paper at the initial state
check).

Added bounded, allowlisted transport-name/code diagnostics for these ineligible
North York exceptions, including nested native causes/aggregates. Raw messages,
addresses, URLs and arbitrary values remain suppressed. This is diagnostic
coverage, **not a demonstrated repair of those four unknown failures**. They
continue to fail immediately without retries or grace. The existing eligible
connection fallback is unchanged. A regression verifies both safe logging and
unchanged immediate failure. The current complete suite is **232 passing tests**,
with typecheck passing.
