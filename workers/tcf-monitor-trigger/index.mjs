const DISPATCH_URL = "https://api.github.com/repos/Hengag999/tcf-slot-monitor/actions/workflows/monitor.yml/dispatches";
const MAX_EVENT_AGE_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10 * 1000;

/**
 * A timer only: repository credentials and scraper execution stay in GitHub.
 * Dependency injection is used by offline tests, never by incoming HTTP requests.
 */
export async function dispatchScheduled(controller, env, dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const now = dependencies.now ?? Date.now;
  const log = dependencies.log ?? ((event) => console.log(JSON.stringify(event)));
  const scheduledTime = controller?.scheduledTime;
  const ageMs = now() - scheduledTime;

  if (!Number.isFinite(scheduledTime) || ageMs < -60_000) {
    throw new Error("Invalid scheduled event timestamp");
  }

  // A delayed event must not create a burst of catch-up monitoring runs.
  if (ageMs > MAX_EVENT_AGE_MS) {
    log({ event: "stale_trigger_skipped", scheduledTime, ageMs });
    return;
  }

  const token = env?.GITHUB_TOKEN;
  if (typeof token !== "string" || token.trim().length === 0) {
    throw new Error("Missing GITHUB_TOKEN secret");
  }

  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
  let response;
  let workflowRunId;
  try {
    response = await fetchImpl(DISPATCH_URL, {
      method: "POST",
      // workerd supports manual/follow only. Reject 3xx below without forwarding
      // the authorization header to a redirect destination.
      redirect: "manual",
      signal: abort.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "tcf-monitor-trigger",
        "X-GitHub-Api-Version": "2026-03-10",
      },
      body: JSON.stringify({ ref: "master" }),
    });
    if (response.status === 200) {
      // The same timeout also bounds receipt consumption. HTTP 200 establishes
      // acceptance even if its optional run receipt cannot be read or parsed.
      try {
        const receipt = await response.json();
        if (Number.isSafeInteger(receipt?.workflow_run_id) && receipt.workflow_run_id > 0) {
          workflowRunId = receipt.workflow_run_id;
        }
      } catch {
        log({ event: "dispatch_receipt_unavailable", scheduledTime, status: 200 });
      }
    }
  } catch {
    // GitHub may already have accepted a request whose response was lost.
    // Never replay it here, and never log credentials or raw request errors.
    log({ event: "dispatch_unconfirmed", scheduledTime });
    throw new Error("GitHub dispatch response not confirmed; request was not retried");
  } finally {
    clearTimeout(timeout);
  }

  if (response.status !== 200 && response.status !== 204) {
    log({ event: "dispatch_rejected", scheduledTime, status: response.status });
    throw new Error(`GitHub dispatch returned HTTP ${response.status}; request was not retried`);
  }

  // A 200/204 confirms trigger acceptance, not scraper success or delivery.
  log({
    event: "dispatch_accepted",
    scheduledTime,
    status: response.status,
    ...(workflowRunId === undefined ? {} : { workflowRunId }),
  });
}

export default {
  async scheduled(controller, env) {
    // Suppress platform retries as well as application retries: a lost response
    // does not establish that GitHub failed to create the workflow run.
    controller.noRetry();
    await dispatchScheduled(controller, env);
  },
  async fetch() {
    return new Response("Not found", { status: 404 });
  },
};
