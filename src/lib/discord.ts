interface SlotInfo {
  date: string;
  bookingUrl: string;
  startTime?: string;
  endTime?: string;
}

export async function notifyDiscord(
  webhookUrl: string,
  cityLabel: string,
  examType: string,
  slots: SlotInfo[],
): Promise<void> {
  const slotLines = slots.map((s) => {
    const time = s.startTime && s.endTime ? ` — ${s.startTime} to ${s.endTime}` : "";
    return `📅 ${s.date}${time}`;
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
