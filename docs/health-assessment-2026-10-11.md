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

Shipment and normal automatic-run verification are pending. No extra manual
production dispatch or local live pipeline is used for verification.
