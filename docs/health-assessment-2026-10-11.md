# Winnipeg formatting regression — October 11, 2026

## Incident and cause

The native macOS Mail application showed new failure emails at **00:42** and
**00:47 China time**. The selected 00:47 message linked to
[38069004046](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/38069004046),
on `bfad742`. It and the preceding
[38068669335](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/38068669335)
failed only Winnipeg: `Next sessions boundary missing or unrecognized availability list`.
The other 11 source checks passed, including both Toronto sources. The restricted
database guard passed with zero forbidden privileges. Recent run metadata shows
the first failure at **00:41:13**, following a successful **00:36:05** run.

The official Winnipeg page still said **New dates: spots available!**, but moved
the individual dates and refund disclaimer out of one `<h3>` into separate `<p>`
elements. It also added **October 20** before the previous eight dates. The
positive availability wording, disclaimer, and official registration URL remained
the same. Both the rendered Ego browser page and a separate public GET confirmed
the change. No year or numeric remaining-seat counts were published.

Yesterday's repair was too specific to the two-heading layout. Its exception
preserved state but unnecessarily stopped valid availability checks after this
formatting edit. At **00:51:52 China time**, a read-only transaction as
`tcf_slot_monitor` confirmed Winnipeg retained eight dates from
`2026-10-10T16:36:33.076Z`, while all other availability/reminder rows refreshed
during the 00:51 cycle. Toronto paper's health row recorded success with null
incident markers.

## Repair and local validation

The date-only branch now parses ordered semantic text lines within the existing
validated `Next sessions` section. It collapses source-code whitespace before
turning block elements and `<br>` into line boundaries, so HTML indentation and
inline emphasis do not split the refund sentence or month/day text. It accepts
headings, paragraphs, lists, and containers without requiring their exact count.

The same strict meaning checks remain: anchored registration notice and positive
availability banner, one exact disclaimer boundary, registration-only suffix,
nonempty unique valid dates, unchanged official registration link, and no
explicitly hidden evidence. Unknown, conflicting, or incomplete snapshots still
throw. The original counted-date/explicit-empty branch and all alert policies are
unchanged. No new dependencies, credentials, permissions, or infrastructure changes
are needed.

A new sanitized fixture captures the actual paragraph layout. **176 offline
tests**, typecheck, and whitespace checks pass. Tests exercise all three captured
layouts, equivalent block and inline formatting, negative/hidden/unknown cases,
and the configured pipeline: eight old dates to nine new dates sends only
**October 20**, an unchanged repeat sends nothing, and a later unknown page
preserves the last successful snapshot. Independent code review found no blockers.
The repaired public standalone scraper returned all nine dates, without database
writes or Discord messages.

## Production verification

Commit `3fbea3e` shipped the repair. The first automatic run,
[38069668503](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/38069668503),
started at **00:56:06 China time**. It passed 176 tests, typecheck, and the scoped
database guard with zero forbidden privileges. Winnipeg returned nine dates and
reported `8 → 9 — 1 new date — NOTIFY`. All 11 non-paper sources were OK. Toronto
paper received its known SiteGround challenge and was correctly marked degraded
within its existing one-hour grace period, four minutes after the last success;
the overall workflow succeeded. This is not a claim that paper succeeded.

The actual existing Discord channel displayed
[message 1558523679808163890](https://discord.com/channels/1484038585907810535/1557954285474685010/1558523679808163890),
sent at **00:56:41.236 China time**. It listed only **October 20**, both official
links, and the missing-year/centre-confirmation caveat; none of the previous eight
dates was replayed. Discord's receipt was confirmed before persistence.

A read-only transaction at **00:57:20.111 China time** confirmed all nine stored
dates, with `checked_at=notified_at=2026-10-10T16:56:49.972Z`. Paper's health row
retained last success `16:51:35.665Z`, first challenge `16:56:29.359Z`, and a null
failure marker. No production state was manually edited.

The second automatic run,
[38070043204](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/38070043204),
started at **01:01:33 China time**, 5 minutes 27 seconds after the first. All 12
sources passed, including an actual successful Toronto paper check. It again
passed 176 tests, typecheck, and the scoped guard with zero forbidden privileges.
Winnipeg reported `9 → 9`, with no Discord send or duplicate notification.

The third automatic run,
[38070360115](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/38070360115),
started at **01:06:08 China time**, 4 minutes 35 seconds after the second. It also
passed all 12 real source checks, 176 tests, typecheck, and the scoped guard with
zero forbidden privileges (72 other relations and 41 sequences checked).
Toronto paper actually succeeded again; Winnipeg remained `9 → 9` with no send.
These three consecutive automatic runs verify the repaired behavior under the
normal timer. The first run's accepted paper degradation is distinct from the
two later successful paper observations; no permanent upstream repair is claimed.

A final read-only transaction at **01:07:13.447 China time** confirmed that all
14 availability/reminder rows refreshed during the 01:06 cycle, excluding the
separate health metadata row. Winnipeg retained nine dates with
`checked_at=2026-10-10T17:06:36.254Z` and the original recovery notification
timestamp `2026-10-10T16:56:49.972Z`. Toronto paper recorded actual success at
`17:06:25.346Z` and cleared both incident markers. The browser still showed the
same October 20 message as the latest Winnipeg notification, without a duplicate.
No extra manual production dispatch or local live pipeline was used.
