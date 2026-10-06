// Manual reconciliation for a known partially delivered Vancouver batch.
// Runs inside the monitor workflow's concurrency group with its existing secrets.
// Edits that same bot message without mentioning anyone again; never creates one.
import "../src/lib/env";
import { neon } from "@neondatabase/serverless";
import { getPrevState } from "../src/lib/db";
import { scrapeTcfListing } from "../src/lib/examSelector";
import { computeReminders, formatPings, type TrackingEntry } from "../src/lib/registrationReminders";

export interface RecoveryIO {
  fetchImpl: typeof fetch;
  readState: typeof getPrevState;
  listExams: typeof scrapeTcfListing;
  compareAndSet: (previous: unknown[], tracking: TrackingEntry[]) => Promise<boolean>;
}

const defaultIO: RecoveryIO = {
  fetchImpl: fetch,
  readState: getPrevState,
  listExams: scrapeTcfListing,
  compareAndSet: async (previous, tracking) => {
    const sql = neon(process.env.POSTGRES_URL!);
    const updated = await sql`
      UPDATE slot_monitor_state
      SET slots = ${JSON.stringify(tracking)}::jsonb, checked_at = NOW(), notified_at = NOW()
      WHERE city = 'vancouver' AND exam_type = 'TCF Canada'
        AND slots = ${JSON.stringify(previous)}::jsonb
      RETURNING city`;
    return updated.length === 1;
  },
};

export async function recoverVancouverNotification(io: RecoveryIO = defaultIO): Promise<void> {
  const id = process.env.RECOVER_VANCOUVER_MESSAGE_ID ?? "";
  if (id !== "1557016902994501632") throw new Error("Only the verified October 6 partial message can be recovered by this script");
  const webhook = new URL(process.env.DISCORD_WEBHOOK_VANCOUVER ?? "");
  const path = webhook.pathname.split("/");
  const webhookId = path[path.indexOf("webhooks") + 1];
  if (!webhookId || !process.env.POSTGRES_URL) throw new Error("Webhook and database configuration required");
  const messageUrl = new URL(webhook);
  messageUrl.pathname = messageUrl.pathname.replace(/\/$/, "") + `/messages/${id}`;
  messageUrl.search = "";

  const readMessage = async () => {
    const res = await io.fetchImpl(messageUrl, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`Message read failed: HTTP ${res.status}`);
    return await res.json() as { id: string; webhook_id: string; channel_id: string; content: string };
  };
  const existing = await readMessage();
  if (existing.id !== id || existing.webhook_id !== webhookId
    || existing.channel_id !== "1484040131932455003"
    || !existing.content.startsWith("@everyone 🇫🇷 **温哥华 TCF Canada · 报名提醒**")) {
    throw new Error("Message does not match the expected Vancouver bot notification");
  }
  const previous = (await io.readState("vancouver")).find(row => row.exam_type === "TCF Canada");
  if (!previous) throw new Error("No existing Vancouver state to reconcile");
  const exams = (await io.listExams()).filter(exam => !/victoria/i.test(exam.location));
  const now = Date.now();
  const { pings, tracking } = computeReminders(exams, previous.slots as TrackingEntry[], now);
  if (pings.length === 0) {
    console.log("No pending Vancouver reminders; state is already reconciled.");
    return;
  }
  // Recovery is deliberately limited to the first-sighting batch observed here.
  const firstLabel = pings[0].label.replace(/^TCF[-\s]+Canada\s+/i, "");
  if (pings.length !== 37 || pings.some(ping => ping.kind !== "new") || !existing.content.includes(firstLabel)) {
    throw new Error("Pending reminders do not match the known partial first-sighting batch");
  }
  const content = formatPings("温哥华", pings, now);
  if (content.length > 2000) throw new Error("Recovery must fit one editable message");
  console.log(`Reconciling ${pings.length} pending entries in existing message ${id} (${content.length} characters)`);
  if (existing.content !== content) {
    try {
      const res = await io.fetchImpl(messageUrl, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`Message edit failed: HTTP ${res.status}`);
      await res.arrayBuffer();
    } catch (error) {
      // An edit can have succeeded before its response was lost. Read back the
      // known ID instead of creating/replaying another notification.
      console.warn(`Edit outcome requires read-back: ${(error as Error).message}`);
    }
  }
  const verified = await readMessage();
  if (verified.id !== id || verified.content !== content) {
    throw new Error("Complete message was not verified; notification state remains unchanged");
  }
  if (!await io.compareAndSet(previous.slots, tracking)) {
    throw new Error("State changed concurrently; verified message retained but state was not overwritten");
  }
  console.log(`Verified ${pings.length} entries in message ${id}; tracking reconciled without a new ping.`);
}

if (process.argv[1]?.endsWith("recover-vancouver-notification.ts")) {
  recoverVancouverNotification().catch(error => { console.error((error as Error).message); process.exitCode = 1; });
}
