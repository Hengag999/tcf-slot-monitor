import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import { request, type RequestOptions } from "node:https";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { fetchNorthYorkViaPublicDns, northYorkLookup, NORTH_YORK_API_URL } from "../src/lib/northYorkConnection";
import { scrapeNorthYork } from "../scripts/scrapers/northyork";

test("North York fallback DNS is hostname-scoped and supports both lookup callback forms", async () => {
  const hosts: string[] = [];
  const lookup = northYorkLookup(async hostname => { hosts.push(hostname); return ["203.0.113.42"]; });
  await new Promise<void>((resolve, reject) => lookup("api.gblc.ca", {}, (error, address, family) => {
    if (error) { reject(error); return; }
    assert.equal(address, "203.0.113.42"); assert.equal(family, 4); resolve();
  }));
  await new Promise<void>((resolve, reject) => lookup("api.gblc.ca", { all: true }, (error, addresses) => {
    if (error) { reject(error); return; }
    assert.deepEqual(addresses, [{ address: "203.0.113.42", family: 4 }]); resolve();
  }));
  await new Promise<void>(resolve => lookup("unrelated.example", {}, error => { assert.ok(error); resolve(); }));
  assert.deepEqual(hosts, ["api.gblc.ca", "api.gblc.ca"]);
});

test("North York fallback rejects failed, empty and malformed DNS answers", async () => {
  for (const resolve4 of [async () => [], async () => ["not-an-IP"], async () => ["::1"],
    async (): Promise<string[]> => { throw new Error("private resolver diagnostics"); }]) {
    const lookup = northYorkLookup(resolve4);
    await new Promise<void>(resolve => lookup("api.gblc.ca", {}, error => {
      assert.equal(error?.message, "GBLC: public DNS lookup failed"); resolve();
    }));
  }
});

type MockResponse = IncomingMessage & PassThrough;

function httpsHarness(status: number, emit: (response: MockResponse) => void) {
  let calls = 0;
  let captured!: RequestOptions;
  const requestImpl = ((url: string, options: RequestOptions, done: (r: IncomingMessage) => void) => {
    calls++;
    assert.equal(url, NORTH_YORK_API_URL, "HTTPS URL keeps the original hostname and exact public GET path");
    captured = options;
    const req = new EventEmitter();
    Object.assign(req, { end: () => queueMicrotask(() => {
      const response = new PassThrough() as MockResponse;
      response.statusCode = status;
      response.complete = true;
      done(response);
      emit(response);
    }) });
    return req;
  }) as unknown as typeof request;
  return { requestImpl, calls: () => calls, options: () => captured };
}

test("North York fallback keeps HTTPS identity checks, isolates DNS and returns complete JSON", async () => {
  const io = httpsHarness(200, response => { response.end('[{"id":1}]'); });
  const signal = AbortSignal.timeout(1000);
  const response = await fetchNorthYorkViaPublicDns(signal, { ...io, resolve4: async () => ["203.0.113.42"] });
  assert.equal(response.status, 200);
  assert.equal(response.ok, true);
  assert.deepEqual(await response.json(), [{ id: 1 }]);
  const options = io.options();
  assert.equal(options.method, "GET");
  assert.equal(options.servername, "api.gblc.ca");
  assert.equal(options.rejectUnauthorized, true);
  assert.equal(options.agent, false, "cannot reuse a global pooled connection or resolver");
  assert.equal(options.signal, signal);
  assert.equal(options.checkServerIdentity, undefined, "retain Node's normal certificate hostname verifier");
  assert.equal(options.ca, undefined);
  assert.deepEqual(options.headers, { Accept: "application/json" });
  await new Promise<void>(resolve => options.lookup!("api.gblc.ca", {}, (error, address) => {
    assert.equal(error, null); assert.equal(address, "203.0.113.42"); resolve();
  }));
});

test("North York fallback never follows redirects and never turns broken/oversize bodies into inventory", async () => {
  for (const status of [301, 403, 429, 503]) {
    const io = httpsHarness(status, response => { response.end("unread HTTP body"); });
    const result = await fetchNorthYorkViaPublicDns(AbortSignal.timeout(1000), io);
    assert.equal(result.ok, false); assert.equal(result.status, status); assert.equal(io.calls(), 1);
  }
  for (const emit of [
    (response: MockResponse) => { response.complete = false; response.end("[]"); },
    (response: MockResponse) => { response.emit("aborted"); response.end("[]"); },
    (response: MockResponse) => { response.end(Buffer.alloc(2_000_001)); },
  ]) {
    const io = httpsHarness(200, emit);
    await assert.rejects(fetchNorthYorkViaPublicDns(AbortSignal.timeout(1000), io));
    assert.equal(io.calls(), 1);
  }
});

test("North York switches to public DNS only after an approved connection failure", async () => {
  let ordinary = 0;
  let fallback = 0;
  const fetchImpl = (async () => {
    ordinary++;
    throw new TypeError("fetch failed", { cause: Object.assign(new Error("refused"), { code: "ECONNREFUSED" }) });
  }) as typeof fetch;
  assert.deepEqual(await scrapeNorthYork({ fetchImpl, sleep: async () => {}, publicDnsFetchImpl: async () => {
    fallback++; return new Response("[]");
  } }), []);
  assert.equal(ordinary, 1); assert.equal(fallback, 1);
  for (const status of [200, 403]) {
    const options = { fetchImpl: (async () => new Response("[]", { status })) as typeof fetch,
      publicDnsFetchImpl: async (): Promise<Response> => assert.fail("HTTP response must not activate DNS fallback") };
    if (status === 200) assert.deepEqual(await scrapeNorthYork(options), []);
    else await assert.rejects(scrapeNorthYork(options), /403/);
  }
});

test("a North York reset after response headers remains a non-retryable body failure", async () => {
  const io = httpsHarness(200, response => {
    response.destroy(Object.assign(new Error("private body error"), { code: "ECONNRESET" }));
  });
  let initial = 0;
  await assert.rejects(scrapeNorthYork({
    fetchImpl: (async () => { initial++; throw new TypeError("fetch failed", {
      cause: Object.assign(new Error("private reset"), { code: "ECONNRESET" }),
    }); }) as typeof fetch,
    sleep: async () => {},
    publicDnsFetchImpl: signal => fetchNorthYorkViaPublicDns(signal, io),
  }), /non-retryable transport error/);
  assert.equal(initial, 1);
  assert.equal(io.calls(), 1, "an interrupted response must never replay the body as a connection retry");
});
