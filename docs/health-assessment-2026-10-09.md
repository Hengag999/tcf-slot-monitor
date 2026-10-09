# Source coverage audit — October 9, 2026

This audit followed the discovery that Victoria was returning a healthy empty
result from the wrong website. The user prioritized **Ashton, Calgary, and
Halifax**, and approved expanding North York to paper as well as computer exams.
Current official navigation, public booking data, actual Discord messages,
production logs, and read-only monitor state were compared separately.
Successful execution and fresh state alone are not evidence of coverage.

## Priority centres

### Ashton

The official navigation still directs TCF candidates to
https://ashtontesting.ca/tcf-canada-test/ . The rendered page announces that
additional November and December dates will be released by mid-October, and
currently exposes no active registration dates. The raw HTML contains four
disabled November dates in a picker whose Elementor wrapper is hidden on
desktop, tablet, and mobile; the fallback date select has only a blank option.
The logged-in browser confirms no visible date controls. These are not four
currently bookable sittings.

The latest observed Discord message was August 19 at `05:48:54.944Z`, listing
October dates. Current stored availability is zero. No current missed opening
was established. Historical openings between these observations cannot be
reconstructed from today's page alone.

The parser did not account for explicitly hidden ancestors. A stale hidden
picker could therefore mask a visible replacement control or later produce
false availability. A narrow visibility repair and actual-markup regression
tests now pass locally; this is not proof that the latent flaw caused the
historical silence.

### Calgary

The official TCF overview leads to the configured
https://www.afcalgary.ca/exams/tcf/registration-process/ . October and November
are sold out; its December link leads to
https://www.afcalgary.ca/exams/tcf/tcf-registrations-open-1607/ . The stale
destination heading says November, but the six individual cards are **December
1, 2, 3, 8, 9, and 10**, all explicitly SOLD OUT, with no booking controls.
Independent HTML inspection, the actual browser, and the scraper agree.
The separate registration-details form is for an already purchased exam and
does not provide alternative availability.

The latest observed Discord message was September 17 at `16:57:18.853Z`, listing
November. **There was a real missed December opening on October 8:** the source
used registration overlays unsupported by the parser. Commit `baa9240` fixed
those observed controls, but all six dates had sold out before the next normal
production run. No catch-up availability notification was sent. Today's correct
empty result does not erase that incident. See the October 8 assessment for
the captured opening and deployment evidence. No further Calgary source change
is justified by the current page.

### Halifax

Official TCF navigation leads to
https://afhalifax.ca/test-your-french/tcf/tcf-canada-registration/ . The rendered
widget loads actual exam cards and ADD TO CART controls. Its published widget
configuration specifies branch 1, exam type 16, without a period filter.
`/api/v1/public/examinations/list/1/16` means **branch/type**, not page/limit.
An independent all-types query found only this one TCF Canada type.

The complete response contains **29 sittings: 17 bookable and 12 full**.
All 17 have explicit `isFull=false`, current registration, and a nonempty
registration action. The browser independently rendered all 29 sittings with
exactly 17 ADD TO CART actions. Their exact IDs match stored state. Bookable dates include
October 14–15 and December dates. This is not an empty or retired source.

The latest observed Discord message was September 28 at `15:03:52.051Z`, listing
November 6. Halifax's zero-to-available policy suppresses new or reopened dates
while any other dates remain open. For example, the currently open October 14
sitting lists an October 7–11 registration window. The quiet channel is explained
by policy despite current availability; it must not be described merely as
"nothing new available." A policy change was put to the user separately.

An offline reproduction also showed that the old Halifax and Ottawa parsers
accepted HTTP 200 `{}` as a successful empty snapshot. Strict AEC response
validation now preserves state on unfamiliar data. No current live
malformed response was observed; this guard is separate from the silence policy.

## Other centres

| Centre | Independent current evidence | Audit conclusion |
| --- | --- | --- |
| Edmonton | Official TCF listing has 30 rows over two pages; all closed/full, no future opening epochs. All 30 identities match tracking. Discord delivered a November 2 opening on October 7. | Current zero availability and zero reminders are justified. |
| Vancouver | Three pages contain 106 rows: 55 New Westminster and 51 Vancouver; 56 closed and 50 future registrations. Every source row reconciles with the parser. | Current reminder coverage matches; next three-day thresholds are October 30 at 23:00 UTC. |
| Ottawa | Current API types 5 (computer) and 79 (paper) match four December computer sittings and zero paper; the official site describes both formats. | Current data matches; computer silence is subject to the existing zero-to-available policy. The widget configuration itself was not independently recovered in this audit. |
| North York | Official booking API offers 171 computer plus three paper sittings. The monitor previously selected only format 5 (computer). | User approved adding paper format 4, retaining separate exam-type state and date diffs. |
| Winnipeg | Official published dates are November 3 (1 place), 4 (2), and 10 (1); scraper and state agree. | Current coverage matches the published page; booking still requires form/payment/centre confirmation. |
| Victoria | Own calendar has 27 rows; four future openings were delivered and the next cycle produced no repeat. | Repair and two-cycle production verification recorded in its runbook. |
| Toronto | Paper's four future CM records have zero spaces; independent details show On Hold. Computer's AC search returned a parent with one apparent opening, but its browser page redirects to a group showing No sub-activities. | Final discovery follows all advertised AC children, including closed parents. Five top-level rows yield three Full children; repaired local computer output is zero without CM access. |

North York's three paper dates are **January 5, January 26, and February 23,
2027**, with 13, 25, and 26 advertised remaining places at inspection.

## Reliability boundaries

- A known status or genuinely empty response must be distinguished from unknown
  HTML/JSON. Reproductions showed unsupported `es-status-*` values and renamed
  table rows could silently become no reminders/no rows. Shared-parser guards
  now reject those unknown shapes, without treating these hypothetical markup changes as a
  confirmed historical cause.
- Notification persistence already waits for confirmed Discord delivery.
  Missing or failed webhooks retain pending state; no changes to that policy
  were needed.
- The scoped `tcf_slot_monitor` login was used for a read-only state snapshot
  at `03:55:24.370Z`. Health metadata was excluded from availability counts.
  The latest 100 workflow records inspected contained no failed jobs, but that
  fact was not used to establish source completeness.
- No manual production dispatch, local live pipeline, booking, reservation,
  credential rotation, database grant change, or challenge bypass was used.

## Release verification

All **156 offline tests**, typecheck, and whitespace validation passed before
release. Independent review found no blocking regression. The final shared
parser also replayed all saved live pages successfully: Vancouver 106,
Edmonton 30, and Victoria 27. Repaired standalone checks returned Ashton 0,
Halifax 17, Ottawa 4, North York 174, and Toronto 0/0, matching the separately
verified source evidence.

The three priority centres' notification policy remains unchanged pending the
user's answer about date/month diffs. Existing snapshots are not replayed as
new notifications. North York paper is an explicitly approved new format and
will announce its three current dates once through the normal pipeline.

Ordinary scheduled-run verification follows shipment; local checks alone do not
prove deployment, credential delivery, or production persistence.

### First production cycle — 04:11 UTC

Commit `4660c3b` shipped the repairs. Automatic
[run 37882682731](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/37882682731)
passed all 156 tests, typecheck, and the scoped database guard with zero forbidden
privileges. Ashton returned 0, Calgary 0, Halifax 17, Ottawa 4, and North York
174. All ten non-Toronto sources passed. North York's new paper dates were
accepted in one [Discord message](https://discord.com/channels/1484038585907810535/1485198603604594730/1557968749770842212)
and independently read in the logged-in browser at `04:11:35.605Z`.

**The overall run failed:** computer discovery's new CM dependency received a
recognized SiteGround HTTP 202 challenge and preserved its prior state. Paper
encountered the same challenge within its approved 15-minute grace period.
This is not a successful Toronto cutover and must not be reported as all sources
healthy. Investigation of complete public AC child discovery continues; challenge
bypass and silent suppression are not acceptable replacements for coverage.

A scoped read-only check at `04:12:59.878Z` confirmed refreshed non-Toronto state.
North York computer retained 171 records and paper stored three, with paper
`checked_at`/`notified_at=04:11:37.288Z`. Toronto computer retained its preceding
snapshot at `04:06:27.840Z`, rather than clearing state after unknown discovery.

### Follow-up and Toronto discovery correction

Automatic [run 37883073562](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/37883073562)
at `04:16:12Z` passed all 12 source checks, 156 tests, typecheck, and the scoped
guard. Toronto CM access recovered for that cycle, allowing the invalid parent
snapshot to clear; this recovery alone did not solve the new dependency.
All priority counts stayed unchanged and North York paper remained `3 → 3`
with no additional Discord message.

The public AC frontend revealed the complete discovery path: top-level rows
advertise child IDs, and `/rest/activities/subs/{parentId}` returns those children.
The former scraper incorrectly skipped closed parents instead of traversing
them. Three verified calls returned exactly the advertised IDs:
`129582 → 129585`, `129586 → 129587`, and `129700 → 129702`, all Full.
The parent with the misleading opening, `129464`, advertises no children.
This covers both CM-discovered children plus an additional closed child.

Computer discovery now traverses the public AC hierarchy, validates complete
top-level and child pagination, and requires exact child identities. Parent
space counts never become availability. Full children remain closed; potentially
open children require matching non-parent detail confirmation. Any partial or
unknown hierarchy rejects the whole snapshot. Computer makes **no CM requests**;
paper retains its approved challenge policy and source.

All **162 tests**, typecheck, and whitespace checks passed for this correction,
and independent review found no blocker. One public-only live computer check
returned five top-level rows, three concrete children, and zero available slots.
Final scheduled-run verification follows deployment of this correction.

### Final source deployment — `211d93f`

The first automatic run on the final AC hierarchy correction,
[37883474792](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/37883474792),
started at `04:21:12Z`. All 12 source checks passed, along with 162 tests,
typecheck, and the scoped database guard (`forbiddenPrivileges: 0`). Computer
logged five top-level AC rows and three concrete activities, returning zero;
paper returned a successful empty result. No computer CM request was needed.
Ashton stayed at zero, Calgary zero, Halifax 17, and North York 174, including
unchanged `Paper 3 → 3` with no repeat notification.

The next automatic [run 37883853268](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/37883853268)
started at `04:26:03Z`, 4 minutes 51 seconds later. All 162 tests, typecheck,
and the scoped guard passed again. Eleven sources were OK, including Toronto's
AC-only computer discovery. Paper hit its existing SiteGround challenge within
the one-hour grace period, approximately five minutes after its last successful
check; its snapshot was preserved and the workflow succeeded. This is an
accepted degraded paper observation, not twelve successful fresh scrapes or a
permanent repair to the paper challenge.

A final read-only query at `04:27:06.308Z` authenticated as `tcf_slot_monitor`.
All 13 non-paper availability/reminder rows refreshed in the `04:26` cycle;
paper retained its successful `04:21:34.256Z` snapshot. Its separate health
record reported `lastSuccessAt=04:21:34.262Z`,
`firstChallengeAt=04:26:25.585Z`, and no incident failure marker.
North York paper had `checked_at=04:26:33.239Z` and the unchanged
`notified_at=04:11:37.288Z`, confirming no repeated notification after its
verified initial delivery. Toronto computer's valid empty snapshot refreshed
at `04:26:25.270Z`; the false parent entry is gone.

The scoped repairs are deployed and verified. The proposed date/month alert
policy for Ashton, Calgary, and Halifax is **not implemented** while awaiting
the user's preference. No temporary local automation was resumed for this audit;
the existing production timer remains active.

## Coverage standard for future assessments

A health conclusion must combine execution with independent source coverage:
follow the centre's current official booking links, inspect the actual public
registration interface, reconcile all pages and exam formats against scraper
output, and compare actual Discord messages with the applicable notification
policy. An empty/fresh snapshot, matching maximum date, passing fixtures, or a
green workflow by itself is insufficient. Preserve unknown snapshots and label
historical gaps as unknown when the earlier source data was not captured.
