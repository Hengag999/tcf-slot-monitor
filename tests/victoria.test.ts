import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createSources } from "../scripts/scrape-slots";
import { scrapeVictoria, VICTORIA_LISTING_PAGE } from "../scripts/scrapers/victoria";
import { computeReminders, formatPings } from "../src/lib/registrationReminders";

// Actual public table markup, captured 2026-10-09. Page 2 contains the future
// openings, so a first-page-only scrape would miss every actionable sitting.
const first = readFileSync(new URL("./fixtures/exam-selector-victoria-page-1.html", import.meta.url), "utf8");
const second = readFileSync(new URL("./fixtures/exam-selector-victoria-page-2.html", import.meta.url), "utf8");
const next = `${VICTORIA_LISTING_PAGE}?s8-datatable1_start=15&s8-datatable1_rows=60`;

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

test("Victoria's own live markup yields all 27 sittings and four second-page openings", async () => {
  const visited: string[] = [];
  const rows = await scrapeVictoria({ fetchImpl: fakeFetch({ [VICTORIA_LISTING_PAGE]: first, [next]: second }, visited) });
  assert.deepEqual(visited, [VICTORIA_LISTING_PAGE, next]);
  assert.equal(rows.length, 27);
  assert.equal(new Set(rows.map(row => row.examKey)).size, 27);
  assert.ok(rows.every(row => row.examType === "TCF Canada" && row.location === "Alliance Française Victoria - 1218 Langley Street"));
  assert.ok(rows.every(row => row.bookingUrl === VICTORIA_LISTING_PAGE));
  assert.equal(rows.filter(row => row.statusClass === "es-status-closed").length, 11);
  assert.equal(rows.filter(row => row.statusClass === "es-status-full").length, 12);
  const upcoming = rows.filter(row => row.statusClass === "es-status-opens-soon");
  assert.deepEqual(upcoming.map(row => [row.label, row.spotsLeft]), [
    ["TCF-Canada-December 15, 2026", 9],
    ["TCF-Canada-December 16, 2026", 8],
    ["TCF-Canada-December 17, 2026", 16],
    ["TCF-Canada-December 18, 2026", 8],
  ]);
  assert.ok(upcoming.every(row => row.registrationOpensAt === 1792533600 && !row.bookingAvailable));

  const now = Date.parse("2026-10-09T00:00:00Z");
  const initial = computeReminders(rows, [], now);
  assert.equal(initial.tracking.length, 27);
  assert.equal(initial.pings.length, 4);
  assert.ok(initial.pings.every(ping => ping.kind === "new" && ping.bookingUrl === VICTORIA_LISTING_PAGE));
  assert.equal(initial.tracking.filter(entry => entry.firedReminders.length === 0).length, 23);
  assert.deepEqual(computeReminders(rows, initial.tracking, now + 5 * 60_000).pings, []);
});

test("production Victoria configuration fetches its own source and uses Victoria reminder wording", async (t) => {
  const visited: string[] = [];
  t.mock.method(globalThis, "fetch", fakeFetch({ [VICTORIA_LISTING_PAGE]: first, [next]: second }, visited));
  const city = createSources().find(source => source.key === "victoria")!;
  assert.ok(city);
  assert.equal(city.reminderMode, true);
  assert.equal(city.webhookEnv, "DISCORD_WEBHOOK_VICTORIA");
  assert.deepEqual(city.reminderOptions, { timeZone: "America/Vancouver", timeZoneLabel: "维多利亚时间" });
  // Exercise the actual configured function: a scraper-only fix would still
  // leave the former inline Vancouver filter wired into production.
  const rows = await city.scrape();
  assert.equal(rows.length, 27);
  assert.deepEqual(visited, [VICTORIA_LISTING_PAGE, next]);
  const victoriaRows = await scrapeVictoria({ fetchImpl: fakeFetch({ [VICTORIA_LISTING_PAGE]: first, [next]: second }) });
  const now = Date.parse("2026-10-09T00:00:00Z");
  const { pings } = computeReminders(victoriaRows, [], now);
  const message = formatPings(city.zhLabel!, pings, now, city.reminderOptions);
  assert.match(message, /维多利亚 TCF Canada/);
  assert.match(message, /2026年10月20日.*15:00（维多利亚时间）/);
  assert.ok(message.includes(VICTORIA_LISTING_PAGE));
});

test("Victoria rejects missing markup and a failed later page rather than returning an empty or partial snapshot", async () => {
  await assert.rejects(scrapeVictoria({ fetchImpl: fakeFetch({ [VICTORIA_LISTING_PAGE]: "<p>Unavailable</p>" }) }), /table not found/);
  await assert.rejects(scrapeVictoria({ fetchImpl: fakeFetch({ [VICTORIA_LISTING_PAGE]: first, [next]: 503 }) }), /503/);
});

test("Victoria rejects unexpected locations and unsafe pagination", async () => {
  const wrongLocation = second.replace("Alliance Française Victoria - 1218 Langley Street", "Alliance Française Vancouver - 6161 Cambie Street");
  await assert.rejects(scrapeVictoria({ fetchImpl: fakeFetch({ [VICTORIA_LISTING_PAGE]: first, [next]: wrongLocation }) }), /unexpected location/);
  const crossOrigin = first.replace('href="/language/exams/tcf/?s8-datatable1_start=15&amp;s8-datatable1_rows=60"', 'href="https://example.com/next"');
  assert.ok(crossOrigin !== first, "fixture's pagination URL was replaced");
  await assert.rejects(scrapeVictoria({ fetchImpl: fakeFetch({ [VICTORIA_LISTING_PAGE]: crossOrigin }) }), /cross-origin/);
});

test("Victoria accepts an explicitly empty, structurally valid exam table", async () => {
  assert.deepEqual(await scrapeVictoria({ fetchImpl: fakeFetch({ [VICTORIA_LISTING_PAGE]: '<table class="es-exams-table"></table>' }) }), []);
});
