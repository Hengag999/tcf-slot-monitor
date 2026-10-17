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

Production shipment and normal scheduled verification are pending.
