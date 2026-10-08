import assert from "node:assert/strict";
import test from "node:test";
import { parseCalgaryRegistration, scrapeCalgary } from "../scripts/scrapers/calgary";

const destinationUrl = "https://www.afcalgary.ca/exams/tcf/tcf-registrations-open-1607/";
// Small synthetic cases test failure policy, not evidence of a real open page.
const card = (body: string, classes = "exam-card") => `<div class="${classes}"><div class="exam-date">3 NOVEMBER</div>${body}</div>`;
const registration = (link: string) => `<div class="exam-registration"><strong>${link}</strong></div>`;
const parent = (body: string) => `<h3>Step 2</h3><div class="s8-templates-card s8-templates-card__cardsize-5"><div><h4>November 2026 sessions</h4>${body}</div></div><div class="s8-templates-card s8-templates-card__cardsize-4"><h3>Step 3</h3></div>`;
const candidate = parent(`<a href="${destinationUrl}">Registrations</a>`);

test("Calgary accepts explicit closed pages and sold-out cards", () => {
  assert.equal(parseCalgaryRegistration("<h1>Registrations are closed</h1>", destinationUrl), false);
  assert.equal(parseCalgaryRegistration(card("SOLD OUT" + registration("")), destinationUrl), false);
});

test("Calgary never interprets an unrecognized destination as open", () => {
  for (const html of ["<h1>Something went wrong</h1>", '<div class="exam-cards">Registration</div>', '<script>"<div class=\"exam-card\">SOLD OUT</div>"</script>']) {
    assert.throws(() => parseCalgaryRegistration(html, destinationUrl), /no exam cards/);
  }
});

test("Calgary needs a real registration link in a recognized card", () => {
  const good = card(registration('<a href="/checkout/exam">Register</a>'), "highlight exam-card available");
  assert.equal(parseCalgaryRegistration(card("SOLD OUT") + good, destinationUrl), true);
  for (const link of ["", '<a href="#">Register</a>', '<a href="javascript:void(0)">Register</a>', '<a href="/book" aria-disabled="true">Register</a>']) {
    assert.throws(() => parseCalgaryRegistration(card(registration(link)), destinationUrl), /neither SOLD OUT nor an actionable/);
  }
});

test("Calgary does not borrow registration links or sold-out text from outside a card", () => {
  assert.throws(() => parseCalgaryRegistration(card("") + registration('<a href="/book">Register</a>'), destinationUrl), /neither SOLD OUT/);
  assert.equal(parseCalgaryRegistration(card(registration('<a href="/book">Register</a>')) + "<footer>Other sessions SOLD OUT</footer>", destinationUrl), true);
  assert.throws(() => parseCalgaryRegistration('<div class="exam-card"><div>Incomplete', destinationUrl), /incomplete/);
});

// Public December markup observed 2026-10-08: the booking overlay is a sibling
// of the empty exam-registration div. Decorative SVG/styles/IDs omitted.
const overlay = (href = "/event-rsvp/tcf-canada-tue-08-12-2026/", extra = "") =>
  `<span class="s8-templates-button"><span><strong>Register now!</strong></span><a class="s8-templates-button-linkOverlay" href="${href}" ${extra}>Register\n now!</a></span>`;

test("Calgary recognizes the observed Oncord TCF booking overlay within its own card", () => {
  assert.equal(parseCalgaryRegistration(card("SOLD OUT") + card(overlay() + registration("")), destinationUrl), true);
  assert.equal(parseCalgaryRegistration(card("SOLD OUT" + overlay()), destinationUrl), false);
  assert.throws(() => parseCalgaryRegistration(card(registration("")) + overlay(), destinationUrl), /neither SOLD OUT/);
});

test("Calgary overlay fallback rejects disabled, unrelated and cross-origin links", () => {
  for (const link of [overlay("/event-rsvp/tcf-canada-tue-08-12-2026/", 'aria-disabled="true"'), overlay("https://other.example/event-rsvp/tcf-canada-tue-08-12-2026/"), overlay("/event-rsvp/tef-canada-tue-08-12-2026/"), overlay("#"), overlay("/contact/")]) {
    assert.throws(() => parseCalgaryRegistration(card(link + registration("")), destinationUrl), /neither SOLD OUT/);
  }
});

test("Calgary rejects unknown parent markup instead of returning an empty success", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("<h3>Step 2</h3>Markup changed<h3>Step 3</h3>"));
  await assert.rejects(scrapeCalgary(), /no session cards/);
});

test("Calgary returns empty only after a recognized sold-out parent or destination", async (t) => {
  const replies = [parent("SOLD OUT"), candidate, card("SOLD OUT")];
  const requests: RequestInit[] = [];
  t.mock.method(globalThis, "fetch", async (_url: string, options: RequestInit) => {
    requests.push(options);
    return new Response(replies.shift());
  });
  assert.deepEqual(await scrapeCalgary(), []);
  assert.deepEqual(await scrapeCalgary(), []);
  assert.equal(requests.length, 3);
  assert.ok(requests.every((options) => options.signal instanceof AbortSignal));
});

test("Calgary propagates destination HTTP and network failures to preserve state", async (t) => {
  let call = 0;
  t.mock.method(globalThis, "fetch", async () => {
    call++;
    if (call % 2 === 1) return new Response(candidate);
    if (call === 2) return new Response("Service unavailable", { status: 503 });
    throw new Error("network unavailable");
  });
  await assert.rejects(scrapeCalgary(), /destination fetch failed: 503/);
  await assert.rejects(scrapeCalgary(), /network unavailable/);
});

test("Calgary propagates changed destination markup to preserve state", async (t) => {
  let call = 0;
  t.mock.method(globalThis, "fetch", async () => new Response(++call === 1 ? candidate : "<h1>Moved to a new platform</h1>"));
  await assert.rejects(scrapeCalgary(), /no exam cards/);
});
