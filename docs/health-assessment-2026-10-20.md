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
same Winnipeg error, without claiming every intervening log was inspected.

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

Production shipment and normal scheduled-run verification are pending.
