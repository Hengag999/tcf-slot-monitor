import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseExamSelectorPage, scrapeTcfListing } from "../src/lib/examSelector";
import { computeReminders } from "../src/lib/registrationReminders";
import { bookableEdmontonSlots } from "../scripts/scrapers/edmonton";

const URL = "https://www.alliancefrancaise.ca/en/language/exams/tcf-canada/";
const fixture = readFileSync(new globalThis.URL("./fixtures/exam-selector-capa.html", import.meta.url), "utf8");
const fixtureRows = [...fixture.matchAll(/<tr class="tableRow">[\s\S]*?<\/tr>/g)].map((m) => m[0]);
const table = (rows: string[]) => `<table class="es-exams-table">${rows.join("")}</table>`;
const more = (href = "?s8-datatable1_start=15&amp;s8-datatable1_rows=60") => `<a class="dataShowMore" href="${href}">Show More</a>`;

function fakeFetch(pages: Record<string, string | number>, visited: string[] = []): typeof fetch {
  return (async (input, init) => {
    const url = String(input);
    visited.push(url);
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal);
    const body = pages[url];
    assert.notEqual(body, undefined, `unexpected request: ${url}`);
    return typeof body === "number" ? new Response("failed", { status: body }) : new Response(body);
  }) as typeof fetch;
}

test("live markup distinguishes same-date centres and retains migration aliases", () => {
  const { exams } = parseExamSelectorPage(fixture);
  assert.equal(exams.length, 4);
  assert.equal(new Set(exams.map((e) => e.examKey)).size, 4);
  assert.equal(exams[0].legacyExamKey, exams[1].legacyExamKey);
  assert.equal(exams[2].legacyExamKey, exams[3].legacyExamKey);
  assert.equal(exams[0].spotsLeft, 0);
  assert.equal(exams[0].bookingAvailable, false);
  assert.equal(exams[2].registrationOpensAt, Date.UTC(2026, 10, 2, 23) / 1000);
});

test("label asterisk and first sitting schedule/year are part of identity", () => {
  const a = fixtureRows[0];
  const b = a.replace("December 11 , 2026", "December 11 , 2026*");
  const c = a.replace("11 Dec 2026", "11 Dec 2027");
  const { exams } = parseExamSelectorPage(table([a, b, c]), URL, "edmonton");
  assert.equal(new Set(exams.map((e) => e.examKey)).size, 3);
  assert.ok(exams.every((e) => e.examKey.startsWith("edmonton-")));
});

test("identity survives status and booking-link changes", () => {
  const closed = fixtureRows[0];
  // Available anchor shape observed on Edmonton's live DELF selector, adapted
  // to this TCF fixture to exercise the shared platform's positive signal.
  const open = closed.replace(/<span class="es-status es-status-closed"[^>]*>Closed<\/span>/,
    '<a class="es-status es-status-available" href="/af/exam-selector/order/?exam_id=204">Book Now</a>');
  const before = parseExamSelectorPage(table([closed])).exams[0];
  const after = parseExamSelectorPage(table([open])).exams[0];
  assert.equal(before.examKey, after.examKey);
  assert.equal(after.bookingAvailable, true);
  assert.equal(after.bookingUrl, "https://www.alliancefrancaise.ca/af/exam-selector/order/?exam_id=204");
});

test("follows decoded Show More links and returns all unique rows", async () => {
  const visited: string[] = [];
  const next = `${URL}?s8-datatable1_start=15&s8-datatable1_rows=60`;
  const rows = await scrapeTcfListing({ fetchImpl: fakeFetch({
    [URL]: table(fixtureRows.slice(0, 2)) + more(),
    [next]: table([fixtureRows[1], ...fixtureRows.slice(2)]),
  }, visited) });
  assert.deepEqual(visited, [URL, next]);
  assert.equal(rows.length, 4);
});

test("later-page failure rejects the whole listing", async () => {
  const next = `${URL}?s8-datatable1_start=15&s8-datatable1_rows=60`;
  await assert.rejects(scrapeTcfListing({ fetchImpl: fakeFetch({ [URL]: table([fixtureRows[0]]) + more(), [next]: 503 }) }), /503/);
});

test("rejects loops, ignored pagination, and conflicting duplicate rows", async () => {
  await assert.rejects(scrapeTcfListing({ fetchImpl: fakeFetch({ [URL]: fixture + more(URL) }) }), /pagination loop/);
  const next = `${URL}?s8-datatable1_start=15&s8-datatable1_rows=60`;
  await assert.rejects(scrapeTcfListing({ fetchImpl: fakeFetch({ [URL]: fixture + more(), [next]: fixture }) }), /no progress/);
  await assert.rejects(scrapeTcfListing({ fetchImpl: fakeFetch({
    [URL]: table([fixtureRows[0]]) + more(),
    [next]: table([fixtureRows[0].replace('es-status-closed', 'es-status-full')]),
  }) }), /conflicting duplicate/);
});

test("rejects cross-origin pagination, unrelated paths, and unsafe booking links", () => {
  assert.throws(() => parseExamSelectorPage(fixture + more("https://example.com/next")), /cross-origin/);
  assert.throws(() => parseExamSelectorPage(fixture + more("/other/")), /pagination path/);
  const row = fixtureRows[0].replace(/<span class="es-status es-status-closed"[^>]*>Closed<\/span>/,
    '<a class="es-status es-status-available" href="javascript:alert(1)">Book Now</a>');
  assert.throws(() => parseExamSelectorPage(table([row])), /cross-origin/);
});

test("valid empty table is distinct from a missing or incomplete structure", () => {
  assert.deepEqual(parseExamSelectorPage(table([])).exams, []);
  assert.throws(() => parseExamSelectorPage('<span class="es-exam-title">TCF Canada</span>'), /table not found/);
  assert.throws(() => parseExamSelectorPage(table([fixtureRows[0].replace(/<td>[^<]*\$390\.00[^<]*<\/td>/, "")])), /7 exam columns/);
  assert.throws(() => parseExamSelectorPage(table([fixtureRows[0].replace("es-status-closed", "missing-status")])), /booking status/);
});

test("ordinary header rows and a header-only empty table remain valid", () => {
  // Column labels and th-only shape observed on the live Victoria listing.
  const header = '<tr><th>Exam</th><th>Schedules</th><th><a href="?order=date">Registration Dates</a></th><th>Location</th><th>Spots left</th><th>Price</th><th>Bookings</th></tr>';
  assert.deepEqual(parseExamSelectorPage(table([header])).exams, []);
  assert.equal(parseExamSelectorPage(table([header, fixtureRows[0]])).exams.length, 1);
});

test("missing or renamed data-row classes cannot silently yield an empty or partial snapshot", () => {
  for (const renamed of [fixtureRows[0].replace('class="tableRow"', 'class="examRowV2"'), fixtureRows[0].replace('class="tableRow"', '')]) {
    assert.throws(() => parseExamSelectorPage(table([renamed])), /unrecognized data row/);
    assert.throws(() => parseExamSelectorPage(table([fixtureRows[1], renamed])), /unrecognized data row/);
  }
});

test("incomplete unknown rows and malformed recognized cells reject the snapshot", () => {
  const unknown = fixtureRows[0].replace('class="tableRow"', 'class="examRowV2"').replace('</tr>', '');
  assert.throws(() => parseExamSelectorPage(table([unknown])), /incomplete exam row/);
  // Seven regex matches alone used to miss an extra unclosed cell marker.
  const malformed = fixtureRows[0].replace('<td>', '<td><td>');
  assert.throws(() => parseExamSelectorPage(table([malformed])), /7 exam columns/);
  const extraHeaderCell = fixtureRows[0].replace('</tr>', '<th>Unexpected</th></tr>');
  assert.throws(() => parseExamSelectorPage(table([extraHeaderCell])), /7 exam columns/);
});

test("unrecognized booking states fail instead of silently tracking unavailable exams", () => {
  // The prior prefix-only parser accepted these as healthy rows with no pings.
  // In particular, a held state is valid only through the validated held card,
  // not merely because an arbitrary status class happens to use that name.
  for (const state of ["es-status-new-booking-state", "es-status-fuller", "es-status-held"]) {
    const row = fixtureRows[0].replace("es-status-closed", state);
    assert.throws(() => parseExamSelectorPage(table([row])), /unsupported booking status/);
  }
});

test("conflicting or duplicate booking indicators cannot select the first state silently", () => {
  const row = fixtureRows[0];
  const original = row.match(/<span class="es-status es-status-closed"[^>]*>Closed<\/span>/)![0];
  const open = '<a class="es-status es-status-available" href="/af/exam-selector/order/?exam_id=204">Book Now</a>';
  for (const states of ["es-status-closed es-status-available", "es-status-available es-status-closed"]) {
    assert.throws(() => parseExamSelectorPage(table([row.replace("es-status-closed", states)])), /conflicting booking status/);
  }
  for (const markup of [original + open, open + original, original + original]) {
    assert.throws(() => parseExamSelectorPage(table([row.replace(original, markup)])), /ambiguous booking status/);
  }
});

test("an unsupported booking state on a later page rejects the whole snapshot", async () => {
  const next = `${URL}?s8-datatable1_start=15&s8-datatable1_rows=60`;
  await assert.rejects(scrapeTcfListing({ fetchImpl: fakeFetch({
    [URL]: table([fixtureRows[0]]) + more(),
    [next]: table([fixtureRows[1].replace("es-status-closed", "es-status-new-booking-state")]),
  }) }), /unsupported booking status/);
});

test("upcoming rows must carry a valid epoch", () => {
  const row = fixtureRows[2];
  assert.throws(() => parseExamSelectorPage(table([row.replace(/data-opens-at="\d+"/, 'data-opens-at="invalid"')])), /invalid registration epoch/);
  assert.throws(() => parseExamSelectorPage(table([row.replace(/data-opens-at="\d+"/, "")])), /no epoch/);
});

// Synthetic contract fixture based on the public Oncord held-card CSS and
// countdown client inspected 2026-10-08. Historical failing HTML was not saved.
const closedStatus = /<span class="es-status es-status-closed"[^>]*>Closed<\/span>/;
const heldStatus = '<div class="es-held-card" data-held-expires-at="1791457200"><span class="es-held-card-chip">Spots Held</span><span class="es-held-card-countdown-value">4m 30s</span></div>';

test("held seats remain tracked, unavailable and silent, even after the countdown expires", () => {
  const heldRow = fixtureRows[0].replace(closedStatus, heldStatus);
  const held = parseExamSelectorPage(table([heldRow])).exams[0];
  const closed = parseExamSelectorPage(table([fixtureRows[0]])).exams[0];
  assert.equal(held.examKey, closed.examKey);
  assert.equal(held.statusClass, "es-status-held");
  assert.equal(held.registrationOpensAt, null);
  assert.equal(held.spotsLeft, 0);
  assert.equal(held.bookingAvailable, false);
  assert.deepEqual(bookableEdmontonSlots([held]), []);
  const result = computeReminders([held], [], Date.UTC(2027, 0, 1));
  assert.equal(result.tracking.length, 1);
  assert.deepEqual(result.pings, []);
});

test("held fallback requires a labelled card with a valid expiry and no conflicting action", () => {
  for (const markup of [heldStatus.replace('data-held-expires-at="1791457200"', ''), heldStatus.replace('1791457200', 'invalid'), heldStatus.replace('Spots Held', 'Unknown'), heldStatus + '<a href="/book">Book Now</a>', heldStatus + '<span class="es-status es-status-available">Open</span>']) {
    assert.throws(() => parseExamSelectorPage(table([fixtureRows[0].replace(closedStatus, markup)])), /held booking status/);
  }
  assert.throws(() => parseExamSelectorPage(table([fixtureRows[0].replace(closedStatus, '<div data-held-expires-at="1791457200">Spots Held</div>')])), /missing booking status/);
});
