# Toronto paper connection interruptions — October 12, 2026

## Mail and production evidence

Native macOS Mail showed the latest TCF failure email at **09:57 China time**,
linking to [38193803465](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/38193803465).
The preceding email on the current commit was **October 11 at 09:57**, linking to
[38103481160](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/38103481160).
Older search results included the already-repaired Winnipeg incident. GitHub's
October 12 midnight-to-noon window contained **144 runs: one failure and 143
successes**. The inspected preceding 24 hours, ending at 16:36, contained **288
runs: one failure and 287 successes**. Actual creation gaps were 260–342 seconds,
averaging 300 seconds. This does not establish the cause of any unrelated emails.

Both daily failures were limited to Toronto paper's CM category 368 request:
`request failed — fetch failed`, after the existing three attempts. All other 11
sources and the scoped database guard passed. Each request failed after roughly
10.5 seconds, before the monitor's 20-second deadline. Old logging discarded the
native cause, so a connect timeout, DNS failure, or a specific upstream maintenance
event cannot be proven from these logs. Near-identical timing suggests a recurring
network/upstream interruption, but remains an inference.

| Date, China time | Failed run creation | Next automatic recovery |
| --- | --- | --- |
| October 11 | 09:55:59, [38103481160](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/38103481160) | 10:01:30, [38103788068](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/38103788068), all 12 sources OK |
| October 12 | 09:56:01, [38193803465](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/38193803465) | 10:01:26, [38194165339](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/38194165339), all 12 sources OK |

The latest initially inspected runs at **16:26**, **16:31**, and **16:36** passed
176 tests and the restricted `tcf_slot_monitor` guard with zero forbidden
privileges. Runs [38223541951](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/38223541951)
and [38224564004](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/38224564004)
passed all 12 sources. The middle run,
[38224083981](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/38224083981),
had the recognized paper SiteGround challenge within its five-minute grace, with
the other 11 sources OK. This is recovery evidence, not a permanent access repair.

A read-only transaction at **16:42:40.632 China time** confirmed all 14
availability/reminder rows refreshed during the 16:41 cycle. Toronto paper's
separate health row recorded success at `2026-10-12T08:41:36.164Z`, with both
incident markers null. Winnipeg retained nine dates and its October 11 recovery
notification timestamp. No availability was manually overwritten.

## Approved repair

The user explicitly approved applying the existing **one-hour grace and one
failure per outage** to confirmed temporary Toronto paper connection failures.
This is a narrowly expanded alert policy, not a repair to the upstream network.

- Only the paper CM category-368 listing is eligible, and only after all three
  existing attempts fail with validated temporary transport evidence.
- Generic `fetch failed` without a recognized native cause remains an immediate
  workflow failure. Old incidents cannot be retroactively classified as temporary
  from their incomplete logs.
- Authentication, certificate, HTTP, parser, incomplete-data, other-centre,
  database, Discord, and health-state failures keep their existing immediate
  failure behavior.
- Accepted degradation preserves the availability snapshot and remains visible
  in the workflow summary. Challenge and temporary-connection failures share one
  outage clock; switching between them does not restart the hour or issue another
  alert. Only a successful paper scrape and persistence rearm the incident.
- The existing version-1 health record is retained. Its legacy
  `firstChallengeAt` field now marks either accepted failure kind; no migration or
  additional database permissions are required.
- Fixed allowlisted error names/codes improve future diagnosis without logging
  arbitrary native messages, endpoint addresses, or nested sensitive data.

All **186 offline tests**, typecheck, and whitespace checks pass. Regression
coverage exercises all allowed codes, the request's own deadline, unknown and
certificate errors, mixed attempts, nested mixed errors, diagnostic sanitization,
and the configured scraper-to-orchestrator path. Incident tests cover the exact
one-hour boundary, one failure per outage, switching between accepted causes,
state preservation, recovery rearming, and failure of health-state persistence.

Normal automatic production follow-up is pending. No manual production dispatches,
live local pipeline, credential changes, or broader infrastructure changes are
used.
