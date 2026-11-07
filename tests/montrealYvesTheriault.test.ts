import assert from "node:assert/strict";
import test from "node:test";
import { parseMontrealYvesTheriault, YVES_THERIAULT_PAGE } from "../scripts/scrapers/montrealYvesTheriault";
import { computeReminders, formatPings } from "../src/lib/registrationReminders";

const past = "<li><strong>24 octobre 2026 :</strong> inscription le mercredi 30 septembre 2026</li>";
const winter = "<li><strong>12 décembre 2026 : </strong>inscription le mercredi 25 novembre 2026</li>";
const summer = "<li><strong>24 avril 2027 :</strong> inscription le mercredi 24 mars 2027</li>";
const calendar = `<a>Sur place</a><p>Se présenter au centre entre 13 h 30 et 15 h les jours d’inscription. (50 places disponibles).</p>
<h2>Horaire des tests</h2><h5>Test de connaissance du français Québec, Canada et tout public.</h5>
<ul>${past}${winter}${summer}</ul>
<h5>Test d’évaluation du français (TEF)</h5><ul><li>5 décembre 2026 : inscription le mercredi 23 novembre2026</li></ul>
<p>3925, rue Villeray</p>`;

test("Yves-Thériault uses the local registration day, distinguishes DST and honours historical baselines", () => {
  const rows = parseMontrealYvesTheriault(calendar);
  const now = Date.parse("2026-11-07T00:00Z");
  const { tracking, pings } = computeReminders(rows, [], now, { futureOnly: true });
  assert.equal(tracking.length, 3);
  assert.deepEqual(pings.map(p => p.label), ["2026-12-12", "2027-04-24"]);
  assert.deepEqual(pings.map(p => new Date(p.registrationOpensAt! * 1000).toISOString()),
    ["2026-11-25T18:30:00.000Z", "2027-03-24T17:30:00.000Z"]);
  assert.ok(pings.every(p => p.spotsLeft === null && p.bookingUrl === YVES_THERIAULT_PAGE));
  const message = formatPings("蒙特利尔 · Centre Yves-Thériault（现场报名）", pings, now, {timeZone:"America/Toronto", timeZoneLabel:"蒙特利尔时间"});
  assert.match(message, /13:30/);
  assert.match(message, /现场报名 13:30–15:00 · 3925, rue Villeray/);
  assert.doesNotMatch(message, /50 个名额|当前显示可报名/);
  assert.deepEqual(computeReminders(rows, tracking, now, {futureOnly:true}).pings, []);
});

test("Yves-Thériault rejects unrecognized rows, calendar scope, in-person terms and status changes", () => {
  for (const html of [
    calendar.replace("Québec, Canada et tout public.", "Québec et tout public."),
    calendar.replace("Test d’évaluation du français (TEF)", "Horaire suivant"),
    calendar.replace("13 h 30", "14 h"), calendar.replace("3925, rue Villeray", "Adresse à confirmer"),
    calendar.replace("mercredi 25 novembre", "mardi 25 novembre"), calendar.replace("12 décembre", "32 décembre"),
    calendar.replace(winter, winter + winter), calendar.replace(winter, "<li>À venir</li>"),
    calendar.replace(winter, "<s>" + winter + "</s>"), calendar.replace(winter, winter.replace("<li>", "<li hidden>")),
    calendar.replace("<ul>", "<p>Les inscriptions sont suspendues.</p><ul>"),
    calendar.replace(`${past}${winter}${summer}`, ""),
  ]) assert.throws(() => parseMontrealYvesTheriault(html), /registration calendar unknown/);
});
