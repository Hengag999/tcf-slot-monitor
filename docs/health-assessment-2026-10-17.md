# Repeated failure emails — October 17, 2026

## Confirmed incident

Native Mail's **13:11 China-time** email links to
[39005293192](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/39005293192).
Its live monitor step failed Toronto computer discovery with:
`AC children of 129703: incomplete or duplicate activities; availability unknown`.
The other ten non-Toronto sources passed; Toronto paper had its recognized
SiteGround challenge within the approved grace period and did not cause failure.
The scoped database guard passed with zero forbidden privileges.

The last successful run was
[38927191569](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/38927191569),
created **October 16 at 23:50:35 China time**, reporting one computer group and one
concrete session. The next run,
[38927875000](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/38927875000),
created **23:55:43**, failed with the same child-129703 error seen in the latest
email. Metadata through **October 17 at 13:15:33** contains **162 consecutive
failed workflows** after that successful run. The first and latest sampled logs
confirm the same computer discovery failure; not every historical log was read.

At **13:16:40.162 China time**, a read-only transaction using `tcf_slot_monitor`
confirmed the computer snapshot remained at `2026-10-16T15:50:55.769Z`, with zero
stored openings. Other centres' rows refreshed during the 13:15 cycle. Paper
retained its separate most recent successful snapshot during its known challenge.
No failed scrape replaced availability with an empty result.

One earlier failure outside this continuous burst was also checked:
[38887722217](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/38887722217),
October 16 at **18:30:49 China time**, timed out while posting one new North York
paper date to Discord. The pending state was retained. The next automatic run,
[38888254548](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/38888254548),
at **18:35:39**, retried that date and logged confirmed Discord message
`1560602253767872532` at **18:36:12.824** before persistence. The first timed-out
request's delivery is unknown; no assertion of exactly-once delivery is made.
This recovered delivery issue does not justify blindly retrying ambiguous POSTs
or suppressing notification errors. No change to that path was made.

## Root cause and public source verification

The live public category-30 search now has three computer parent groups. Parent
`129703` advertises two children, IDs `129704` and `129705`. Its child endpoint
returns both in the first response, with `total_records=2`, but also reports
`total_page=2` and `total_records_per_page=1`. Asking for page 2 returns the same
two children again. The prior shared pagination loop concatenated all four rows
and correctly rejected the duplicates, freezing this source and failing every run.

The official booking frontend's public JavaScript consumes `body.sub_activities`
once, without traversing that child pagination metadata. In Ego, expanding
"View sub-courses (2)" made one child request and displayed both October 30
sessions as Full. The current parent records contain three groups and four
concrete sessions in total. A live standalone computer scrape after the repair
completed with zero openings. No booking, cart, account, or challenge action was
taken.

## Repair and local validation

For child responses only, the pagination loop now stops after the first response
when the validated array already equals its declared record total. The existing
uniqueness check, parent child-count and explicit ID-list checks, exam-format and
leaf checks, and independent detail availability validation still apply.
Genuinely partial child responses still traverse every page. Top-level search
does not use this exception. Unknown or incomplete results still fail and
preserve state; no alert policy was weakened.

All **195 tests**, typecheck, and whitespace checks pass. A minimal public fixture
captures the observed two-child response and misleading page count. Regression
checks verify one-request complete discovery, detail verification for a potential
opening, rejection of duplicate/missing/foreign/nested/wrong-format children, and
continued top-level pagination. Existing tests retain partial-child pagination
and failed-source state preservation.

## Production verification

Commit `65ce999` shipped before the next normal timer cycle. Three consecutive
scheduled runs passed **195 tests**, typecheck, the scoped database guard with
**zero forbidden privileges**, and all **12 actual sources**:

| Creation time, China time | Run | Toronto computer |
| --- | --- | --- |
| October 17 13:20:32 | [39005906506](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/39005906506) | OK; three parent groups, four concrete sessions, zero openings |
| October 17 13:25:32 | [39006209269](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/39006209269) | OK; same complete closed result |
| October 17 13:30:36 | [39006518571](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/39006518571) | OK; same complete closed result |

A read-only query at **13:22:02.857 China time** confirmed computer
`checked_at=2026-10-17T05:20:50.419Z`, advancing from the previous night's frozen
snapshot. Paper refreshed at `05:20:50.731Z`. Neither notification timestamp
changed. No manual production dispatch, local live pipeline, or state overwrite
was used.

The final read-only transaction at **13:31:51.216 China time** authenticated as
`tcf_slot_monitor` and confirmed all **14 availability/reminder rows** refreshed
between `05:30:57.527Z` and `05:31:15.787Z`, excluding health metadata. Computer
and paper retained zero openings and their original notification timestamps.
Paper's separate health record showed actual success at `05:30:57.749Z`, with
both incident markers null. All 12 sources actually succeeded in all three runs;
none used paper grace, and no Discord message was sent during verification.

Observed creation intervals were **5m00s** and **5m04s**. This completes the
post-deployment check. The repair corrects the demonstrated complete-child
response shape; it does not reconstruct availability during the earlier outage
or guarantee the provider will never change its API again.
