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
rows were current in the 11:30 cycle; health metadata was excluded. At that
pre-deployment check, three newly published dates were eligible for one
notification. Shipment and production verification are recorded below.
No database grants, credentials, error-alert policy or unrelated infrastructure
were changed.

## First repaired automatic run and actual Discord delivery

Commit `eb97e0d` shipped the parser and wording repair. Automatic run
[40059243329](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/40059243329),
created **11:40:12 China time**, passed **216 tests**, typecheck, the scoped
`tcf_slot_monitor` guard with **zero forbidden privileges** (84 other relations
and 43 sequences inspected), and **all 12 real source checks**. Winnipeg reported
0 → 3 and Discord accepted all three dates. No manual dispatch or local live
pipeline was used.

The actual message was read back through the logged-in browser in the existing
BonTCF Winnipeg channel:
[1563396789133123735](https://discord.com/channels/1484038585907810535/1557954285474685010/1563396789133123735),
at `2026-10-24T03:40:41.037Z`. It contains December 9, 11 and 14 with
09:50–18:00, the official listing/form links, the missing-year caveat,
registration/payment/centre-confirmation condition and explicit **余位未披露**
wording. Exactly one message with one `@everyone` was observed. The old generic
console counter called these slots; the shared console label is now also
`published exam date(s)` for this published-data style, avoiding an inventory
claim there. Other source labels are unchanged.

The second automatic run,
[40059583465](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/40059583465),
created **11:45:12 China time** on `d6ecc12`, passed all 216 tests, typecheck,
the scoped guard with zero forbidden privileges and all 12 sources. Winnipeg
reported **3 → 3** with no Discord send. The observed interval was five minutes.

## Completed scheduled verification

| Automatic run | Created (China time, October 24) | Revision | Actual source outcome | Winnipeg / notification |
| --- | --- | --- | --- | --- |
| [40059243329](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/40059243329) | 11:40:12 | `eb97e0d` | All 12 OK | 0 → 3; one accepted announcement |
| [40059583465](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/40059583465) | 11:45:12 | `d6ecc12` | All 12 OK | 3 → 3; no send |
| [40059922617](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/40059922617) | 11:50:12 | `d6ecc12` | 11 OK; Toronto paper DEGRADED within approved grace | 3 → 3; no send |

Each run passed **216 tests**, typecheck and the scoped `tcf_slot_monitor`
credential guard with **zero forbidden privileges**. All three workflows
succeeded. The final Toronto paper check returned its recognized SiteGround
HTTP 202 challenge after five minutes without success; its prior snapshot was
preserved. This accepted intermittent condition is not a Winnipeg regression,
and a successful workflow with that degraded source is not all-source recovery.

A final **read-only transaction at 11:51:30.464 China time** confirmed Winnipeg
held exactly December 9, 11 and 14, each with `09:50–18:00`, no invented year
and no seat count. Its `checked_at` was `2026-10-24T03:50:42.952Z` and
`notified_at` remained `2026-10-24T03:40:46.120Z`, the first accepted send.
Excluding all `__monitor_health__` metadata, 13 availability/reminder rows were
fresh in the 11:50 cycle. Toronto paper retained its successful
`2026-10-24T03:45:31.693Z` snapshot during grace; its health record had
`lastSuccessAt=2026-10-24T03:45:31.712Z`,
`firstChallengeAt=2026-10-24T03:50:33.818Z` and no reported-failure marker.
Halifax and Ottawa both had successful 11:50 checks and cleared incident markers.

The final browser read after the third run still showed message
`1563396789133123735` as the latest Winnipeg message, with one announcement
containing the three December dates. Together with the two no-send logs and
unchanged notification timestamp, this verifies delivery without a duplicate
over the three observed cycles. No production state was written by health
checks. Verification of this observed Winnipeg schedule layout is complete;
future unknown layouts will still fail visibly and preserve the last snapshot.
