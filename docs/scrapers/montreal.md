# Montréal TCF Canada centres

BonTCF’s `src/data/examCenters.json` lists seven distinct providers under `Montréal (Québec)`. Each provider’s official site confirms it offers TCF Canada. Kirkland, Laval and Saint-Constant have separate city entries. The Stanislas campus in Québec City also has its own entry.

## Sources

Each centre has an independent state key and Discord destination. Availability sources alert when a date first appears or returns after an absence. Yves-Thériault uses registration reminders in `America/Toronto`.

| Centre and state key | What triggers an alert | Official source |
| --- | --- | --- |
| Alliance Française de Montréal · `montreal-af` | A new date has a concrete sitting and an enabled AEC registration link. The Canada widget requests exam type 10 and returns Montréal branch 1 sittings. The centre supplies exact times later when the widget shows midnight. | [TCF Canada widget](https://www.afmontreal.ca/tcf/) |
| Cégep Marie-Victorin · `montreal-marie-victorin` | A TCF Canada course card in the public catalogue has an enabled registration action for that sitting. The Cégep lists additional planned dates on its information page. The TCF catalogue currently covers Pavillon Bélanger. | [Official instructions](https://cegepmv.ca/formation-continue/centre-deducation-interculturelle-et-internationale/tests-francais) · [Booking catalogue](https://cmvtcf.webinscription.com/fr/students/catalog) |
| Collège ELC · `montreal-elc` | The DScholar registration flow publishes a future or same-day public computer session for test type 2 with positive remaining places. The notification includes the count reported by DScholar. | [Centre’s exam page](https://www.elccollege.ca/fr/tcf-canada) · [Public booking flow](https://www.dscholar.ca/elc/public-test-inscription/fr/2) |
| UQÀM · `montreal-uqam` | The university calendar marks a TCF Canada registration **Ouvert** and its local deadline has yet to pass. The notification identifies the calendar as the source. The university may close bookings early when capacity is reached. | [Calendar](https://francisation.uqam.ca/tests-tcf/calendrier/) · [Registration instructions](https://francisation.uqam.ca/tests-tcf/inscriptions/) |
| Collège Stanislas · `montreal-stanislas` | The Montréal guest catalogue shows places for both the four-component TCF Canada exam and its required administrative fee on the same date. The webhook links to the official portal entry. | [Centre](https://stanislas.qc.ca/tcf/) · [COBA portal](https://monportail.stanislas.qc.ca/capnet/login.asp?NoRegr=3) |
| Centre Yves-Thériault · `montreal-yves-theriault` | The school announces an upcoming **in-person** registration date for an exam. Reminders identify the Montréal time and address, 3925 rue Villeray. The shared TCF schedule includes Canada, Québec and Tout public. TEF has its own schedule. | [Registration hours and paired exam dates](https://centre-yves-theriault.cssdm.gouv.qc.ca/programmes/tests-francais/) |

## Other roster entries

- **Université Concordia** offers TCF Canada. The owner chose to skip this centre for this release. [Official exam page](https://www.concordia.ca/cce/language-testing/tcf-test.html)

## Discord setup

All six channels are in the existing BonTCF **考场通知** category. Discord showed each channel synced to the category. All 26 member permission settings matched Winnipeg, including permission to view, read history and react, and explicit denial of posting messages, sending within threads and creating threads. Each webhook's guild, channel and name were verified against Discord before storing its URL in its own encrypted Actions secret.

[Alliance Française](https://discord.com/channels/1484038585907810535/1568515831158014003) · [Marie-Victorin](https://discord.com/channels/1484038585907810535/1568516620278566962) · [ELC](https://discord.com/channels/1484038585907810535/1568516775912669284) · [UQÀM](https://discord.com/channels/1484038585907810535/1568516835777716234) · [Yves-Thériault](https://discord.com/channels/1484038585907810535/1568516908372721744) · [Stanislas](https://discord.com/channels/1484038585907810535/1568517302138437663)

## Source observations on 2026-11-07

The public Marie-Victorin catalogue displayed five courses, including a full sitting, while the Cégep’s information page listed more planned dates. ELC’s captured public response contained 27 eligible sessions. UQÀM marked December 4, January 15 and February 5 open on its calendar. Yves-Thériault published seven exam/registration pairs, six with future registration dates. The next registration was November 25 at 13:30 for the December 12 exam. These observations refer to local reads of the public sources.

## Production verification

The [14:50 China-time run](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/42348725170) on `3caa8a4` passed 251 tests, typecheck, the scoped database permission check and all 17 sources. The first five Montréal checks produced these genuine Discord receipts, verified in the destination channels. A read-only database query confirmed the corresponding states had been saved after delivery.

| Destination | First notification |
| --- | --- |
| [Alliance Française](https://discord.com/channels/1484038585907810535/1568515831158014003/1568518029589872703) | 27 dates, two message chunks and one mention |
| [Marie-Victorin](https://discord.com/channels/1484038585907810535/1568516620278566962/1568518073693245484) | 4 dates |
| [ELC](https://discord.com/channels/1484038585907810535/1568516775912669284/1568518091938463785) | 27 dates with remaining places |
| [UQÀM](https://discord.com/channels/1484038585907810535/1568516835777716234/1568518108665356298) | 3 dates explicitly marked open on the official calendar |
| [Yves-Thériault](https://discord.com/channels/1484038585907810535/1568516908372721744/1568518120610598984) | 6 future in-person registration windows in one message. The seventh calendar row had a past registration date. |

The [14:55 run](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/42349064566) on `f8843ce` passed 255 tests, typecheck, the scoped guard and all 18 production sources. Stanislas's guest catalogue supplied 23 dates with both requirements open. Its [first Discord alert](https://discord.com/channels/1484038585907810535/1568517302138437663/1568519314762629201) matched the production result. The other five Montréal checks refreshed their stored snapshots and retained their original notification times. The guest session uses the public COBA login page and short-lived navigation state in memory. Candidates follow the generic portal link from Discord.

The [15:00 follow-up](https://github.com/Hengag999/tcf-slot-monitor/actions/runs/42349395877) again passed all 18 sources, 255 tests, typecheck and the scoped guard. All six Montréal checks completed with zero repeat notifications. A read-only query at 15:01 China time confirmed each centre's check timestamp had advanced and its notification timestamp still matched its original delivery.
