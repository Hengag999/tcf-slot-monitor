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
publishes dates and remaining places, but the form does not expose live checkout
inventory or a session selector before submission. Registration requires the
form, payment, and centre confirmation. The monitor never submits the form,
reserves places, or makes payments.

The scraper performs one GET with an honest monitor User-Agent, a 20-second
timeout, and redirects disabled. It requires TCF Canada page context, one
`Next sessions` section, and the exact linked same-origin registration form.
Only positive, explicit seat counts in the session headings become slots.
The next-announcement date is outside the session boundary and is never treated
as an exam date or a reminder timestamp.

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
Production scheduled-run and Discord delivery evidence will be recorded below
after deployment. No local live pipeline or extra manual production run is used.

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
