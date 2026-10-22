# Halifax scraper — source and delivery record

| | |
|---|---|
| Platform | Alliance Française Halifax AEC registration widget |
| Official entry | `https://afhalifax.ca/test-your-french/tcf/tcf-canada-registration/` |
| API | `https://afhalifax.aec.app/api/v1/public/examinations/list/1/16` |
| State | city `halifax`, exam type `TCF Canada` |
| Alert policy | Zero-to-available; a switch to date diffs was proposed separately |
| Status | Source coverage and stricter response validation verified in two production cycles October 9; 17 current bookable sittings |

The official TCF page links the dedicated registration widget. Its published
configuration uses branch 1, examination type 16, and no period filter. These
URL components are branch/type IDs, not page/limit. An independent all-types
response and the frontend request construction confirm that all current TCF
Canada sittings are in this category.

On October 9 the API returned 29 sittings, of which 17 had explicit available
flags and enabled ADD TO CART links; 12 were full. The 17 IDs matched production
state exactly. The actual browser rendered the same TCF widget and booking
controls after asynchronous loading. No cart action or reservation was taken.

Dates with advertised availability were October 14–15 and December 2, 4, 7–9,
14–16. The latest observed Discord message was September 28 at
`15:03:52.051Z`, announcing November 6. Silence is therefore not evidence that
there are no new bookable dates: the zero-to-available alert policy suppresses
changes while any prior dates remain open. For example, October 14 now has an
October 7–11 registration window. Any policy change requires a separate decision.

## Response validation

The shared `src/lib/aecExaminations.ts` validates branch/type identity, complete
groups, explicit availability flags, dates/times, IDs, and known registration
actions. All valid groups are processed; malformed responses reject the whole
snapshot and preserve previous state. HTTP 204 and valid empty arrays remain
accepted. A blank HTTP 200 or `{}` is not an empty inventory.

This corrects a reproducible latent failure: both old AEC scrapers treated
HTTP 200 `{}` as zero exams. No malformed production response was observed in
this audit, so that defect is not asserted as the cause of the quiet channel.
Actual public fixtures cover all 29 records, later records beyond index 16,
wrong groups, unknown states, malformed data, and genuine empty responses.

See [the October 9 audit](../health-assessment-2026-10-09.md) for the release,
scheduled-run, and database verification record.

## October 22 origin timeout hardening

The public API-key page repeatedly returned HTTP 522, also observed in the actual
browser. Halifax now retries only that page's HTTP 522 at most three times, with
one-/two-second delays and fresh 20-second deadlines. Inventory validation and
its single API request remain unchanged. Exhaustion, transport errors, other
statuses and unknown data still fail and preserve state. This is bounded
resilience, not a repair of the upstream server. See the
[October 22 incident record](../health-assessment-2026-10-22.md).

The user then approved one-hour grace and one workflow failure per continuous
**key-page HTTP 522** outage, using separate `halifax/aec-key-page` health
metadata. The source stays visibly DEGRADED and preserves its snapshot. Successful
scraping plus delivery/persistence rearms the incident; all other errors and
health-storage failures remain immediate. This controls repeated emails during
the observed origin outage and does not restore access to the failed server.
