# Ashton silence audit — October 13, 2026

## Findings

No currently bookable Ashton TCF date was found. This conclusion is based on the
official rendered booking flow and public source, not only green workflow runs.
The historical August–October gap cannot be certified as complete coverage.

The [canonical registration page](https://ashtontesting.ca/tcf-canada-test/) still
announces additional November/December dates by mid-October. The rendered page
exposes no active date control, and the form's `exma_date` select has one blank
option inside an all-viewport-hidden Elementor wrapper. Public HTML retains four
disabled FULL November dates inside hidden markup; these are not bookable slots.
The date bridge scripts copy radio selections into form fields and do not fetch
inventory. Browser resource inspection found no date-inventory XHR/fetch request.
The current scraper independently returned a successful empty result.

The official [FAQ](https://ashtontesting.ca/tcf-canada-exam-faqs/) says dates are
released mid-month, with five sessions each month, online registration only, and
no waiting list. It explicitly excludes the proctoring service as a TCF booking
route. Public discovery also found an older `/tcf-testing/` page with an outdated
price, the same FULL November dates, and navigation back to the canonical page;
it is not a validated alternative source of openings. Public TCF blog search
found no recent release announcement.

Public WordPress metadata dates the canonical page's last edit to September 21,
`18:42:39Z`. This cannot establish the date the November inventory opened or
closed: shortcode content can change separately. The archive lookup timed out,
so no historical page was obtained to settle that question.

## Discord, state, and historical execution

The browser confirmed the latest actual Ashton message is
[1539511460588421160](https://discord.com/channels/1484038585907810535/1484039767829123164/1539511460588421160),
sent **August 19 at 13:48:54.944 China time**, listing October 3, 11, 17, 21, and 25.
Its corresponding [run 32220832428](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/32220832428)
reported five slots and `0 → 5 — NOTIFY`. An August 20 sample had already returned
to `0 → 0`.

At **October 13, 23:41:19.245 China time**, a read-only transaction using
`tcf_slot_monitor` found Ashton `slots=[]`, checked at `15:36:49.624Z`, with
`notified_at=2026-08-19T05:49:02.069Z`. Runs
[38422780647](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/38422780647)
and [38423456124](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/38423456124)
at **23:31** and **23:36 China time** explicitly reported Ashton zero slots,
`0 → 0`, source OK, 186 tests passing, all 12 sources OK, and zero forbidden
database privileges. There was no pending Ashton notification to send.

GitHub's encrypted `DISCORD_WEBHOOK_ASHTON` secret exists, with last update
`2026-03-19T04:56:09Z`. Discord's channel integrations show one existing webhook,
`Ashton Bot`, posting to `#ashton`, created March 19. No webhook setting was changed
or secret exposed. This local checkout has no Ashton webhook value, so no
token-based endpoint check was possible. Configuration presence and old delivery alone
do not prove a fresh production send would succeed; no fake availability message
was posted to test it.

**Confirmed historical sampling gap:** September 14–20 had only **48 automatic
runs over seven days**. Creation gaps ranged from 1h35m to 5h53m, with a median
3h33m. The maximum was September 14 `10:43:55Z–16:36:32Z`. A date that opened and
sold out between checks could have been missed; there is no captured page proving
that occurred. The production five-minute timer introduced in October addresses
this earlier weakness.

One log per day for September 14–20 and a September 26 sample all reported Ashton
`0 → 0`, without a scraper exception. The sampled run IDs were `34869669205`,
`34997719069`, `35134711177`, `35249706560`, `35374665098`, `35454717825`,
`35524481673`, and `36277345123`. These samples do not reconstruct intervening
availability. Neither the old 0→N notification policy nor the October 9 repaired
hidden-picker precedence is proved to have caused the historical silence.

## Approved improvement and validation

The user explicitly approved alerting on every new Ashton date even if other
dates remain available. The production configuration now uses the established
per-date diff. Only newly appearing date/time labels notify; unchanged or
reordered lists stay quiet, and disappeared dates can notify if they return.
Notification state still advances only after accepted delivery. No source parser,
other centre policy, credentials, permissions, or database baseline was changed.

All **187 offline tests**, typecheck, and whitespace checks pass. The added test
uses the actual Ashton parser and configured notification policy to verify:
an added date while another remains open, failed delivery retaining the prior
snapshot, retry of only the new date, no repeated alert after reordering, unknown
markup preserving state, and a valid closed-to-reopened transition. Independent
review found no blockers.

Production shipment and normal scheduled-run verification are pending. Since the
live source has no open dates, the new-date notification behavior is verified by
regression tests; a real future reopening still needs source/message comparison.
