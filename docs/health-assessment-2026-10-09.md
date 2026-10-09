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
| Toronto | Paper's four future CM records have zero spaces; independent details show On Hold. Computer's AC search returned a parent with one apparent opening, but its browser page redirects to a group showing No sub-activities. | Repaired discovery uses official CM category 367 and validates concrete child details. Current two candidates are both Full; repaired local computer output is zero. |

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
