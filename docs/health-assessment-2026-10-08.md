# Failure-email investigation — October 8, 2026

## Observed production health

Read the GitHub failure notifications in the native macOS Mail application and
matched the 23:02 China-time message to [run 37797314632](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/37797314632).
Its failure was Calgary parsing; Toronto and the other sources passed.

The 287 completed runs created between October 7 15:08 UTC and October 8
15:06 UTC included 252 successes and 35 failures. Mean start interval was
299.9 seconds; the longest was 605 seconds, with one 12-second interval.
These are actual dispatch observations, not a scheduling guarantee. Every
failed run was inspected; regression-test mock errors were excluded.

| Failed runs | Real production error |
| --- | --- |
| 20 | Edmonton: missing booking status, affecting both availability and reminders |
| 10 | Shared Vancouver/Victoria listing: missing booking status for October 9 |
| 3 | Calgary: registration button outside the parser's expected container |
| 1 | Toronto paper: network failure after all three attempts |
| 1 | Ottawa: Discord request timed out; notification state retained for retry |

The known Toronto SiteGround challenge grace policy did not cause these
failures. Unknown errors and other sources still fail immediately as designed.
Repeated parser failures each produce a new failed job and therefore another
potential GitHub email. This is not evidence that every city stopped working.

Read-only database verification at approximately 15:11 UTC found the scoped
`tcf_slot_monitor` login in use. Every availability/reminder row except Calgary
had refreshed in the 15:06 cycle. Calgary's previous empty snapshot was retained
at 14:52:05 UTC. Toronto paper's health markers were reset after success at
15:06:29 UTC. The separate health row was excluded from availability freshness.

Ottawa retried its pending paper notification successfully in
[run 37781734970](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/37781734970),
with state persisted at 13:06:31 UTC. The timed-out request's delivery outcome
is unknown; the retry was accepted. No extra production job was dispatched.

## Calgary repair

The public destination advertised December 8–10 registration buttons while
the month-page heading still said November. The links were in the correct
individual December cards, but were siblings of an empty `exam-registration`
div. Commit `baa9240` recognizes only the observed labelled Oncord overlay
control pointing to a same-origin `/event-rsvp/tcf-canada-*` URL. Sold-out cards
still win, and unknown/disabled/unrelated controls remain errors. A local public
dry-run found six cards and one remaining open card; the earlier HTML had three.
All 111 tests and typecheck passed before shipment. Ordinary scheduled execution
will send any pending availability notification through the existing pipeline.

## Shared listing investigation and hardening

Both public listings now parse successfully: AF-CAPA has 97 rows over three
pages; Edmonton has 30 over two. All current Edmonton rows are closed.
The historical failed HTML was not retained, so its precise shape cannot be
reconstructed from the error message alone.

The public pages' CSS and JavaScript explicitly document an `es-held-card`
countdown, using `data-held-expires-at`, for seats temporarily reserved by other
customers. This has no ordinary `es-status` marker and was unsupported by the
parser. It is a plausible explanation for the failure bursts, **not a verified
historical root cause**. A narrow contract-based fallback accepts only a labelled
Spots Held card with a positive integer expiry and no contradictory status or
booking link. It retains the exam as unavailable; it never treats hold expiry as
a registration opening or assumes seats become available after the countdown.

Unknown booking shapes still throw. Their errors now include only structural
flags (tag/link counts, text presence, and held-expiry presence), not raw HTML,
URLs or embedded tokens. This makes any recurrence diagnosable without weakening
the failure policy. Synthetic contract tests cover held-state recognition,
stable identity, silent tracking, and rejection of malformed/conflicting input.
All 113 tests and typecheck passed; all 127 captured current live rows still parse.

No database grants, secrets, Cloudflare configuration, global email settings,
or unrelated application infrastructure were changed. Broader repeat-email
suppression is a separate user preference, not implemented by these parser fixes.
