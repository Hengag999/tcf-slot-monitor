# Toronto scraper — health log

| | |
|---|---|
| **Platform** | E-TCF: Active Communities `activities/list` category 30. P-TCF: Alliance Française CM `/groupcourses` category 368. Both confirm candidates against the AC detail API. |
| **Diff strategy** | 0 → N per exam type. Computer and paper have separate scrape outcomes, sharing Toronto's existing DB city key and Discord destination. |
| **Page** | [Official registration page](https://www.alliance-francaise.ca/en/exams/tests/informations-about-tcf-canada/tcf-canada) |
| **Discord** | #toronto |
| **DB keys** | city=`toronto`, exam_type=`E-TCF Canada` and `P-TCF Canada` |
| **Status** | **Locally repaired, 2026-10-06:** both computer and paper sources complete with zero bookable slots. Old fixed Chrome/124 User-Agent caused reproducible CM 403; the honest monitor User-Agent receives JSON. GitHub runner behavior must be verified after deployment. |

## Current behavior

- `scrapeTorontoComputer()` reads all AC category 30 pages and selects explicit E-TCF products. Category 30 is shared by both formats: explicit P-TCF rows are ignored by this source, and unfamiliar product names fail visibly. It skips explicitly closed list rows, then confirms remaining candidates against `body.detail.space_status`, with at most five simultaneous detail requests. Dates prefer detail `first_date`, falling back to the validated `TCFC<DDMMYY>` activity number.
- `scrapeTorontoPaper()` reads the CM category 368 list and confirms every candidate through AC detail. Its query now matches the public site's 300-row limit. Reaching the limit is reported as incomplete coverage instead of silently accepting a potentially truncated list.
- The orchestrator calls these independently and restricts each snapshot to its own exam type. A failed paper source must preserve its previous row and must not prevent computer monitoring. Returning an unscoped partial Toronto array would be unsafe: missing exam types would otherwise be cleared by the orchestrator.
- The retained `scrapeToronto()` aggregate rejects if either source fails. The standalone script uses both independent sources, prints each outcome and surviving results, and exits nonzero if coverage is incomplete.
- Requests have a 20-second timeout and at most three attempts. Network failures, HTTP 429/5xx, and non-JSON responses are retried. Other HTTP errors such as 403 fail immediately. Requests identify themselves as `TCF-Slot-Monitor/1.0 (+https://github.com/Hengag999/tcf-slot-monitor)`; no cookies, clearance tokens, or browser runtime are required for the verified local result.
  The recognized CM paper HTTP 202 HTML SiteGround challenge is now an exception:
  it stops after one request and lets the next scheduled run try again. Earlier
  blocked runs repeated the same challenge on both immediate retries. This cuts
  those unsuccessful requests; it does not establish a permanent access repair.
- Missing list arrays, unsuccessful AC response envelopes, malformed rows, truncated/duplicate pagination, failed detail calls, missing detail status, and unknown status text are **unknown availability**, not a known-empty result. They fail that exam type so persistence can retain its previous state.
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
