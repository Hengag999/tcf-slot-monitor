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
