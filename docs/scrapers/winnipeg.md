# Winnipeg — AF Manitoba published availability

| | |
|---|---|
| Centre | Alliance Française du Manitoba, 934 Corydon Ave, Winnipeg, MB R3M 0Y5 |
| Listing | https://www.afmanitoba.ca/en/exams/tcf/ |
| Registration form | https://www.afmanitoba.ca/en/exams/tcf/register-tcf-canada/ |
| Platform | Public Oncord HTML announcement and registration form |
| Discord | Existing BonTCF server, [#winnipeg](https://discord.com/channels/1484038585907810535/1557954285474685010), Winnipeg Bot |
| Secret | GitHub Actions encrypted `DISCORD_WEBHOOK_WINNIPEG` |
| State | `city=winnipeg`, `exam_type=TCF Canada` |
| Notification strategy | New dates relative to the preceding successful snapshot |

## Source contract and limits

This centre offers TCF Canada and an online registration form. Its public page
publishes dates and availability (sometimes numeric remaining places), but the form does not expose live checkout
inventory or a session selector before submission. Registration requires the
form, payment, and centre confirmation. The monitor never submits the form,
reserves places, or makes payments.

The scraper performs one GET with an honest monitor User-Agent, a 20-second
timeout, and redirects disabled. It requires TCF Canada page context, one
`Next sessions` section, and the exact linked same-origin registration form.
Positive, explicit seat counts in the original session headings become slots.
The October 10 variant instead publishes a positive `New dates: spots available!`
banner followed by a line-separated date list; those slots omit `availableSeats`
because the centre gives no numeric counts. Since October 11, this branch follows
semantic text lines rather than requiring two heading elements: headings,
paragraphs, lists, containers, and `<br>` can delimit dates. It still requires the
anchored notice and positive banner, exact refund disclaimer as the list boundary,
and the same validated registration link. Bare dates without that positive context
remain unknown and throw. The next-announcement date, when present, is outside
the original session boundary and is never treated as an exam date or reminder.

Month/day spelling is normalized; a missing year stays missing. An explicit
year is retained. Duplicate or impossible dates, ambiguous sections, changed
links, unrecognized text, malformed availability, network errors, and challenge
pages throw. The orchestrator then preserves the previous source snapshot and
fails the workflow while continuing other sources. Explicit zero/full/closed
session entries and narrowly recognized empty notices can produce an empty
snapshot; a blank section cannot. Empty-state variants have regression coverage
but had not been observed live at initial deployment.

Winnipeg messages say **官网公布余位**, include both official links, and explain
the year/registration limitations. They do not claim a reservation is confirmed.
Seat-count changes alone do not repeat a date's alert. New or returning dates
are eligible under the existing per-date strategy. State advances only after
Discord acknowledges a due notification; unchanged successful checks still
refresh `checked_at`.

## Channel permissions and secret handling

The channel belongs to the existing **考场通知** category and is permission-synced.
All 26 selected `@everyone` overrides were compared with the existing Ashton
channel through Discord's UI and matched exactly: viewing, reading history,
and reactions allowed; sending messages, sending within threads, creating
public/private threads, attachments, application posting, and management denied.
No existing category, role, or location-channel permissions were changed.

The channel-specific webhook was created in the logged-in Discord browser and
stored in the GitHub encrypted secret at `2026-10-09T03:16:42Z` (11:16:42 China
time). Its value was not printed or written into the repository. The owner-only
temporary transfer file was removed after secret-name/timestamp verification.
No database grants, schema migrations, Worker credentials, or BonTCF application
settings are needed for this source.

## Initial verification — October 9, 2026

The actual public listing and standalone read-only scraper returned:

| Published date (year absent) | Published places |
|---|---:|
| November 3 | 1 |
| November 4 | 2 |
| November 10 | 1 |

The page separately announced its next dates for October 9, 2026 at 5 PM;
it did not explicitly state the timezone. This is not an exam sitting.

All **124 offline tests**, typecheck, and whitespace checks passed before
shipment. Tests cover the extracted real HTML, unknown/error/empty states,
notification wording, and the real configured source's per-date deduplication.
No local live pipeline or extra manual production run was used.

## Production verification

Commit `c8cda6f` added the source; `eadd799` made the missing-year caveat
conditional so future explicitly dated listings remain accurately described.
Automatic run [37878868996](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/37878868996)
was created at 11:21:06 China time on October 9. It passed 124 tests, typecheck,
all 12 real sources, and the scoped database guard with zero forbidden
privileges.

Discord acknowledged message `1557956207556427819` at 03:21:49 UTC. Its three
dates, published seat counts, official links, and registration caveat were
verified in the actual existing BonTCF channel through the browser. A read-only
query as `tcf_slot_monitor` at 03:23:41 UTC confirmed the same three slots and
`checked_at = notified_at = 2026-10-09T03:21:49.454Z`.

The next automatic run, [37879252714](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/37879252714),
started at 11:26:02 China time on `eadd799`. All 124 tests, typecheck, the
scoped guard, and all 12 sources passed. Winnipeg reported `3 → 3`, with
no repeat Discord send. The observed start interval was 4 minutes 56 seconds.
The third automatic run, [37879655582](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/37879655582),
started at 11:31:18 China time, 5 minutes 16 seconds after the second. It also
passed 124 tests, typecheck, the scoped guard with zero forbidden privileges,
and all 12 sources. Winnipeg again reported `3 → 3` without a Discord send.

| Run | Creation (China time, October 9) | Revision | Sources |
|---|---|---|---|
| 37878868996 | 11:21:06 | c8cda6f | 12/12 OK; first Winnipeg notification accepted |
| 37879252714 | 11:26:02 | eadd799 | 12/12 OK; unchanged dates did not notify |
| 37879655582 | 11:31:18 | eadd799 | 12/12 OK; unchanged dates did not notify |

Final read-only verification at `2026-10-09T03:32:32.097Z` authenticated as
`tcf_slot_monitor`: all **13 availability/reminder rows**, excluding health
metadata, refreshed between `03:31:36.365Z` and `03:31:43.840Z`. Winnipeg held
three slots with `checked_at=03:31:43.840Z` and its original
`notified_at=03:21:49.454Z`. Toronto paper's separate health row recorded success
at `03:31:36.614Z` with both incident markers null.

The three-cycle steady-state check is complete. These observations establish
current functioning and deduplication, not a guarantee against future source
changes or a permanent fix for Toronto's intermittent upstream challenge.

## October 10 source-layout incident — repair deployed

Run `38018467059` reported `Next sessions boundary missing; state must be
preserved`. A fresh public GET reproduced the underlying change: the centre
removed its next-announcement heading and the per-date seat counts. Its current
`Next sessions` card has a positive **spots available!** banner, then eight dates
in one heading separated by `<br>` tags, followed by the refund disclaimer and
the same registration link:

- November 19, 23, 24, 25, 27
- December 1, 2, 4

The source does not state years or remaining counts for those dates. The repair
keeps both absent rather than guessing, while preserving the published
availability wording and registration caveat. The previous parser's exception
was the correct conservative response to unknown markup; it did not establish
that no slots existed or erase the preceding snapshot.

The new branch recognizes only the captured positive-list shape. Changed or
negated availability, missing/duplicated disclaimer, extra unknown text,
missing registration context, duplicate/impossible dates, and an empty list
still throw. Explicit `hidden`, `aria-hidden="true"`, `display:none`, or
`visibility:hidden` markup anywhere in the selected session section also
rejects the snapshot rather than treating hidden offers as available or empty.
Unrelated hidden markup elsewhere on the page does not affect this check.
The previous counted-date and explicit-empty variants retain
their regression coverage. The captured fixture includes only public TCF page
context and the relevant session section, without scripts or personal data.

All **14 Winnipeg regression tests** and typecheck pass locally. Commit
`11988cc` shipped the repair. Automatic run
[38019365047](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/38019365047)
passed all 12 sources and delivered the eight-date notification, independently
read back in the existing Discord channel at 11:06 China time. A read-only query
confirmed eight saved slots without seat counts or years, after Discord acceptance.
The next automatic run, `38019663218`, again passed all 12 sources and reported
`8 → 8` without a Discord send. A third run, `38019960548`, repeated that result;
the final read-only check confirmed fresh state and the original notification
timestamp. See the
[October 10 incident record](../health-assessment-2026-10-10.md) for delivery
links and the complete production follow-up.

## October 11 formatting recurrence

The date-only announcement was reformatted from one heading into individual
paragraphs and gained October 20, bringing its list to nine dates. The wording,
disclaimer, and registration link stayed unchanged. Requiring two headings was
too restrictive; commit `3fbea3e` replaces that requirement with bounded semantic
text lines while retaining the positive-availability and unknown-state checks.
Prior date IDs stay identical, so only October 20 is newly eligible for an alert.
See the [October 11 incident record](../health-assessment-2026-10-11.md) for the
Mail-backed diagnosis, regression tests, and production verification.

## Read-only debugging

```bash
npx tsx scripts/scrapers/winnipeg.ts
npm test
npm run typecheck
```

```sql
SELECT city, exam_type, slots, checked_at, notified_at
FROM public.slot_monitor_state
WHERE city = 'winnipeg';
```
