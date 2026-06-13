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
    const time = s.startTime && s.endTime ? ` — ${s.startTime} to ${s.endTime}` : "";
    const seats = s.availableSeats != null ? ` (${s.availableSeats} seats)` : "";
    return `📅 ${s.date}${time}${seats}`;
  });

  const urls = [...new Set(slots.map((s) => s.bookingUrl))];
  const urlLines = urls.map((u) => `👉 ${u}`);

  const content = [
    `@everyone 🗓️ New **${examType}** slot(s) — **${cityLabel}**!`,
    "",
    ...slotLines,
    "",
    ...urlLines,
  ].join("\n");

  await postDiscord(webhookUrl, content);
}

/**
 * Post a pre-built message to a Discord webhook. Used by city-specific
 * notifiers (e.g. Vancouver's reminder pings) that don't fit the standard
 * "new slot(s)" template. Throws on a non-2xx response.
 */
export async function postDiscord(webhookUrl: string, content: string): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Discord webhook failed (${res.status}): ${body}`);
  }
}
