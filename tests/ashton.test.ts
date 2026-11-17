import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { AshtonRegistrationPausedError, parseAshton, scrapeAshton } from "../scripts/scrapers/ashton";

const closed = readFileSync(new URL("./fixtures/ashton-hidden-registration.html", import.meta.url), "utf8");
const picker = '<div class="tcf-radio-picker"><label><input type="radio" name="tcf_radio_date" value="Dec 5th 9.00 am">Dec 5th 9.00 am</label></div>';
const select = '<select name="form_fields[exma_date]"><option value=""></option><option value="Dec 12th 9.00 am">Dec 12th 9.00 am</option></select>';
const allHidden = 'class="elementor-hidden-desktop elementor-hidden-tablet elementor-hidden-mobile"';

test("Ashton's actual hidden registration markup and visible mid-October notice form a recognized closed state", () => {
  assert.deepEqual(parseAshton(closed), []);
  // Enabled but hidden stale markup must not turn the closed form into a ping.
  const staleEnabled = closed.replace(/<div class="tcf-radio-picker">[\s\S]*?<\/div>/, picker);
  assert.deepEqual(parseAshton(staleEnabled), []);
});

test("hidden pickers cannot mask dates in the visible fallback select", () => {
  for (const attrs of [allHidden, "hidden", 'style="display: none !important;"', 'style="visibility:hidden"']) {
    const slots = parseAshton(`<div ${attrs}>${picker}</div>${select}`);
    assert.deepEqual(slots.map(slot => slot.date), ["Dec 12th 9.00 am"]);
  }
  // A mobile-only hidden control is still visible on desktop.
  assert.deepEqual(parseAshton(`<div class="elementor-hidden-mobile">${picker}</div>`).map(slot => slot.date), ["Dec 5th 9.00 am"]);
});

test("Ashton ignores comments, scripts, and hidden date entries inside a visible control", () => {
  const html = `<!-- ${picker} --><script>const old = '${picker}';</script>${select}`;
  assert.deepEqual(parseAshton(html).map(slot => slot.date), ["Dec 12th 9.00 am"]);
  assert.deepEqual(parseAshton('<select name="form_fields[exma_date]"><option value=""></option><option hidden value="Dec 5">Dec 5</option></select>'), []);
  const dates = picker.replace("</div>", '<label hidden><input type="radio" value="Dec 9">Dec 9</label></div>');
  assert.deepEqual(parseAshton(dates).map(slot => slot.date), ["Dec 5th 9.00 am"]);
});

test("visible Ashton date controls preserve enabled dates and reject full or disabled entries", () => {
  const slots = parseAshton(picker.replace("</div>", '<label><input type="radio" disabled>Dec 6 (FULL)</label></div>'));
  assert.equal(slots.length, 1);
  assert.equal(slots[0].examType, "TCF Canada");
  assert.equal(slots[0].bookingUrl, "https://ashtontesting.ca/tcf-canada-test/");
  assert.deepEqual(parseAshton('<select name="form_fields[exma_date]"><option value=""></option></select>'), []);
  assert.deepEqual(parseAshton('<select name="form_fields[exma_date]"><option value="--">--</option><option disabled>Dec 5</option><option>Dec 6 (FULL)</option></select>'), []);
});

test("unknown Ashton shapes or unexplained hidden forms fail instead of clearing state", () => {
  for (const html of [
    "<p>Temporarily unavailable</p>",
    `<div ${allHidden}>${picker}</div>`,
    closed.replace("ADDITIONAL EXAM DATES FOR NOVEMBER AND DECEMBER WILL BE RELEASED BY MID-OCTOBER", "Unexplained change"),
    '<div class="tcf-radio-picker"><p>New unknown listing</p></div>',
    '<div class="tcf-radio-picker"><label>New unknown listing</label></div>',
    '<select name="form_fields[exma_date]"></select>',
    `<div hidden>${picker}`,
  ]) assert.throws(() => parseAshton(html), /Ashton:/);
});

test("Ashton production scraper uses the validated parser and bounded public fetch", async () => {
  const fetchImpl = (async (input, init) => {
    assert.equal(String(input), "https://ashtontesting.ca/tcf-canada-test/");
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal);
    return new Response(closed);
  }) as typeof fetch;
  assert.deepEqual(await scrapeAshton({ fetchImpl }), []);
  await assert.rejects(scrapeAshton({ fetchImpl: (async () => new Response("failed", { status: 503 })) as typeof fetch }), /503/);
});

const pauseHeading = '<h2 class="elementor-heading-title">TCF Canada Exam Registration</h2>';
const pauseNotice = '<div class="elementor-widget-text-editor">TCF EXAM REGISTRATION IS CURRENTLY PAUSED. PLEASE CHECK BACK LATER.</div>';

test("Ashton's official visible pause is distinct from an empty successful listing", async () => {
  const paused = `<main>${pauseHeading}${pauseNotice}</main>`;
  assert.throws(() => parseAshton(paused), AshtonRegistrationPausedError);
  assert.throws(() => parseAshton(paused + `<div ${allHidden}>${picker}</div>`), AshtonRegistrationPausedError);
  const fetchImpl = (async () => new Response(paused)) as typeof fetch;
  await assert.rejects(scrapeAshton({ fetchImpl }), AshtonRegistrationPausedError);
});

test("hidden, missing-context and contradictory pause text stays fail-closed", () => {
  const rescore = '<p>TCF has temporarily suspended its re-scoring service.</p>';
  for (const html of [
    pauseNotice, pauseHeading + rescore, pauseHeading + `<!--${pauseNotice}-->`,
    pauseHeading + `<script>const notice = '${pauseNotice}';</script>`,
    pauseHeading + `<div ${allHidden}>${pauseNotice}</div>`,
    pauseHeading + pauseNotice + select,
    pauseHeading + pauseNotice + picker,
    pauseHeading + pauseNotice + '<form><select name="new_date"><option>Dec 21</option></select></form>',
  ]) {
    assert.throws(() => parseAshton(html), (error: unknown) =>
      error instanceof Error && !(error instanceof AshtonRegistrationPausedError) && /^Ashton:/.test(error.message));
  }
});
