import assert from "node:assert/strict";
import test from "node:test";
import { scrapeMontrealAf } from "../scripts/scrapers/montrealAf";

// Public fields from the Canada widget's November 7 inventory.
const sitting = {
  IDEXAMINATION: 2842, IDETABLISHMENT_BRANCH: 1, IDEXAMINATION_TYPE: 10,
  product_name: "TCF CANADA", examination_date: "2026-11-10",
  start_time: "00:00:00", end_time: "00:00:00", isFull: false, inscriptionIsInFuture: false,
  mainRegisterLink: { label: "add_to_cart", link: "https://www.afmontreal.ca/en/cart/#/addExamination/2842" },
};

function fetchListing(exam = sitting): typeof fetch {
  return async input => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://afmontreal.aec.app");
    if (url.pathname === "/") return new Response('{"APIKEY":"fixture"}');
    assert.equal(url.pathname, "/api/v1/public/examinations/list/0/10");
    return Response.json([{ IDETABLISHMENT_BRANCH: 0, IDEXAMINATION_TYPE: 10, name: "TCF CANADA", examinations: [exam] }]);
  };
}

test("Montréal's Canada widget accepts its concrete sitting and omits its unspecified time", async () => {
  const slots = await scrapeMontrealAf({ fetchImpl: fetchListing(), now: new Date("2026-11-07T14:00:00Z") });
  assert.deepEqual(slots, [{ id: "2842", examType: "TCF Canada", date: "2026-11-10", bookingUrl: sitting.mainRegisterLink.link }]);
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
