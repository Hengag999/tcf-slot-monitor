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

Deployment verification is pending. Only normal automatic timer runs will be
used for production verification; no extra manual dispatch or local live
pipeline is needed.
