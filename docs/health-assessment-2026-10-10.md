# Failure-email incident — October 10, 2026

## Confirmed incident

The native macOS Mail application showed GitHub failure emails approximately
every five minutes. The 10:51 China-time email linked to
[38018467059](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/38018467059)
on `6eadcd7`. Its production log failed Toronto computer and Winnipeg; the other
ten source checks passed. The email's “All jobs have failed” refers to the one
aggregate workflow job, not to every centre failing.

The fetched 100-run metadata window contained **73 consecutive failed runs**
from October 9 20:51 UTC to October 10 02:51 UTC. Six boundary/representative logs
were inspected, excluding mock errors produced by offline tests. This sampling
does not prove every intervening failure had exactly the same causes.

| Source | Last successful source run | First observed failure | Error |
|---|---|---|---|
| Toronto computer | [37989192328](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/37989192328), Oct 10 04:46 China | [37989730552](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/37989730552), 04:51 China | Malformed activity hierarchy |
| Winnipeg | [37998735371](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/37998735371), 06:21 China | [37999186590](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/37999186590), 06:26 China | Next sessions boundary missing |

The representative 00:31 UTC run
[38009408470](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/38009408470)
and the 02:51 UTC run had the same two failures. Across the six inspected logs,
the scoped database guard passed with zero forbidden privileges. Toronto paper
was healthy or within its previously approved challenge grace period.

At **02:57:22 UTC**, a read-only transaction authenticated as `tcf_slot_monitor`
confirmed the failed snapshots were preserved: Toronto computer remained empty
with `checked_at=2026-10-09T20:46:33.344Z`; Winnipeg retained its preceding three
dates with `checked_at=2026-10-09T22:21:44.636Z`. All other availability/reminder
rows refreshed during the 02:56 UTC cycle. Paper's separate health row showed a
successful check and null incident markers. No production data was edited.

## Source evidence and repair scope

**Toronto computer:** AC parent `129464` now advertises one child but returns
`sub_activity_ids=null`. The public frontend supports this by passing an empty
ID filter to the existing child endpoint. That endpoint returned concrete child
`129465`. Its public browser detail page independently showed **October 16,
2026**, **10:00–17:00**, and **1 opening remaining**. The old validator incorrectly
required an explicit ID list for every positive child count. The repair must
still require complete child pagination and the advertised count, valid concrete
E-TCF children, uniqueness, and readable candidate detail; supplied ID lists
must continue to match exactly.

**Winnipeg:** the official page removed the next-announcement heading and
replaced per-date seat counts with **“New dates: spots available!”** followed by
eight line-separated dates: November 19, 23, 24, 25, 27 and December 1, 2, 4.
The native rendered browser page confirmed the same list and unchanged official
registration link. It publishes no year or seat count for these dates. The
repair must accept this explicit positive-availability format without inventing
counts or years, and continue rejecting unknown, incomplete, or conflicting
content. Registration still requires the centre's form, payment, and confirmation;
these are published openings, not reservations.

No failure-email preferences, general alert policy, database permissions,
credentials, timer settings, or unrelated infrastructure are changed. Toronto
paper's existing one-hour/one-failure-per-outage policy remains unchanged.

## Verification

Both scoped repairs pass **172 offline tests**, TypeScript checking, and
whitespace checks. Regression fixtures retain the relevant real public source
shapes. Independent review also prompted a conservative Winnipeg guard: an
explicitly hidden selected section, availability heading, date, or registration
link fails and preserves state instead of establishing availability. Both old
and new visible listing formats remain covered.

Commit `11988cc` shipped both repairs. The first ordinary automatic run,
[38019365047](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/38019365047),
started at **03:06:00 UTC / 11:06 China time**. It passed all 12 real sources,
172 tests, typecheck, and the scoped database guard with zero forbidden
privileges. Toronto computer reported four parent rows, four concrete children,
and one available slot; Winnipeg reported eight dates. Toronto paper was healthy.

Both real notifications were read back in the existing Discord channels:

- [Toronto message](https://discord.com/channels/1484038585907810535/1484040090144608346/1558314717141794898), **03:06:20.654 UTC**: October 16, one place, concrete child link `129465`.
- [Winnipeg message](https://discord.com/channels/1484038585907810535/1557954285474685010/1558314773458714768), **03:06:34.081 UTC**: all eight dates, no invented seat counts or years, both official links and the registration caveat.

A read-only transaction at **03:07:17.159 UTC** confirmed Toronto's one-slot
snapshot with `checked_at=notified_at=03:06:25.048Z`, and Winnipeg's eight-slot
snapshot with `checked_at=notified_at=03:06:34.957Z` on October 10. These writes
occurred only through the normal production pipeline, after Discord acceptance.

Three consecutive automatic cycles completed on `11988cc`:

| Run | Creation, China time (Oct 10) | Result |
|---|---|---|
| [38019365047](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/38019365047) | 11:06:00 | 12/12 OK; recovered Toronto and Winnipeg notifications accepted |
| [38019663218](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/38019663218) | 11:11:05 | 12/12 OK; Toronto `1 → 1`, Winnipeg `8 → 8`; no Discord sends |
| [38019960548](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/38019960548) | 11:16:08 | 12/12 OK; same unchanged counts; no Discord sends |

Every cycle passed **172 tests**, typecheck, and the `tcf_slot_monitor` guard
with **zero forbidden privileges**. Observed creation intervals were 5m05s and
5m03s. Toronto paper succeeded on all three cycles; this does not establish a
permanent repair to its separate intermittent upstream challenge.

Final read-only verification at **03:17:09.522 UTC / 11:17 China time** confirmed
all **14 availability/reminder rows**, excluding health metadata, refreshed
between `03:16:25.847Z` and `03:16:34.236Z`. Toronto computer held one slot and
Winnipeg eight. Their `notified_at` values remained `03:06:25.048Z` and
`03:06:34.957Z`, respectively, proving the unchanged follow-up snapshots did not
consume new notification events. Toronto paper's health row recorded success
at `03:16:26.057Z` with both incident markers null.

Steady-state verification for this repair is complete. No extra manual dispatch,
local live pipeline, credential/grant change, or alert suppression was used.
New unknown source errors remain visible. Future source changes can still
require another repair; these observations verify the current source formats
and production behavior.
