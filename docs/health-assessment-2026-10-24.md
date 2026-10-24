# October 24 — Winnipeg published schedule layout

The latest 80 runs inspected at 11:31 China time contained 61 consecutive
failures after successful run `40033488818`, created **06:25:13 China time**.
The first failure, [40034031307](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/40034031307),
created **06:30:17**, and recent run
[40058560501](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/40058560501),
created **11:30:14**, both failed Winnipeg with `Next sessions boundary missing
or unrecognized availability list; state must be preserved`. The latest run
passed the other eleven sources and the scoped database credential guard.
This count describes workflow conclusions; not every intervening log was read.

## Official source and limits

The browser's actual `Next sessions` card now contains:

- The same duplicate-registration warning and first `New dates:` label.
- **The EXAM is scheduled from 9:50am to 6:00pm**.
- A second `New dates:` label with **Dec. 09th, Dec. 11th, Dec. 14th**.
- The same refund disclaimer and official registration link.

The former positive `spots available!` banner is absent. There are no published
years, counts or timezone. The linked public registration form has no session
inventory/selector; no form fields were filled, registration submitted, payment
made or reservation attempted. These dates are a **published exam schedule**,
not independently confirmed remaining inventory.

## Repair

The new branch requires the complete observed schedule context within the
validated `Next sessions` section, both New dates labels, a valid forward
same-day 12-hour clock window, all valid unique dates, exact disclaimer and
same-origin registration link. It tolerates headings/paragraphs/line breaks and
inline styling around the colon without treating arbitrary bare-date lists as
availability. Unknown text, invalid/duplicate dates, invalid or reversed times,
hidden markup, empty or incomplete sections and changed links still fail and
preserve state. Prior counted/positive-banner/announcement-only variants remain
covered. IDs and per-date notification strategy stay stable.

The source returns December 9, 11 and 14 with `09:50–18:00`, retaining missing
years and counts. For published notifications containing dates without counts,
the title now reads **官网公布场次（余位未披露，请向考点确认）**. It does not claim
available seats; counted published messages retain their explicit count wording.
Normal availability messages for other centres are unchanged.

All **216 tests**, typecheck and whitespace checks pass. The minimal captured
public-section fixture and new tests cover actual schedule extraction, semantic
formatting, strict negative cases and uncounted-notification wording. A standalone
public-source GET also returned exactly the same three dates and times without
using database or Discord credentials.

A read-only transaction at **11:32:29.969 China time**, as `tcf_slot_monitor`,
confirmed Winnipeg held `[]`, last checked `2026-10-23T22:25:44.562Z`, with
unchanged `notified_at=2026-10-10T16:56:49.972Z`. All other 13 availability/reminder
rows were current in the 11:30 cycle; health metadata was excluded. Three newly
published dates are eligible for one notification after deployment. Production
shipment, actual delivery and normal scheduled-run verification remain pending.
No database grants, credentials, error-alert policy or unrelated infrastructure
were changed.
