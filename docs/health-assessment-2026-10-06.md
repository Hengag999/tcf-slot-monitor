# TCF monitor assessment and local repairs — 2026-10-06

The monitor was running, but had two failed cities and one incomplete listing. Discord silence was therefore a mixture of expected notification policy, broken discovery, and missing pagination. The changes below are implemented and verified **locally**, not yet committed/pushed or exercised by GitHub. No production state was written and no Discord messages or registrations were submitted during this investigation.

## Evidence and scope

- Read the actual bot messages in all nine Discord channels through the user's authorized ego-browser session. Message timestamps below are China time (UTC+8), not the browser's relative date labels.
- Read database freshness and stored slot/reminder state without changing it. The seven non-failing cities were refreshed by the October 6 15:55 China-time run. Toronto was frozen since September 2 09:27; Edmonton since August 8 02:07.
- Inspected 100 GitHub run records (September 19–October 6 China dates), all green, and the latest eight full logs. Both failed scrapers were skipped in every inspected log; existing code swallowed scrape errors. There were no notification/persistence errors in those eight logs, but no notification attempts either, so they did not verify webhook delivery.
- The 100 scheduled runs were 1.59–8.19 hours apart, averaging 4.22 hours. The declared five-minute cron was not the observed execution cadence. [Latest inspected run](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/37432675817).
- Studied official registration entry points, server-rendered listing pagination, public application JavaScript, public APIs, and booking detail responses. No private APIs, account credentials, browser cookies, or bot-clearance tokens were copied into the scrapers.

## City assessment

The last-ping column links the observed Discord message. A recent database timestamp alone is not evidence of complete discovery.

| City | Last observed Discord ping, China time | Finding before repair | Current source evidence and local result |
|---|---|---|---|
| Toronto | [Aug 25 11:27](https://discord.com/channels/1484038585907810535/1484040090144608346/1541650110209986610) | Broken: paper HTTP 403 suppressed computer too; both state rows frozen | Honest monitor User-Agent restores CM JSON locally. Computer: one full sitting, zero bookable. Paper: filtered list empty; four future raw records independently verified On Hold. Both source scrapes succeed locally. |
| Edmonton | [May 29 06:01](https://discord.com/channels/1484038585907810535/1495289049014075526/1509678054140543194) | Broken: old product URL redirects to one closed exam; old selector no longer exists | Official TCF listing has 28 rows over two pages, all closed. Local replacement succeeds and reports zero bookable. |
| Vancouver / New Westminster | [Sep 14 06:38](https://discord.com/channels/1484038585907810535/1484040131932455003/1548825296046919790) | Incomplete: only first 15 rows fetched; location/sitting key collisions | Complete source has 95 rows, including 37 future registrations previously beyond page one. Read-only state preview yields exactly 37 new-session reminders, no closed-row replay. |
| Victoria | [May 26 06:04](https://discord.com/channels/1484038585907810535/1495289361342791780/1508591511384752300) | Quiet in monitored source | Zero Victoria rows in all 95 shared-listing rows; fresh stored state. This is not a claim about every possible exam provider. |
| Calgary | [Sep 18 00:57](https://discord.com/channels/1484038585907810535/1484039873999667261/1550188916676493414) | Quiet: month button still visible, but all individual dates sold out | November destination has 11 sold-out cards. Repaired parser reports zero, rejects unknown pages instead of implying availability. |
| Halifax | [Sep 28 23:03](https://discord.com/channels/1484038585907810535/1484039971886207106/1554146633401372796) | Quiet under 0→N policy | 20 detected slots; slots stayed open, so later additions do not trigger another alert until state first reaches zero. |
| Ottawa | [Sep 21 14:59](https://discord.com/channels/1484038585907810535/1484040043583504555/1551488047667875880) | Quiet under 0→N policy | Five computer slots, zero paper. Computer state remains nonzero, suppressing repeat alerts by design. |
| Ashton | [Aug 19 13:48](https://discord.com/channels/1484038585907810535/1484039767829123164/1539511460588421160) | Quiet in current monitored picker | Current scrape detects zero offered dates, fresh stored state, no structural exception. No change to its notification policy. |
| North York | [Sep 29 05:12](https://discord.com/channels/1484038585907810535/1485198603604594730/1554239312537850016) | Quiet under per-date policy | Read-only comparison: 184 stored → 183 live sittings, no new dates; both maximum dates February 28, 2027. |

## Entry-point investigation and service choices

### Toronto

The [official registration page](https://www.alliance-francaise.ca/en/exams/tests/informations-about-tcf-canada/tcf-canada) still uses the CM groupcourses API for paper discovery. Its browser code turns request failures into an apparently empty table, so “No sessions currently available” in the UI was insufficient on its own.

The decisive experiment compared clients against the same public category-368 request. The hardcoded Chrome 124 identity returned HTTP 403 twice; a current browser succeeded, and an honest `TCF-Slot-Monitor/1.0` User-Agent also returned HTTP 200 JSON with no browser cookies or special credentials. Both paper and computer now work with ordinary fetch locally. This establishes local header sensitivity; it is not a guarantee about all GitHub runner IPs.

Source isolation remains valuable even after fixing the header: computer and paper now have separate failure boundaries and explicit exam-type state scopes. A failed source can no longer erase or suppress the other. Unreadable detail, malformed pagination, and unknown availability remain failures rather than false zeroes. Paper records can share Active Communities category 30, so computer discovery now checks the product name instead of assuming category alone identifies format.

An additional service opportunity is the official 2027 quarterly release calendar (10 a.m. on Dec 1 2026, Mar 2, May 20, and Aug 17 2027). The page does not explicitly name a timezone; automated release epochs were not invented. A later enhancement can add clearly labelled release reminders after that timezone is confirmed.

### Edmonton

The retired `/products/af-tcf-canada/` URL redirects to `/af/exam-selector/order/?exam_id=200`, a single closed exam. The dependable discovery entry point is the [public TCF listing](https://www.afedmonton.com/en/exams/tcf/), following its actual Show More link.

One closed row still displayed one remaining seat. The replacement requires an explicit `es-status-available` Book Now link to the same site's exam order route, and rejects zero-seat or future-opening rows. Positive open markup was observed on the site's [DELF listing](https://www.afedmonton.com/en/exams/delf-adults/); no open TCF row was available during this audit, so the TCF open path is fixture-tested rather than live-verified.

The source's registration windows can be about one hour, shorter than many observed GitHub intervals. The service therefore retains per-date availability alerts **and adds future registration reminders** from advertised opening epochs. These use America/Edmonton and a separate tracking row, and do not duplicate already-open availability announcements. All 28 currently closed rows baseline silently. A live future Edmonton epoch was not present during the audit; the official client supports it and synthetic cases verify the engine.

### AF-CAPA: Vancouver, New Westminster, Victoria

The [shared TCF listing](https://www.alliancefrancaise.ca/en/language/exams/tcf-canada/) has three pages: 15 + 60 + 20 rows. The old first-page parser missed 80 rows. Of the complete 95, 58 are closed and 37 have future registration epochs: **25 New Westminster and 12 Vancouver, all opening November 2 at 15:00 Pacific (November 3 at 07:00 China time)**. No Victoria rows were found.

Old label-only identities conflated 26 distinct sittings in this snapshot. The parser now includes the location and first sitting schedule in stable keys, retaining legacy aliases for migration. Reminder copy names the location. All pages must succeed before a snapshot can replace stored state. Recovery does not announce historical closed/full rows or send late “before opening” reminders after the opening time.

Discord showed two similar three-day reminder batches on September 12 at 06:01 and 08:07 China time. Their exact historical cause was not established; the new identities and serialized workflow prevent known present-day duplication risks without claiming to explain those old messages.

### Calgary

The [November destination](https://www.afcalgary.ca/exams/tcf/tcf-registrations-open-1607/) explicitly shows 11 sold-out dates, although the parent still links to it. The previous fallback treated an unrecognized page with zero cards as open and treated request failures as closed. Both can corrupt notification state.

Unknown markup and request failures now throw, preserving prior state. A bookable candidate requires a positive enabled registration link within its own non-sold-out card. Genuine open-state markup was not available on either the TCF page or the related TEF page, so that remains an explicit live-validation limitation.

## Shared reliability changes

- Every scrape failure now contributes to a nonzero final result, after other sources run; GitHub gets a per-source summary.
- Missing webhooks and rejected notifications cannot consume pending availability/reminder events. Historical `notified_at` still is not proof of historical delivery.
- Listing traversal, Toronto/Calgary requests, and webhook sends have time bounds; the job has a ten-minute limit.
- Workflow concurrency prevents overlapping monitor executions from racing state writes or double-sending. Running jobs are not cancelled mid-send.
- Offline regression tests and TypeScript checks run before the monitor in CI.
- Cron is offset from minute zero (`2-57/5`), but remains best-effort. This is not a cure for the observed multi-hour cadence. If reliable five-minute checks are required, use a scheduler/worker with an explicit cadence guarantee or an independently monitored scheduler that dispatches the existing job; no new infrastructure was provisioned here. Advance registration reminders are the useful complement when openings are brief.

## Validation and next production check

- `npm test`: 55 offline tests pass; mocked I/O verifies source isolation, state preservation, missing-webhook behavior, pagination, identities, legacy reminder migration, cutoff/reschedule behavior, city timezone, and positive booking requirements.
- `npm run typecheck`: passes.
- Full public-source dry-run: all nine cities / eleven sources pass after repairs. No database reads or writes and no Discord sends in that dry-run.
- Separate authorized read-only state preview: 37 new BC reminder candidates, zero newly appearing North York dates. It did not consume those events.
- Independent code review found no integration blocker.

After approval to publish, the first repaired GitHub run must show both Toronto sources and both Edmonton sources succeeding, all three BC listing pages covered, and Toronto/Edmonton `checked_at` advancing. The BC recovery should produce the 37 upcoming-session entries (chunked with only one `@everyone` in the batch) and then persist their reminder tracking. Confirm those actual Discord messages before calling production delivery verified. Existing policies for Halifax/Ottawa/Ashton/Calgary remain 0→N; changing them to per-date would be a separate service-policy decision.
