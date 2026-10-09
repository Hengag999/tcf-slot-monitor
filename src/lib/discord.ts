interface SlotInfo {
  date: string;
  bookingUrl: string;
  startTime?: string;
  endTime?: string;
  availableSeats?: number;
}

export interface PublishedAvailabilityStyle {
  kind: "published-availability";
  sourceUrl: string;
  caveat: string;
}

export function formatSlotNotification(
  cityLabel: string,
  examType: string,
  slots: SlotInfo[],
  style?: PublishedAvailabilityStyle,
): string {
  const published = style?.kind === "published-availability";
  const slotLines = slots.map((s) => {
    const time = s.startTime && s.endTime ? ` ${s.startTime}–${s.endTime}` : "";
    const seats = s.availableSeats != null
      ? published ? ` · 官网公布 ${s.availableSeats} 个名额` : ` · 剩 ${s.availableSeats} 个名额`
      : "";
    return `📅 ${s.date}${time}${seats}`;
  });

  const urls = [...new Set(slots.map((s) => s.bookingUrl))];
  const urlLines = urls.map((u) => published ? `📝 报名表：${u}` : `👉 立即报名：${u}`);

  return [
    published
      ? `@everyone 🗓️ **${cityLabel}** **${examType}** 官网公布余位`
      : `@everyone 🗓️ **${cityLabel}** 新开放 **${examType}** 考位，手慢无！`,
    "",
    ...slotLines,
    "",
    ...(published ? [`🔎 官网场次信息：${style.sourceUrl}`] : []),
    ...urlLines,
    ...(published ? ["", style.caveat] : []),
  ].join("\n");
}

export async function notifyDiscord(
  webhookUrl: string,
  cityLabel: string,
  examType: string,
  slots: SlotInfo[],
  style?: PublishedAvailabilityStyle,
): Promise<void> {
  await postDiscord(webhookUrl, formatSlotNotification(cityLabel, examType, slots, style));
}

// Discord caps a webhook message's `content` at 2000 characters and rejects
// anything longer with a 400. A busy day (e.g. Halifax opening 40+ sittings at
// once, or a Vancouver reminder catch-up burst) can exceed that, so we split the
// message into ≤2000-char chunks on line boundaries and send them in order.
// Budgeting by JS string `.length` is conservative: a string's UTF-16 length is
// always ≥ Discord's character count, so any chunk that passes here passes Discord.
const DISCORD_CONTENT_LIMIT = 2000;

function chunkForDiscord(content: string, limit = DISCORD_CONTENT_LIMIT): string[] {
  if (content.length <= limit) return [content];

  const chunks: string[] = [];
  let current = "";
  for (const line of content.split("\n")) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length <= limit) {
      current = candidate;
      continue;
    }
    if (current) chunks.push(current);
    if (line.length <= limit) {
      current = line;
    } else {
      // Pathological single line longer than the limit (e.g. a giant URL).
      // Hard-slice it so we never emit an over-limit chunk.
      let rest = line;
      while (rest.length > limit) {
        chunks.push(rest.slice(0, limit));
        rest = rest.slice(limit);
      }
      current = rest;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Post a pre-built message to a Discord webhook. Used by city-specific
 * notifiers (e.g. Vancouver's reminder pings) that don't fit the standard
 * "new slot(s)" template. Splits over-long content into multiple ≤2000-char
 * messages (only the first carries the @everyone ping, which sits on line 1).
 * Throws on a non-2xx response.
 */
export async function postDiscord(
  webhookUrl: string,
  content: string,
  options: { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {},
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const chunks = chunkForDiscord(content);
  const executeUrl = new URL(webhookUrl);
  executeUrl.searchParams.set("wait", "true");
  let waitedMs = 0;
  const pause = async (seconds: number | null) => {
    if (seconds == null || seconds < 0 || !Number.isFinite(seconds)) {
      throw new Error("Discord rate limit has no valid retry delay");
    }
    const ms = Math.ceil(seconds * 1000) + 100;
    if (ms > 60_000 || waitedMs + ms > 120_000) {
      throw new Error("Discord rate-limit wait exceeds this run's bounded retry budget");
    }
    waitedMs += ms;
    await sleep(ms);
  };

  for (const [index, chunk] of chunks.entries()) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetchImpl(executeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: chunk }),
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) {
        const receipt = await res.json() as { id?: unknown };
        if (typeof receipt.id !== "string" || !/^\d+$/.test(receipt.id)) {
          throw new Error("Discord returned no message receipt; delivery requires reconciliation");
        }
        console.log(`[discord] Confirmed message ${receipt.id} (${index + 1}/${chunks.length})`);
        if (index < chunks.length - 1 && res.headers.get("X-RateLimit-Remaining") === "0") {
          await pause(secondsValue(res.headers.get("X-RateLimit-Reset-After")));
        }
        break;
      }
      const body = await res.text();
      if (res.status !== 429 || attempt >= 3) {
        throw new Error(`Discord webhook failed (${res.status}): ${body}`);
      }
      let retryAfter: number | null = null;
      try { retryAfter = secondsValue(JSON.parse(body).retry_after); } catch { /* use header */ }
      const headerDelay = secondsValue(res.headers.get("Retry-After"));
      const delays = [retryAfter, headerDelay].filter((value): value is number => value != null);
      console.warn(`[discord] Rate limited; retrying chunk ${index + 1}/${chunks.length}`);
      // 429 rejects this chunk; resume it without replaying already accepted chunks.
      await pause(delays.length ? Math.max(...delays) : null);
    }
  }
}

function secondsValue(value: unknown): number | null {
  if ((typeof value !== "string" && typeof value !== "number") || value === "") return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}
