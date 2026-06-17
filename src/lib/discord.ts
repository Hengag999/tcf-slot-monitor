interface SlotInfo {
  date: string;
  bookingUrl: string;
  startTime?: string;
  endTime?: string;
  availableSeats?: number;
}

export async function notifyDiscord(
  webhookUrl: string,
  cityLabel: string,
  examType: string,
  slots: SlotInfo[],
): Promise<void> {
  const slotLines = slots.map((s) => {
    const time = s.startTime && s.endTime ? ` ${s.startTime}–${s.endTime}` : "";
    const seats = s.availableSeats != null ? ` · 剩 ${s.availableSeats} 个名额` : "";
    return `📅 ${s.date}${time}${seats}`;
  });

  const urls = [...new Set(slots.map((s) => s.bookingUrl))];
  const urlLines = urls.map((u) => `👉 立即报名：${u}`);

  const content = [
    `@everyone 🗓️ **${cityLabel}** 新开放 **${examType}** 考位，手慢无！`,
    "",
    ...slotLines,
    "",
    ...urlLines,
  ].join("\n");

  await postDiscord(webhookUrl, content);
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
export async function postDiscord(webhookUrl: string, content: string): Promise<void> {
  for (const chunk of chunkForDiscord(content)) {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: chunk }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Discord webhook failed (${res.status}): ${body}`);
    }
  }
}
