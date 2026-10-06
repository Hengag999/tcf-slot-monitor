import { test } from "node:test";
import assert from "node:assert/strict";
import { postDiscord } from "../src/lib/discord";

const content = "@everyone\n" + ["a", "b", "c"].map(c => c.repeat(1800)).join("\n");
const accepted = (headers = {}) => new Response(null, { status: 204, headers });
const limited = (body: string, headers = {}) => new Response(body, { status: 429, headers });

test("mid-batch 429 retries only the rejected chunk and keeps one accepted mention", async () => {
  const sent: string[] = [];
  const delivered: string[] = [];
  const waits: number[] = [];
  await postDiscord("https://example.com/webhook", content, {
    fetchImpl: (async (_url, init) => {
      const message = JSON.parse(String(init?.body)).content;
      sent.push(message);
      if (sent.length === 2) return limited('{"retry_after":0.5}', { "Retry-After": "1" });
      delivered.push(message);
      return accepted();
    }) as typeof fetch,
    sleep: async ms => { waits.push(ms); },
  });
  assert.equal(sent.length, 4);
  assert.equal(sent[1], sent[2]);
  assert.equal(delivered.length, 3);
  assert.equal(delivered.filter(s => s.includes("@everyone")).length, 1);
  assert.ok(delivered.every(s => s.length <= 2000));
  assert.deepEqual(waits, [1100]);
});
test("exhausted bucket is respected before the next chunk", async () => {
  const events: string[] = [];
  await postDiscord("https://example.com/webhook", content, {
    fetchImpl: (async () => {
      events.push("send");
      return accepted({ "X-RateLimit-Remaining": "0", "X-RateLimit-Reset-After": "0.25" });
    }) as typeof fetch,
    sleep: async ms => { events.push(`wait:${ms}`); },
  });
  assert.deepEqual(events, ["send", "wait:350", "send", "wait:350", "send"]);
});
test("JSON delay alone is supported and repeated rate limits are bounded", async () => {
  let requests = 0;
  const waits: number[] = [];
  await assert.rejects(postDiscord("https://example.com/webhook", "test", {
    fetchImpl: (async () => { requests++; return limited('{"retry_after":0.1}'); }) as typeof fetch,
    sleep: async ms => { waits.push(ms); },
  }), /429/);
  assert.equal(requests, 4);
  assert.deepEqual(waits, [200, 200, 200]);
});
test("malformed or excessive retry delays stop instead of spinning or waiting indefinitely", async () => {
  for (const body of ['{"retry_after":-1}', '{"retry_after":120}', 'unreadable']) {
    let requests = 0;
    await assert.rejects(postDiscord("https://example.com/webhook", "test", {
      fetchImpl: (async () => { requests++; return limited(body); }) as typeof fetch,
      sleep: async () => assert.fail("invalid delay must not sleep"),
    }), /retry delay|budget/);
    assert.equal(requests, 1);
  }
});
test("ambiguous network failures and non-rate-limit errors are never automatically replayed", async () => {
  for (const networkError of [true, false]) {
    let requests = 0;
    await assert.rejects(postDiscord("https://example.com/webhook", "test", {
      fetchImpl: (async () => {
        requests++;
        if (networkError) throw new Error("network timeout");
        return new Response("unavailable", { status: 500 });
      }) as typeof fetch,
      sleep: async () => assert.fail("no retry"),
    }));
    assert.equal(requests, 1);
  }
});
