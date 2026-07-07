// Paste-ready snippet for mcp__claude-in-chrome__javascript_tool, run on a
// Discord channel page (https://discord.com/channels/<server>/<channel>).
// Returns the last N rendered messages with exact UTC timestamps.
//
// Why JS-over-DOM instead of get_page_text: get_page_text only returns the
// embed preview text and no timestamps. Discord virtualizes the list (~14
// messages rendered for busy channels), which is enough for latest-ping +
// recent cadence.
//
// The poll loop matters: after a channel navigation the list paints 1-2s
// late, so an immediate query returns 0 items.
let items = [];
for (let i = 0; i < 20; i++) {
  items = [...document.querySelectorAll('li[id^="chat-messages-"]')];
  if (items.length) break;
  await new Promise(r => setTimeout(r, 500));
}
items.slice(-8).map(li => {
  const t = li.querySelector('time[datetime]');
  const b = li.querySelector('[id^="message-content-"]');
  return {
    time: t?.getAttribute('datetime'),
    text: (b?.innerText || '').slice(0, 200).replace(/\n/g, ' | '),
  };
});
