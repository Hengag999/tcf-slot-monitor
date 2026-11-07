import assert from "node:assert/strict";
import test from "node:test";
import { ELC_BOOKING, parseMontrealElc } from "../scripts/scrapers/montrealElc";

const now = new Date("2026-11-08T02:30:00Z"); // Still November 7 in Montréal.
const session = {
  id: 1792, date: "2026-12-19T00:00:00", testType: "TCF Canada", testTypeId: 2,
  availablePlaces: 91, isPrivate: false,
};

test("ELC returns selectable public sessions in date order using the centre's local date", () => {
  const result = parseMontrealElc([
    session, { ...session, id: 2, date: "2026-11-07T00:00:00" },
    { ...session, id: 3, isPrivate: true }, { ...session, id: 4, availablePlaces: 0 },
    { ...session, id: 5, date: "2026-11-06T00:00:00" },
  ], now);
  assert.deepEqual(result.map(s => [s.id, s.date, s.availableSeats, s.bookingUrl]), [
    ["2", "2026-11-07", 91, ELC_BOOKING], ["1792", "2026-12-19", 91, ELC_BOOKING],
  ]);
  assert.deepEqual(parseMontrealElc([], now), []);
});

test("ELC rejects incomplete, changed, or contradictory inventory before returning any dates", () => {
  for (const bad of [
    { items: [session] }, null, [session, session], [session, { id: 6 }],
    [{ ...session, testType: "TCF Québec" }], [{ ...session, testTypeId: 9 }],
    [{ ...session, isPrivate: null }], [{ ...session, availablePlaces: "3" }],
    [{ ...session, availablePlaces: -1 }], [{ ...session, date: "2026-02-30T00:00:00" }],
  ]) assert.throws(() => parseMontrealElc(bad, now), /ELC:/);
});
