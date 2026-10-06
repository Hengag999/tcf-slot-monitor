import assert from "node:assert/strict";
import { test } from "node:test";
import { bookableEdmontonSlots, EDMONTON_LISTING_PAGE, scrapeEdmontonExams } from "../scripts/scrapers/edmonton";
import type { ExamSelectorRow } from "../src/lib/examSelector";

const NOW = Date.UTC(2026, 9, 6, 12);

function exam(overrides: Partial<ExamSelectorRow> = {}): ExamSelectorRow {
  return {
    id: "edmonton-morning", examKey: "edmonton-morning", legacyExamKey: "tcf-canada-november-2",
    examType: "TCF Canada", date: "TCF Canada - November 2", label: "TCF Canada - November 2",
    schedule: "Written Monday 02 Nov 2026 - 9:20am▸12:20pm Oral To be confirmed",
    registrationWindow: "Oct 6 2026 4:00am - Oct 7 2026 5:00pm",
    registrationOpensAt: null, spotsLeft: 1, statusClass: "es-status-available",
    bookingUrl: "https://www.afedmonton.com/af/exam-selector/order/?exam_id=200",
    bookingAvailable: true, location: "Alliance Française of Edmonton - Kingsway",
    ...overrides,
  };
}

test("only positive booking controls expose Edmonton availability", () => {
  const rows = [
    exam(),
    exam({ statusClass: "es-status-closed", bookingAvailable: false }), // live closed-with-1-seat case
    exam({ statusClass: "es-status-full", spotsLeft: 0 }),
    exam({ statusClass: "es-status-opens-soon", registrationOpensAt: NOW / 1000 + 60 }),
    exam({ statusClass: "es-status-unknown" }),
    exam({ bookingAvailable: false }),
    exam({ spotsLeft: 0 }),
    exam({ registrationOpensAt: NOW / 1000 + 60 }), // contradictory future + available
    exam({ label: "TCF IRN - November 2" }),
  ];
  assert.deepEqual(bookableEdmontonSlots(rows, NOW), [{
    id: "edmonton-morning", examType: "TCF Canada", date: "TCF Canada - November 2",
    bookingUrl: "https://www.afedmonton.com/af/exam-selector/order/?exam_id=200", availableSeats: 1,
  }]);
});

test("unknown seat count is allowed with an explicit bookable link", () => {
  const [slot] = bookableEdmontonSlots([exam({ spotsLeft: null })], NOW);
  assert.ok(slot);
  assert.equal("availableSeats" in slot, false);
});

test("booking destination must be an observed same-site exam order", () => {
  const unsafe = [
    EDMONTON_LISTING_PAGE,
    "https://example.com/af/exam-selector/order/?exam_id=200",
    "https://www.afedmonton.com/af/exam-selector/order/?exam_id=0",
    "https://www.afedmonton.com/af/exam-selector/order/",
    "javascript:alert(1)",
  ];
  assert.deepEqual(bookableEdmontonSlots(unsafe.map((bookingUrl) => exam({ bookingUrl })), NOW), []);
});

// Minimal public-markup fixtures. Closed TCF rows and pagination were observed
// on 2026-10-06; the open Book Now anchor shape was verified on Edmonton DELF.
function row(label: string, schedule: string, booking: string, spots = "1"): string {
  return `<tr class="tableRow"><td><span class="es-exam-title">${label}</span></td>
    <td>${schedule}</td><td>Oct 1 2026 4:00pm - Oct 1 2026 5:00pm</td>
    <td>Alliance Française of Edmonton - Kingsway</td><td>${spots}</td><td>$400.00</td>
    <td>${booking}</td></tr>`;
}

test("current entry point follows Show More and keeps morning/afternoon identities separate", async (t) => {
  const visited: string[] = [];
  const pages = [
    `<table class="es-exams-table">${row("TCF Canada - November 2", "Written Monday 02 Nov 2026 - 9:20am▸12:20pm", '<span class="es-status es-status-closed">Closed</span>')}</table>
      <a class="dataShowMore" href="/en/exams/tcf/?s8-datatable1_start=15&amp;s8-datatable1_rows=60">Show More</a>`,
    `<table class="es-exams-table">${row("TCF Canada - November 2*", "Written Monday 02 Nov 2026 - 1:30pm▸4:30pm", '<a class="es-status es-status-available" href="/af/exam-selector/order/?exam_id=200">Book Now</a>')}</table>`,
  ];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    visited.push(String(input));
    const body = pages[visited.length - 1];
    assert.ok(body, "must stop fetching after final page");
    return new Response(body);
  });

  const rows = await scrapeEdmontonExams();
  assert.deepEqual(visited, [EDMONTON_LISTING_PAGE, `${EDMONTON_LISTING_PAGE}?s8-datatable1_start=15&s8-datatable1_rows=60`]);
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].examKey, rows[1].examKey);
  const [available] = bookableEdmontonSlots(rows, NOW);
  assert.equal(available.date, "TCF Canada - November 2*");
});
