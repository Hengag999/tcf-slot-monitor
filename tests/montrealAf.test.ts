import assert from "node:assert/strict";
import test from "node:test";
import { scrapeMontrealAf } from "../scripts/scrapers/montrealAf";
import { AecKeyPageOriginError } from "../src/lib/aecExaminations";

// Public fields from the Canada widget's November 7 inventory.
const sitting = {
  IDEXAMINATION: 2842, IDETABLISHMENT_BRANCH: 1, IDEXAMINATION_TYPE: 10,
  product_name: "TCF CANADA", examination_date: "2026-11-10",
  start_time: "00:00:00", end_time: "00:00:00", isFull: false, inscriptionIsInFuture: false,
  mainRegisterLink: { label: "add_to_cart", link: "https://www.afmontreal.ca/en/cart/#/addExamination/2842" },
};

function fetchListing(exam = sitting): typeof fetch {
  return async (input, options) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://afmontreal.aec.app");
    if (url.pathname === "/") return new Response('{"APIKEY":"fixture"}');
    assert.equal(url.pathname, "/api/v1/public/examinations/list/0/10");
    assert.equal(new Headers(options?.headers).get("API_KEY"), "fixture");
    assert.equal(url.searchParams.get("allBranches"), "N");
    return Response.json([{ IDETABLISHMENT_BRANCH: 0, IDEXAMINATION_TYPE: 10, name: "TCF CANADA", examinations: [exam] }]);
  };
}

test("Montréal's Canada widget accepts its concrete sitting and omits its unspecified time", async () => {
  const slots = await scrapeMontrealAf({ fetchImpl: fetchListing(), now: new Date("2026-11-07T14:00:00Z") });
  assert.deepEqual(slots, [{ id: "2842", examType: "TCF Canada", date: "2026-11-10", bookingUrl: sitting.mainRegisterLink.link }]);
});

function keyPageSequence(sequence: Array<number | string | Error>, listing: typeof fetch = fetchListing()) {
  const requests: string[] = [];
  const sleeps: number[] = [];
  const signals: AbortSignal[] = [];
  const discarded: Response[] = [];
  let attempts = 0;
  const fetchImpl: typeof fetch = async (input, options) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://afmontreal.aec.app");
    assert.equal(options?.redirect, "error");
    assert.ok(options?.signal, "every GET has a timeout");
    requests.push(url.pathname);
    if (url.pathname !== "/") return listing(input, options);
    assert.ok(discarded.every(response => response.bodyUsed), "release origin-error bodies before retrying");
    signals.push(options.signal);
    const outcome = sequence[attempts++];
    assert.notEqual(outcome, undefined, "key-page retry budget exceeded");
    if (outcome instanceof Error) throw outcome;
    const response = new Response(typeof outcome === "number" ? "upstream unavailable" : outcome,
      { status: typeof outcome === "number" ? outcome : 200 });
    if (outcome === 521 || outcome === 522) discarded.push(response);
    return response;
  };
  return { fetchImpl, requests, sleeps, signals, attempts: () => attempts,
    sleep: async (ms: number) => { sleeps.push(ms); }, now: new Date("2026-11-07T14:00:00Z") };
}

test("Montréal recovers key-page HTTP 521/522 within three bounded attempts before validating inventory", async () => {
  for (const errors of [[521], [522], [521, 522], [522, 521]]) {
    const io = keyPageSequence([...errors, '{"APIKEY":"fixture"}']);
    const slots = await scrapeMontrealAf(io);
    assert.deepEqual(slots, [{ id: "2842", examType: "TCF Canada", date: "2026-11-10", bookingUrl: sitting.mainRegisterLink.link }]);
    assert.equal(io.attempts(), errors.length + 1);
    assert.deepEqual(io.sleeps, errors.length === 1 ? [1000] : [1000, 2000]);
    assert.equal(new Set(io.signals).size, errors.length + 1, "fresh timeout for each attempt");
    assert.deepEqual(io.requests, [...errors.map(() => "/"), "/", "/api/v1/public/examinations/list/0/10"]);
  }
});

test("Montréal exhausted origin retries throw without fetching or returning inventory", async () => {
  for (const errors of [[521, 521, 521], [522, 522, 522], [521, 522, 521], [522, 521, 522]]) {
    const io = keyPageSequence(errors);
    await assert.rejects(scrapeMontrealAf(io), error => {
      assert.ok(error instanceof AecKeyPageOriginError);
      assert.equal(error.origin, "https://afmontreal.aec.app");
      assert.equal(error.status, errors.at(-1));
      return true;
    });
    assert.equal(io.attempts(), 3);
    assert.deepEqual(io.sleeps, [1000, 2000]);
    assert.deepEqual(io.requests, ["/", "/", "/"]);
  }
});

test("Montréal does not retry other key-page errors even after an origin error", async () => {
  for (const outcome of [401, 403, 404, 429, 500, 502, 503, 504, "missing key", new TypeError("fetch failed"), new DOMException("timeout", "TimeoutError")]) {
    for (const prefix of [[], [522]]) {
      const io = keyPageSequence([...prefix, outcome]);
      await assert.rejects(scrapeMontrealAf(io), error => {
        assert.ok(!(error instanceof AecKeyPageOriginError), "do not misclassify another failure as origin exhaustion");
        return true;
      });
      assert.equal(io.attempts(), prefix.length + 1);
      assert.deepEqual(io.sleeps, prefix.length ? [1000] : []);
      assert.ok(io.requests.every(path => path === "/"));
    }
  }
});

test("Montréal key-page recovery does not retry or hide invalid inventory", async () => {
  for (const outcome of [500, 521, 522, "", "{}", "not-json"]) {
    const io = keyPageSequence([522, '{"APIKEY":"fixture"}'], async () => new Response(
      typeof outcome === "number" ? "unavailable" : outcome,
      { status: typeof outcome === "number" ? outcome : 200 },
    ));
    await assert.rejects(scrapeMontrealAf(io), /examinations API returned|invalid examinations response/);
    assert.deepEqual(io.requests, ["/", "/", "/api/v1/public/examinations/list/0/10"]);
    assert.deepEqual(io.sleeps, [1000]);
  }
  const wrongBranch = keyPageSequence([521, '{"APIKEY":"fixture"}'], fetchListing({ ...sitting, IDETABLISHMENT_BRANCH: 2 }));
  await assert.rejects(scrapeMontrealAf(wrongBranch), /unexpected examination identity/);
});

test("Montréal still accepts explicit empty inventory after key-page recovery", async () => {
  for (const outcome of [204, "[]"]) {
    const io = keyPageSequence([522, '{"APIKEY":"fixture"}'], async () =>
      typeof outcome === "number" ? new Response(null, { status: outcome }) : new Response(outcome));
    assert.deepEqual(await scrapeMontrealAf(io), []);
    assert.deepEqual(io.requests, ["/", "/", "/api/v1/public/examinations/list/0/10"]);
  }
});

test("Montréal aggregate widget rejects an unrecognized branch instead of publishing it", async () => {
  await assert.rejects(scrapeMontrealAf({
    fetchImpl: fetchListing({ ...sitting, IDETABLISHMENT_BRANCH: 2 }),
    now: new Date("2026-11-12T12:00:00Z"),
  }), /unexpected examination identity/);
});

test("Montréal keeps same-day registration until local midnight even when UTC has advanced", async () => {
  const fetchImpl = fetchListing();
  assert.equal((await scrapeMontrealAf({ fetchImpl, now: new Date("2026-11-11T04:59:59Z") })).length, 1);
  assert.deepEqual(await scrapeMontrealAf({ fetchImpl, now: new Date("2026-11-11T05:00:00Z") }), []);
});
