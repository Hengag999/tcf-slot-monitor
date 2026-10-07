import { test } from "node:test";
import assert from "node:assert/strict";
import worker, { dispatchScheduled } from "../workers/tcf-monitor-trigger/index.mjs";

const scheduledTime = Date.UTC(2026, 9, 7, 0, 0);
const event = { scheduledTime };
const env = { GITHUB_TOKEN: "test-token-never-a-real-credential" };

test("fresh timer dispatches only the fixed workflow with no recovery input", async () => {
  const requests: { url: string; init: RequestInit }[] = [];
  const logs: unknown[] = [];
  await dispatchScheduled(event, env, {
    now: () => scheduledTime + 30_000,
    fetchImpl: async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      return new Response(null, { status: 204 });
    },
    log: (entry: unknown) => logs.push(entry),
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.github.com/repos/Hengag999/tcf-slot-monitor/actions/workflows/monitor.yml/dispatches");
  assert.equal(requests[0].init.method, "POST");
  assert.equal(requests[0].init.redirect, "manual");
  assert.equal(new Headers(requests[0].init.headers).get("X-GitHub-Api-Version"), "2026-03-10");
  assert.ok(requests[0].init.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(String(requests[0].init.body)), { ref: "master" });
  assert.deepEqual(logs, [{ event: "dispatch_accepted", scheduledTime, status: 204 }]);
  assert.ok(!JSON.stringify(logs).includes(env.GITHUB_TOKEN));
});

test("stale catch-up events skip dispatch without requiring credentials", async () => {
  const logs: unknown[] = [];
  await dispatchScheduled(event, {}, {
    now: () => scheduledTime + 300_001,
    fetchImpl: async () => assert.fail("must not dispatch stale events"),
    log: (entry: unknown) => logs.push(entry),
  });
  assert.deepEqual(logs, [{ event: "stale_trigger_skipped", scheduledTime, ageMs: 300_001 }]);
});

test("missing credentials and invalid event timestamps fail before network access", async () => {
  const dependencies = {
    now: () => scheduledTime,
    fetchImpl: async () => assert.fail("must not send an invalid request"),
  };
  for (const invalidEnv of [{}, { GITHUB_TOKEN: "" }, { GITHUB_TOKEN: "   " }]) {
    await assert.rejects(dispatchScheduled(event, invalidEnv, dependencies), /Missing GITHUB_TOKEN/);
  }
  for (const invalidEvent of [{}, { scheduledTime: NaN }, { scheduledTime: scheduledTime + 60_001 }]) {
    await assert.rejects(dispatchScheduled(invalidEvent, env, dependencies), /Invalid scheduled event/);
  }
});

test("GitHub rejection is visible and is not retried or logged with response secrets", async () => {
  for (const status of [201, 401, 403, 404, 429, 500]) {
    let requests = 0;
    const logs: unknown[] = [];
    await assert.rejects(dispatchScheduled(event, env, {
      now: () => scheduledTime,
      fetchImpl: async () => {
        requests++;
        return new Response("sensitive response body", { status });
      },
      log: (entry: unknown) => logs.push(entry),
    }), new RegExp(`HTTP ${status}`));
    assert.equal(requests, 1);
    assert.deepEqual(logs, [{ event: "dispatch_rejected", scheduledTime, status }]);
    assert.ok(!JSON.stringify(logs).includes("sensitive"));
  }
});

test("redirects never forward the token or create a second request", async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    let requests = 0;
    await assert.rejects(dispatchScheduled(event, env, {
      now: () => scheduledTime,
      fetchImpl: async (_url: string, init: RequestInit) => {
        requests++;
        assert.equal(init.redirect, "manual");
        return new Response(null, { status, headers: { Location: "https://example.com/redirected" } });
      },
      log: () => {},
    }), new RegExp(`HTTP ${status}`));
    assert.equal(requests, 1);
  }
});

test("HTTP 200 accepts a safe run ID without logging the raw receipt", async () => {
  const logs: unknown[] = [];
  await dispatchScheduled(event, env, {
    now: () => scheduledTime,
    fetchImpl: async () => new Response(JSON.stringify({
      workflow_run_id: 12345,
      other: env.GITHUB_TOKEN,
    }), { status: 200 }),
    log: (entry: unknown) => logs.push(entry),
  });
  assert.deepEqual(logs, [{ event: "dispatch_accepted", scheduledTime, status: 200, workflowRunId: 12345 }]);
});

test("HTTP 200 remains accepted when receipt fields are missing or unsafe", async () => {
  for (const receipt of [{}, { workflow_run_id: env.GITHUB_TOKEN }, { workflow_run_id: -1 }]) {
    const logs: unknown[] = [];
    await dispatchScheduled(event, env, {
      now: () => scheduledTime,
      fetchImpl: async () => new Response(JSON.stringify(receipt), { status: 200 }),
      log: (entry: unknown) => logs.push(entry),
    });
    assert.deepEqual(logs, [{ event: "dispatch_accepted", scheduledTime, status: 200 }]);
  }
});

test("HTTP 200 receipt read shares the ten-second bound without replaying accepted dispatch", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const logs: unknown[] = [];
  let requests = 0;
  let startedReading!: () => void;
  const reading = new Promise<void>((resolve) => { startedReading = resolve; });
  const operation = dispatchScheduled(event, env, {
    now: () => scheduledTime,
    log: (entry: unknown) => logs.push(entry),
    fetchImpl: async (_url: string, init: RequestInit) => {
      requests++;
      return {
        status: 200,
        json: async () => await new Promise((_resolve, reject) => {
          init.signal!.addEventListener("abort", () => reject(new Error("body aborted")), { once: true });
          startedReading();
        }),
      };
    },
  });
  await reading;
  t.mock.timers.tick(10_000);
  await operation;
  assert.equal(requests, 1);
  assert.deepEqual(logs, [
    { event: "dispatch_receipt_unavailable", scheduledTime, status: 200 },
    { event: "dispatch_accepted", scheduledTime, status: 200 },
  ]);
});

test("ambiguous dispatch failures do not replay the request or expose raw errors", async () => {
  let requests = 0;
  const logs: unknown[] = [];
  await assert.rejects(dispatchScheduled(event, env, {
    now: () => scheduledTime,
    fetchImpl: async () => {
      requests++;
      throw new Error(`network error with ${env.GITHUB_TOKEN}`);
    },
    log: (entry: unknown) => logs.push(entry),
  }), /response not confirmed; request was not retried/);
  assert.equal(requests, 1);
  assert.deepEqual(logs, [{ event: "dispatch_unconfirmed", scheduledTime }]);
  assert.ok(!JSON.stringify(logs).includes(env.GITHUB_TOKEN));
});

test("HTTP requests cannot start a monitoring run", async () => {
  for (const method of ["GET", "POST"]) {
    const response = await worker.fetch(new Request("https://example.com/dispatch", { method }), env);
    assert.equal(response.status, 404);
    assert.equal(await response.text(), "Not found");
  }
});

test("scheduled handler suppresses platform retries before an invocation can fail", async () => {
  let noRetryCalls = 0;
  await assert.rejects(worker.scheduled({
    scheduledTime: Date.now(),
    noRetry: () => { noRetryCalls++; },
  }, {}), /Missing GITHUB_TOKEN/);
  assert.equal(noRetryCalls, 1);
});

test("slow dispatch is aborted after ten seconds without replaying", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let requests = 0;
  const operation = dispatchScheduled(event, env, {
    now: () => scheduledTime,
    log: () => {},
    fetchImpl: async (_url: string, init: RequestInit) => {
      requests++;
      return await new Promise<Response>((_resolve, reject) => {
        init.signal!.addEventListener("abort", () => reject(new Error("request aborted")), { once: true });
      });
    },
  });
  t.mock.timers.tick(10_000);
  await assert.rejects(operation, /response not confirmed; request was not retried/);
  assert.equal(requests, 1);
});
