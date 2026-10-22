# Ottawa scraper — source and failure handling

| | |
|---|---|
| Platform | Alliance Française Ottawa AEC widget, `afottawa.aec.app` |
| API | Public examinations branch 1, types 5 (computer) and 79 (paper) |
| State | City `ottawa`, separate `TCF Canada sur ordinateur` and `TCF Canada (papier)` rows |
| Alerts | Zero-to-available per format; state advances only after accepted delivery |
| Status | October 15 HTTP 500 recovered on the next automatic run; retry hardening shipped as `1d57bb8` and Ottawa passed three subsequent timer cycles |

The shared AEC parser validates branch and exam identity, complete group arrays,
dates/times, explicit availability flags, and allowed registration destinations.
Both formats must succeed for the scraper to return its combined snapshot. One
failed endpoint preserves both prior formats. HTTP 204 and validated empty arrays
are accepted empty states; blank HTTP 200 or malformed content is not.

Ottawa alone opts into three attempts for examinations GET responses with HTTP
500/502/503/504, with one- and two-second delays and fresh 20-second deadlines.
The API-key page remains a single request. Authentication errors, rate limits,
other statuses, transport exceptions, and parsing errors are not retried. A final
failure stays visible and cannot clear availability. This does not change the
notification strategy, Toronto's grace policy, or Halifax's behavior.

See the [October 15 incident record](../health-assessment-2026-10-15.md) for exact
failure/recovery runs, validation, and production verification. The site's own
HTTP 500 cause remains unknown; a successful later response is recovery evidence.
The three follow-up runs passed 191 tests and the scoped database guard. Ottawa
returned the same six computer dates and one paper date without retries or
duplicate notifications; a read-only check confirmed fresh state. The retry
branch itself is regression-tested, not yet observed handling another live 500.

## October 22 API-key-page 522

An observed HTTP 522 occurred before examinations requests. Ottawa now separately
opts into at most three key-page GET attempts for **522 only**, with one-/two-second
delays and fresh 20-second deadlines; non-522 key-page failures are still immediate.
The examinations API retry policy above is unchanged. Exhaustion still fails the
complete source and preserves both formats. See the
[October 22 incident record](../health-assessment-2026-10-22.md) for production
verification and the distinct Halifax/Ashton observations.

The user additionally approved one-hour grace and one workflow failure per
continuous **key-page HTTP 522** outage. Separate `ottawa/aec-key-page` health
metadata uses the older timestamp of both persisted formats as its baseline;
partial persistence cannot rearm the alert. Actual complete scraping and
successful notification/persistence reset the incident. The source remains
visibly DEGRADED on 522; every other error and health-storage failure remains
immediate. No availability snapshot is cleared by an outage.
