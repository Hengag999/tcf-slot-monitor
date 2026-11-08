import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseUqamCalendar, scrapeMontrealUqam, uqamHtmlDiagnostics } from '../scripts/scrapers/montrealUqam';

const page = readFileSync(new URL('./fixtures/montreal-uqam-calendar.html', import.meta.url), 'utf8');
const now = new Date('2026-11-07T12:00:00Z');

test('UQAM publishes three open Canadian sittings and a university registration link', () => {
  const slots = parseUqamCalendar(page, now);
  assert.deepEqual(slots.map(s => s.date), ['2026-12-04', '2027-01-15', '2027-02-05']);
  assert.ok(slots.every(s => s.examType === 'TCF Canada' && s.bookingUrl === 'https://sites.grenadine.uqam.ca/sites/se/fr/test-tcf-uqam2025/register'));
  assert.deepEqual(parseUqamCalendar(page.replaceAll('>Ouvert<', '>Fermé<'), now), []);
});

test('registration deadline is inclusive through the local Montréal calendar day', () => {
  assert.equal(parseUqamCalendar(page, new Date('2026-11-21T04:59:00Z')).length, 3);
  assert.equal(parseUqamCalendar(page, new Date('2026-11-21T05:00:00Z')).length, 2);
});

test('mixed or incomplete inventory, unfamiliar structure and contradictory open rows are rejected', () => {
  const openRow = page.match(/<tr><td><strong>Vendredi 4 décembre 2026[\s\S]*?<\/tr>/)![0];
  for (const invalid of [
    page.replace(openRow, openRow + openRow), page.replace(openRow, openRow.replace('</tr>', '')),
    page.replace('</tbody>', '<tr><td>Unknown date</td></tr></tbody>'),
    page.replace('>Ouvert<', '>Réservé<'), page.replace('>STATUT', '>Dates').replace(';STATUT', ';Dates'),
    page.replace('sites.grenadine.uqam.ca', 'unrelated.example'), page.replaceAll('TCF Canada', 'TCF Québec'),
    page.replace('Vendredi 4 décembre 2026', '<s>Vendredi 4 décembre 2026</s>'), page.replace('15 janvier 2027', '35 janvier 2027'),
    page.replace(openRow, openRow.replace('<tr>', '<tr hidden>')),
  ]) assert.throws(() => parseUqamCalendar(invalid, now));
});

test('archived or hidden calendars cannot announce seats, including when a visible closed copy follows', () => {
  const closed = page.replaceAll('>Ouvert<', '>Fermé<');
  const table = page.match(/<table>[\s\S]*?<\/table>/)![0];
  const button = page.match(/<a\b[\s\S]*?<\/a>/)![0];
  const archives = [
    `<!--${page}-->`, `<template><template>${page}</template>${page}</template>`,
    `<script type="text/plain">${page}</script>`, `<noscript>${page}</noscript>`,
    `<div hidden><div>${page}</div></div>`, `<section aria-hidden="true">${page}</section>`,
    `<div style="display: none">${page}</div>`, `<div inert>${page}</div>`,
  ];
  for (const archived of archives) {
    assert.throws(() => parseUqamCalendar(archived, now));
    assert.deepEqual(parseUqamCalendar(archived + closed, now), []);
  }
  for (const hidden of [page.replace(table, `<figure class="d-none">${table}</figure>`),
    page.replace(button, `<div hidden>${button}</div>`), page.replace('<a class=', '<a aria-disabled="true" class='),
    page + closed]) assert.throws(() => parseUqamCalendar(hidden, now));
});

test('UQAM unknown responses expose only structural diagnostics and still reject', async () => {
  const secret = 'private-cookie-token-do-not-log';
  const html = `<html><title>${secret}</title><body><script src="/cf-chl-/${secret}"></script>Verify you are human</body></html>`;
  const diagnostics = JSON.parse(uqamHtmlDiagnostics(html));
  assert.deepEqual(diagnostics, {
    chars: html.length, rawMainTags: 0, visibleMainSections: 0,
    visibleTables: 0, expectedHeading: false, challengeMarkers: true,
  });
  let requests = 0;
  await assert.rejects(scrapeMontrealUqam({ fetchImpl: (async (_url, init) => {
    requests++;
    assert.equal(init?.redirect, 'error');
    return new Response(html, { headers: { 'Content-Type': 'text/html' } });
  }) as typeof fetch }), error => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /calendar main content missing or ambiguous/);
    assert.match(error.message, /HTML diagnostics=/);
    assert.ok(!error.message.includes(secret));
    assert.ok(!error.message.includes('<html>'));
    return true;
  });
  assert.equal(requests, 1, 'diagnostics must not add retries or accept an unknown page');
});

test('UQAM diagnostics distinguish hidden and duplicate calendars without weakening validation', () => {
  const hidden = `<div hidden>${page}</div>`;
  const hiddenFacts = JSON.parse(uqamHtmlDiagnostics(hidden));
  assert.equal(hiddenFacts.rawMainTags, 1);
  assert.equal(hiddenFacts.visibleMainSections, 0);
  assert.equal(hiddenFacts.expectedHeading, false);
  const duplicates = page + page;
  const duplicateFacts = JSON.parse(uqamHtmlDiagnostics(duplicates));
  assert.equal(duplicateFacts.visibleMainSections, 2);
  assert.throws(() => parseUqamCalendar(hidden, now));
  assert.throws(() => parseUqamCalendar(duplicates, now));
  assert.deepEqual(parseUqamCalendar(page, now).map(slot => slot.date), ['2026-12-04', '2027-01-15', '2027-02-05']);
});
