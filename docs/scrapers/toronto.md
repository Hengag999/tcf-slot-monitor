# Toronto scraper — health log

| | |
|---|---|
| **Platform** | E-TCF: Active Communities category 30, including every advertised child through its public `activities/subs/{id}` endpoint. P-TCF: official CM category 368. Positive candidates require concrete AC activity detail. |
| **Diff strategy** | 0 → N per exam type. Computer and paper have separate scrape outcomes, sharing Toronto's existing DB city key and Discord destination. |
| **Page** | [Official registration page](https://www.alliance-francaise.ca/en/exams/tests/informations-about-tcf-canada/tcf-canada) |
| **Discord** | #toronto |
| **DB keys** | city=`toronto`, exam_type=`E-TCF Canada` and `P-TCF Canada` |
| **Status** | **October 9 production verification complete:** computer traverses the public AC parent/child hierarchy and excludes nonbookable parent aggregates. Two final scheduled runs verified five parents, three Full children, and zero bookable exams without CM computer access. Paper succeeded on the first and hit its accepted challenge grace on the second; its policy remains unchanged. |

## Current behavior

- `scrapeTorontoComputer()` reads every page of AC category 30, separating E-TCF from P-TCF. Every E-TCF parent is traversed regardless of its own status. The public frontend's `activities/subs/{parentId}` call receives its advertised child IDs with `open_spots=0`. Child counts, IDs, formats, metadata, page counts, and uniqueness must all agree. Empty parents contribute no candidates. Incomplete traversal, nested/unexpected children, and failed requests invalidate the whole computer snapshot.
- `scrapeTorontoPaper()` independently reads CM category 368 with the public site's filters and 300-row limit. The response must explicitly report page 1, the requested limit, and a total equal to the returned count, below 300. Missing/invalid metadata, duplicate IDs, wrong categories/formats, and records contradicting the requested status/open-space filters fail instead of becoming an empty snapshot. Paper discovery cannot be replaced with AC search because its hidden records are not covered there.
- Explicitly closed computer child rows are not candidates. Every remaining computer candidate and every CM paper candidate must have a matching AC detail ID, explicit `is_parent_activity=false`, and readable `space_status`. Unexpected parent detail fails the source rather than producing a false alert. At most five detail requests run concurrently. Dates prefer detail `first_date`, falling back to the validated concrete AC activity number or CM sitting date. Reported seat counts come from confirmed AC detail.
- The orchestrator calls these independently and restricts each snapshot to its own exam type. A failed paper source must preserve its previous row and must not prevent computer monitoring. Returning an unscoped partial Toronto array would be unsafe: missing exam types would otherwise be cleared by the orchestrator.
- The retained `scrapeToronto()` aggregate rejects if either source fails. The standalone script uses both independent sources, prints each outcome and surviving results, and exits nonzero if coverage is incomplete.
- Requests have a 20-second timeout and at most three attempts. Network failures, HTTP 429/5xx, and non-JSON responses are retried. Other HTTP errors such as 403 fail immediately. Requests identify themselves as `TCF-Slot-Monitor/1.0 (+https://github.com/Hengag999/tcf-slot-monitor)`; no cookies, clearance tokens, or browser runtime are required for the verified local result.
  The recognized CM paper HTTP 202 HTML SiteGround challenge is now an exception:
  it stops after one request and lets the next scheduled run try again. Earlier
  blocked runs repeated the same challenge on both immediate retries. This cuts
  those unsuccessful requests; it does not establish a permanent access repair.
- Missing list arrays, unsuccessful AC response envelopes, malformed rows, truncated/duplicate discovery, failed detail calls, missing detail status/parent metadata, and unknown status text are **unknown availability**, not a known-empty result. They fail that exam type so persistence can retain its previous state.
- Explicit closed statuses include full, on hold, closed, cancelled, waitlist, sold out, and not open. Positive detail handling accepts numeric openings/spaces/spots/seats, `Open`, `Available`, and `Unlimited openings`. New wording fails visibly rather than assuming a vacancy. `Unlimited openings` was observed on public non-exam AC activities in this assessment; an actual open E-TCF sitting was not available for end-to-end confirmation.

## Entry-point reconnaissance — 2026-10-06

The official registration page still renders `<load-courses>` with CM categories **367** (E-TCF) and **368** (P-TCF). Its public client, `/media/com_aftcm/js/loadcourses/loadcourses.js`, calls `https://cm-api.alliance-francaise.ca/groupcourses` directly using `enddate=gte`, `status=0`, `openspaces=1`, `limit=300`, and the category. There was no alternative paper endpoint in that client.

The original paper request returned HTTP 403 locally, reproducing the reported CI failure. The logged-in browser could read the same public endpoint, which prompted a bounded ordinary-header comparison. Interleaved requests to the same URL in the same Node process yielded:

| User-Agent | Result |
|---|---|
| Existing Chrome/124 Windows string | HTTP 403 on both interleaved attempts |
| Chrome/145 macOS string | HTTP 200 JSON |
| Chrome/145 Windows string | HTTP 200 JSON |
| Honest `TCF-Slot-Monitor/1.0` identifier | HTTP 200 JSON |

The honest identifier is now used. It required no Origin/Referer override, cookies, private credentials, clearance tokens, or browser dependency. These results isolate the old User-Agent as a trigger in the local test; they do not establish every rule used by the server or guarantee future/GitHub access.

A successful page load alone does not validate its session lists: the page's Angular error handler sets `loading=false` without reporting the failed request to visitors.

Active Communities was reachable:

- Category `30`: one E-TCF sitting, ID **129462**, number **TCFC091026-MS**, date **2026-10-09**, list status **Full**, **14/14** enrolled. Its detail independently reported `first_date=2026-10-09` and `space_status=Full`.
- Searching `activity_other_category_ids=["368"]`, keyword `P-TCF`, and keyword `paper` returned successful empty lists. This is **not proof of complete paper coverage**, so these were not adopted as a fallback. Raw CM records show that paper also belongs to category 30; the absence from AC search is consistent with its current On Hold/hidden state, not proof of a separate booking system.
- Searching keyword `TCF` also returns preparation/orientation products. Those must not be mistaken for exam availability.
- With the repaired User-Agent, CM's filtered paper response was `{items: [], page: 1, totalItems: 0, limit: "300"}`.
- Removing availability/date/status filters from CM category 368 returned 44 records. Four were future paper exams: October 23 (IDs 129194, 129197) and November 13 (129199, 129201). All four had zero open spaces and status 4, and each independent AC detail reported **On Hold**. This supports the current empty filtered result and confirms that the paper category still contains future exams.
- CM paper times can be `9:00:00`; output normalizes this to `09:00` rather than slicing it into the malformed `9:00:`.

### Possible additional service: registration-release reminders

The official page publishes the following **2027 quarterly registration opening dates, at 10:00 a.m.**:

| Quarter | Registration release |
|---|---|
| Q1, Jan–Mar | December 1, 2026 |
| Q2, Apr–Jun | March 2, 2027 |
| Q3, Jul–Sep | May 20, 2027 |
| Q4, Oct–Dec | August 17, 2027 |

A reminder for these releases would be useful independently of cancellation-seat monitoring. The page does **not explicitly name a timezone**. No reminder parser, hardcoded epochs, or automatic notifications were added on an assumed timezone. Confirm the timezone and whether the release dates apply uniformly to both formats before implementing; reread the live schedule rather than treating this dated table as permanent configuration.

## Verification — 2026-10-06

- `node --import tsx --test tests/toronto.test.ts`: **17 passing checks**, covering independent source failure, refusal of aggregate partial snapshots, valid empty states, malformed/error envelopes, pagination completeness, detail confirmation and failure, status/date safety, paper date/time handling, and prevention of paper-to-computer mislabeling.
- Targeted TypeScript check of scraper and tests passed with ES2022/NodeNext.
- Before the User-Agent repair, the live standalone printed the surviving computer result plus paper HTTP 403 and exited **1**, verifying partial-failure reporting. After the repair, computer completed with **1 listed sitting, 0 candidates, 0 available** and paper completed with **0 bookable sessions**; final exit code **0**. GitHub runner access and actual open-session notification delivery remain unverified.
- No database writes, Discord messages, commits, or deployment were performed by this Toronto change.

## Historical incidents

### 2026-10-07 — intermittent paper HTTP 202 during timer verification

[Run 37572653129](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/37572653129) received `HTTP 202, text/html` on all three CM paper attempts at 04:41:33–38 UTC. The second and third responses arrived roughly 20–40 ms after their retry delays. Toronto computer and the other nine source checks passed; paper state was preserved. The preceding five-minute run, [37572248671](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/37572248671), passed. The same failure was also recorded by the old native schedule before the external timer, so increased frequency has not been established as its cause.

At 04:43:16 UTC the exact same ordinary public CM request from the local machine returned HTTP 200 JSON with `items: []`. Response metadata included `server: nginx`, `cache-control: no-cache, private`, and `x-proxy-cache: MISS`. The official registration page and its public course loader still use category 368 on the same CM endpoint. There is no newly validated complete replacement for paper discovery.

This is consistent with an intermittent edge challenge, but status and content type alone do not identify one. [SiteGround documents IP/User-Agent CAPTCHA decisions](https://www.siteground.com/kb/seeing-captcha-website), and [InfiniteWP's official support article](https://support.infinitewp.com/support/solutions/articles/264882-http-error-202-accepted-the-request-is-accepted-for-processing-but-the-processing-is-not-complete) documents SiteGround challenges returning HTTP 202. Neither establishes the cause of this specific response or a retry interval that would fix it.

Non-JSON failures now log fixed challenge classifications when known signatures are present, body character count, and allowlisted server/cache/numeric Retry-After metadata. They never log the response body, cookies, challenge tokens, or arbitrary header values. Unrecognized HTML remains `classification=unclassified`. Request headers, three-attempt limit, delays, and state-preservation behavior are unchanged. This addition improves diagnosis; it is not a verified access repair. Targeted tests cover failed-snapshot preservation, bounded logging, and a later valid JSON recovery.

At **05:26:06 UTC**, [run 37576283529](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/37576283529) reproduced the paper failure with `classification=siteground-challenge`, HTTP 202, a 293-character HTML body, and allowlisted `server=nginx`. Unlike the earlier generic HTML evidence, this response contained a recognized SiteGround challenge signature. The scoped database permission guard and the other ten source checks passed; paper state remained at its prior successful snapshot.

Follow-up public API reconnaissance found `hide_on_internet=true` on all 44 CM paper records, including the four future sittings. The official Active Communities client supports both future/in-progress and past-six-month search options; complete category-30 paper searches under both options returned zero records. That search therefore cannot establish complete paper discovery and was not adopted as a fallback. Changing CM query parameters does not establish a repair for an upstream access challenge. Continue preserving state on failures and checking subsequent normal runs; no challenge-solving, clearance tokens, or broader permissions were introduced.

The same challenge recurred in [run 37576736775](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/37576736775) at 05:31:35 UTC. The next scheduled [run 37577126084](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/37577126084) at 05:36:10 UTC recovered without scraper changes, passed all 11 sources, and refreshed paper state. This supports intermittent upstream behavior, not a permanent fix. Temporary post-deployment monitoring remains active.

### 2026-06-13 — hybrid source migration

E-TCF previously used CM category 367. The then-current reconnaissance found that category held an old “E-TCF – 5 modules” product with past sessions, while current “4 modules” exams lived under Active Communities category 30. Moving E-TCF discovery to AC exposed 32 then-future sittings. That count is historical, not an expected minimum.

### 2026-06-13 — intermittent CM challenge

GitHub runner requests received HTML challenges with HTTP 200, freezing Toronto state while the overall workflow stayed green. Browser-like headers plus retries allowed the tested follow-up run (`27460062153`) to complete. The later Chrome/124-triggered 403 demonstrates that this was an observed workaround, not a guarantee that a browser-looking header permanently restores access.

## Debug recipe

### Known paper challenge and failure-email policy — October 7, 2026

The user accepts intermittent Toronto paper checks. Only a typed
`TorontoPaperChallengeError` from CM category 368 receives the following policy;
it requires HTTP 202, HTML, and a recognized SiteGround signature. Generic HTML,
401/403 responses, malformed data, computer/detail failures, and errors from other
cities remain immediate workflow failures. Database and Discord failures also
remain immediate failures.

- Less than one hour since the last successful paper check: show `DEGRADED` in
  logs and the GitHub source summary, preserve paper availability state, and do
  not fail the workflow for that challenge.
- At or beyond one hour: fail one workflow run for the sustained challenge.
  Later occurrences remain visibly degraded but do not repeat that failure until
  a successful paper check rearms the policy. This records issuing a workflow
  failure, not a receipt proving GitHub delivered an email.
- A successful scrape must finish its notification/persistence work before it
  resets the incident. A failed health-state read/write fails the workflow too.
- Standalone/dry-run checks remain strict: without production history they report
  the challenge as an error and perform no health-state writes.

Health metadata lives in the existing monitor table under reserved key
`(__monitor_health__, toronto/paper)`, separate from the actual Toronto availability
rows. It stores version, last success, first challenge, and failure-reported times.
Existing paper `checked_at` bootstraps the policy; if no successful snapshot exists,
the first observed challenge starts the hour. No schema changes or new database
permissions are needed. GitHub's existing concurrency group serializes updates.
An overall successful workflow can therefore contain a tolerated degraded paper
source; inspect its source summary for coverage.

The official registration page and public course loader were rechecked while
making this change and still use the same CM endpoint. Active Communities search
is not a complete fallback for hidden paper records. There is no verified code-only
fix for the host's access challenge. A provider-approved feed or site-owner-approved
API access would address that issue more directly; changing headers, query strings,
or hosts merely to evade the challenge is not part of this implementation.

### Alert-policy shipment verification — October 7, 2026, 14:18 China time

Commit `c4f0b71` shipped the reduced challenge retries and one-hour alert policy.
[Scheduled run 37580615700](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/37580615700),
created at 06:16:27 UTC / 14:16:27 China time, passed **109 tests**, typecheck,
and the scoped credential guard with zero forbidden privileges. Its real Toronto
paper request received the known challenge and reported `DEGRADED — within
one-hour grace period; state preserved` at 10 minutes without success. The
workflow succeeded and the other ten sources were OK.

A subsequent read-only database check confirmed paper `checked_at` remained
`2026-10-07T06:06:30.914Z`. The separate health row recorded that same last success,
the first challenge at `06:16:46.215Z`, and no failure-issued marker. The other 11
availability/reminder state rows refreshed during the new cycle. No credential,
schema, or grant change was required. The exact one-hour boundary, suppression of
repeated incidents, recovery/rearming, and immediate failure of other errors are
covered by offline regression tests; the one-hour threshold has not been forced
in production. Temporary follow-up monitoring remains active.

### Temporary monitoring completed — October 7, 2026

Three later consecutive scheduled runs on `8bf5fae` passed all **11 sources**, all
**109 tests**, and the scoped credential guard with **zero forbidden privileges**:

| Creation time (China time) | Run | Toronto paper |
| --- | --- | --- |
| 14:26:10 | [37581478902](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/37581478902) | OK |
| 14:31:39 | [37581984964](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/37581984964) | OK |
| 14:36:16 | [37582424766](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/37582424766) | OK |

The final read-only state check found paper `checked_at=06:36:33.701Z`, health
`lastSuccessAt=06:36:33.718Z`, and both incident fields reset to null. The other
11 availability/reminder rows refreshed between `06:36:33.437Z` and
`06:36:41.073Z` (UTC). This verifies recovery and rearming after the two tolerated
challenge runs; it does not prove SiteGround's intermittent challenge is fixed.

The agreed stop condition was met. Local Codex automation
`tcf-timer-steady-state-check` was confirmed **PAUSED at 14:37:58 China time**.
The production Cloudflare timer and GitHub workflow remain enabled, with the
one-hour challenge policy still active. Moving production execution off GitHub
Actions remains a separate pending recommendation, not a completed migration.

```bash
# Both sources, no DB writes or Discord, explicit partial-failure exit status:
node --import tsx scripts/scrapers/toronto.ts

# Regression checks, entirely mocked network:
node --import tsx --test tests/toronto.test.ts

# Source and persistence errors in a specific GitHub run:
gh run view <run-id> --log | rg -i toronto
```

Read DB freshness per exam type, not only per city. A fresh E-TCF row does not establish P-TCF health. Recheck the live source counts and current workflow logs; neither Discord silence nor a previously green CI run independently proves complete coverage.


## Shipment verification — 2026-10-06 21:18 China time

The repairs are deployed on `master`. [GitHub run 37469738669](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/37469738669) passed all source checks and refreshed stored state. See `docs/health-assessment-2026-10-06.md` for the first-run Discord timeout, verified message reconciliation, and final production evidence. Earlier local-only/pending-deployment statements above describe the pre-shipment assessment.

## Independent coverage audit — 2026-10-09

The official TCF registration page and its public course loader were re-read rather
than relying on the current scraper endpoint. The page still uses CM categories
**367 for E-TCF** and **368 for P-TCF**, with no campus restriction and the same
300-row, future/open-space/status filters. The page also still publishes the 2027
quarterly release schedule described above.

A bounded standalone check, with no database writes or Discord sends, observed:

- **Computer:** AC category 30 reported one complete page with **five E-TCF rows**.
  Four were explicitly Full or On Hold. Activity **129464**, October 16, had an
  Enroll Now action in its public list response and detail status **1 opening
  remaining**. The scraper returned that same activity and one seat. Its detail
  marks it as a parent activity; API space count alone does not establish that a
  registration can be completed. Browser inspection of the public booking flow is
  recorded separately when available.
- **Independent computer comparison:** the official CM category 367 result listed
  two October 23 child activities, **129585** and **129702**, each advertising one
  open space. Both independent AC details reported **Full**, so neither was a
  confirmed vacancy. This disagreement is concrete evidence against trusting CM
  `open_spaces` alone. These IDs were absent from the top-level AC result rows;
  the follow-up below established that both were advertised in those parents'
  `sub_activity_ids`. The first inspection failed to follow that hierarchy.
- **Paper:** the actual filtered request returned **HTTP 200 JSON, zero items**.
  The unfiltered category contained 44 records, including four future activities
  (**129194, 129197, 129199, 129201**) on October 23 and November 13. Each had zero
  CM open spaces and an independent AC detail status of **On Hold**. This supports
  the current known-empty result. It does not prove that paper access is permanently
  repaired or that an empty AC search can replace CM discovery.

No challenge-solving, private account access, bookings, credentials, or production
state changes were used. This is a dated successful source observation. The existing
paper challenge alert policy remains unchanged, and unknown failures still preserve
the previous snapshot and fail immediately.

### Parent-activity false positive and initial CM repair — October 9

The browser cross-check resolved the limitation above: opening the purported
October 16 booking URL for parent **129464** redirected to the public activity
search. Its matching E-TCF card said **No sub-activities** and offered no enrollment
action. The API's one remaining opening was therefore not a usable booking option.
This was a confirmed false positive, despite successful scraper execution and a
positive `space_status`. It does not establish how long the parent lacked children.

The first repair used the official CM **367** feed and validated its actual
child activities through AC detail. The public CM response's two positive-space
children were both **Full** in AC. A live standalone check after the repair accepted
the real CM metadata and returned **0 computer / 0 paper bookable slots**, with no
database or Discord writes. A successful ordinary production run can consequently
clear the stale parent snapshot; failed discovery or detail must preserve it.

That introduced a computer dependency on the same CM host already used by paper. If computer
CM access fails or receives a challenge, that source fails immediately under the
existing policy. The one-hour grace and one-failure-per-outage rule remains scoped
only to the recognized paper category-368 challenge; it was not broadened here.

Validation: all **24 Toronto tests** passed, including the sanitized real CM/AC
fixture, the actual orchestrator configuration, parent rejection, valid child
availability, incomplete/malformed response rejection, source isolation, and
preserving the prior computer snapshot on request failure. The complete TypeScript
check passed. The fixture contains only public exam fields and no student records,
credentials, or private HTTP headers. An actual newly bookable child and notification delivery
remain to be observed; a mocked positive case is not production delivery evidence.

### Follow-up: traverse the genuine public AC hierarchy — October 9

The first production run on `4660c3b`, [37882682731](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/37882682731),
received the recognized SiteGround HTTP 202 response on the new computer CM
request. Computer failed immediately and preserved its prior snapshot; paper was
within its existing grace period. This exposed the practical access cost of the
first repair. No broader grace policy or challenge workaround was introduced.

The public booking app's JavaScript, `app.index.f8c1b1ed.js`, documents its genuine
child-discovery flow: `POST /rest/activities/subs/{parentId}` with the parent's
advertised `sub_activity_ids`, an empty transfer pattern, and `open_spots: 0`.
The same client defines selection 2 as in-progress-or-future and selection 0 as
future; these are date filters, not switches between parent and child records.

A fresh public category-30 response contained five E-TCF parents. Three explicitly
advertised one child each despite their parent status being On Hold:

| Parent | Advertised and returned child | Child status |
| --- | --- | --- |
| 129582 | 129585 | Full |
| 129586 | 129587 | Full |
| 129700 | 129702 | Full |

All three child calls returned successful envelopes with complete count/ID matches.
This includes both computer candidates independently discovered on official CM367,
plus one additional Full activity. Parents 129462 and 129464 advertised zero
children; neither is a bookable candidate even if its aggregate reports space.
The old code's error was skipping closed parents and treating an empty parent as
an exam. The public child IDs were present in its response all along.

The follow-up computer implementation uses this AC hierarchy directly, with no CM
computer request or fallback. A live read-only standalone check accepted all five
parents and three children and returned zero bookable computer activities. The
scope is the current public computer catalogue; this does not prove completeness
of the separate hidden paper catalogue. It also does not guarantee future booking
success or treat a green workflow as evidence of a notification receipt.

All **30 Toronto regression tests** and the complete TypeScript check passed.
Coverage includes the real hierarchy fixture, actual orchestrator wiring, a closed
parent with a bookable child, empty-parent exclusion, full pagination, missing or
wrong child IDs, duplicates, failed subrequests, and preservation of prior state.
Positive child availability remains an offline test until a real opening is
observed. Production verification of this follow-up is recorded separately.
