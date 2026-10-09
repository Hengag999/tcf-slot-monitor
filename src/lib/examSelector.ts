// Shared Oncord exam-selector listing parser (AF-CAPA and AF Edmonton).
// Follow the server-rendered Show More links: the initial table has only 15 rows.
import { createHash } from "node:crypto";
import type { RegistrationExam } from "./registrationReminders";

const LISTING_PAGE = "https://www.alliancefrancaise.ca/en/language/exams/tcf-canada/";
const HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; tcf-slot-monitor/1.0)" };
const MAX_PAGES = 20;
// These are the booking states observed in the public exam-selector markup.
// A new source status must be investigated instead of silently becoming an
// unavailable row that advances the monitor's last-known snapshot.
const BOOKING_STATUSES = new Set([
  "es-status-available", "es-status-closed", "es-status-full", "es-status-opens-soon",
]);

export interface ExamSelectorRow extends RegistrationExam {
  location: string;
  // Alias for reminder state written before keys distinguished sites/sittings.
  legacyExamKey: string;
  // Positive source evidence: an available status on a real same-origin link.
  bookingAvailable: boolean;
}

export interface ExamSelectorOptions {
  url?: string;
  keyPrefix?: string;
  fetchImpl?: typeof fetch;
}

function decodeEntities(s: string): string {
  return s.replace(/&(?:amp|nbsp|quot|apos|lt|gt);|&#(?:x[\da-f]+|\d+);/gi, (entity) => {
    const names: Record<string, string> = { "&amp;": "&", "&nbsp;": " ", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">" };
    if (!entity.startsWith("&#")) return names[entity.toLowerCase()];
    const value = entity.slice(2, -1);
    const code = value[0].toLowerCase() === "x" ? parseInt(value.slice(1), 16) : Number(value);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<svg[\s\S]*?<\/svg>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ").trim();
}

function attr(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  return match ? decodeEntities(match[1] ?? match[2]) : undefined;
}

function hasClass(tag: string, name: string): boolean {
  return (attr(tag, "class") ?? "").split(/\s+/).includes(name);
}

function sameOriginUrl(href: string, base: string): string {
  const url = new URL(href, base);
  if (url.origin !== new URL(base).origin || !/^https?:$/.test(url.protocol) || url.username || url.password) {
    throw new Error("exam-selector: unexpected cross-origin URL");
  }
  url.hash = "";
  return url.href;
}

/** Parse one complete server page. No network, state, or notification side effects. */
export function parseExamSelectorPage(
  html: string,
  listingPage: string = LISTING_PAGE,
  keyPrefix = "tcf",
): { exams: ExamSelectorRow[]; nextUrl: string | null } {
  const table = [...html.matchAll(/(<table\b[^>]*>)([\s\S]*?)<\/table>/gi)]
    .find((match) => hasClass(match[1], "es-exams-table"));
  if (!table) throw new Error("exam-selector: exam table not found — page structure may have changed");

  const exams: ExamSelectorRow[] = [];
  const allRows = [...table[2].matchAll(/(<tr\b[^>]*>)([\s\S]*?)<\/tr>/gi)];
  const rowMarkers = [...table[2].matchAll(/<tr\b[^>]*>/gi)];
  if (rowMarkers.length !== allRows.length) throw new Error("exam-selector: incomplete exam row markup");
  // Headers and an empty table are valid. Data rows with a changed class must
  // not disappear from the snapshot merely because the old selector misses.
  for (const row of allRows.filter((match) => !hasClass(match[1], "tableRow"))) {
    const outsideHeaders = row[2].replace(/<th\b[^>]*>[\s\S]*?<\/th>/gi, "");
    if (/<td\b/i.test(row[2]) || stripTags(outsideHeaders)) {
      throw new Error("exam-selector: unrecognized data row markup; snapshot not accepted");
    }
  }
  const rows = allRows.filter((match) => hasClass(match[1], "tableRow"));

  for (const row of rows) {
    const cells = [...row[2].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1]);
    const cellMarkers = [...row[2].matchAll(/<t[dh]\b[^>]*>/gi)];
    if (cells.length !== 7 || cellMarkers.length !== 7) {
      throw new Error(`exam-selector: expected 7 exam columns, found ${cells.length} complete cells and ${cellMarkers.length} cell markers`);
    }
    const label = stripTags(cells[0]);
    if (!label) throw new Error("exam-selector: exam row has no label");
    if (!/\btcf[\s-]+canada\b/i.test(label)) continue;

    const schedule = stripTags(cells[1]);
    const registrationWindow = stripTags(cells[2]);
    const location = stripTags(cells[3]);
    if (!schedule || !location) throw new Error(`exam-selector: missing schedule/location for ${label}`);
    const spotsText = stripTags(cells[4]);
    const spotsMatch = spotsText.match(/^\d+$/);
    let spotsLeft = /sold\s*out|full|complet/i.test(spotsText) ? 0 : spotsMatch ? Number(spotsMatch[0]) : null;

    const bookings = cells[6];
    const bookingTags = [...bookings.matchAll(/<[a-z][^>]*>/gi)].map((match) => match[0]);
    const statusTags = bookingTags.filter((tag) => hasClass(tag, "es-status"));
    if (statusTags.length > 1) {
      throw new Error(`exam-selector: ambiguous booking status for ${label}`);
    }
    const statusTag = statusTags[0];
    const statusClasses = [...new Set((attr(statusTag ?? "", "class") ?? "").split(/\s+/)
      .filter((value) => value.startsWith("es-status-")))];
    if (statusClasses.length > 1) {
      throw new Error(`exam-selector: conflicting booking status classes for ${label}`);
    }
    let statusClass = statusClasses[0] ?? "es-status-unknown";
    // The public Oncord client documents a separate held-seat countdown card,
    // without es-status: every seat is temporarily reserved, not bookable.
    // Its expiry is NOT a registration opening time. Never invent availability
    // from an expired countdown; a subsequent page must expose Book Now.
    const heldCard = bookingTags.find((tag) => hasClass(tag, "es-held-card"));
    if (heldCard) {
      const expiry = attr(heldCard, "data-held-expires-at");
      if (statusTag || bookingTags.some((tag) => /^<a\b/i.test(tag)) || !/\bspots\s+held\b/i.test(stripTags(bookings))
        || !expiry || !/^\d+$/.test(expiry) || !Number.isSafeInteger(Number(expiry)) || Number(expiry) <= 0) {
        throw new Error(`exam-selector: malformed or conflicting held booking status for ${label}`);
      }
      statusClass = "es-status-held";
      spotsLeft = 0;
    }
    if (statusClass === "es-status-unknown") {
      // Structural flags only: do not dump HTML, URLs or embedded tokens.
      const flags = `tags=${bookingTags.length},text=${Boolean(stripTags(bookings))},heldExpiry=${bookingTags.some((tag) => attr(tag, "data-held-expires-at") !== undefined)},links=${bookingTags.filter((tag) => /^<a\b/i.test(tag)).length}`;
      throw new Error(`exam-selector: missing booking status for ${label} (${flags})`);
    }
    if (!heldCard && !BOOKING_STATUSES.has(statusClass)) {
      throw new Error(`exam-selector: unsupported booking status for ${label}`);
    }
    const epoch = attr(statusTag ?? "", "data-opens-at");
    if (epoch !== undefined && (!/^\d+$/.test(epoch) || !Number.isSafeInteger(Number(epoch)) || Number(epoch) <= 0)) {
      throw new Error(`exam-selector: invalid registration epoch for ${label}`);
    }
    const registrationOpensAt = epoch === undefined ? null : Number(epoch);
    if (statusClass === "es-status-opens-soon" && registrationOpensAt === null) {
      throw new Error(`exam-selector: upcoming registration has no epoch for ${label}`);
    }
    const href = statusTag && /^<a\b/i.test(statusTag) ? attr(statusTag, "href") : undefined;
    const bookingUrl = href ? sameOriginUrl(href, listingPage) : new URL(listingPage).origin + new URL(listingPage).pathname;
    const bookingAvailable = statusClass === "es-status-available" && Boolean(href);
    if (statusClass === "es-status-available" && !bookingAvailable) {
      throw new Error(`exam-selector: available exam has no booking link for ${label}`);
    }

    const legacyExamKey = `tcf-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
    // Closed rows have no source ID. Keep '*' (Edmonton's afternoon marker),
    // location, and the first sitting schedule/year; do not key on mutable
    // status, registration window, booking link, or a later-confirmed oral time.
    const firstSchedule = cells[1].match(/<div\b[^>]*class=["']es-schedule-group["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? cells[1];
    const identity = [label, stripTags(firstSchedule), location].map((part) => part.normalize("NFKC").toLowerCase());
    const examKey = `${keyPrefix}-${createHash("sha256").update(JSON.stringify(identity)).digest("hex").slice(0, 20)}`;
    exams.push({ id: examKey, examType: "TCF Canada", date: label, bookingUrl, examKey, legacyExamKey,
      label, schedule, registrationWindow, registrationOpensAt, spotsLeft, statusClass, location, bookingAvailable });
  }

  const moreLinks = [...html.matchAll(/<a\b[^>]*>/gi)].map((match) => match[0]).filter((tag) => hasClass(tag, "dataShowMore"));
  if (moreLinks.length > 1) throw new Error("exam-selector: ambiguous Show More links");
  let nextUrl: string | null = null;
  if (moreLinks.length) {
    const href = attr(moreLinks[0], "href");
    if (!href) throw new Error("exam-selector: Show More link has no URL");
    nextUrl = sameOriginUrl(href, listingPage);
    if (new URL(nextUrl).pathname !== new URL(listingPage).pathname) throw new Error("exam-selector: unexpected pagination path");
  }
  return { exams, nextUrl };
}

/** Fetch every page or fail the whole scrape; never clear state using a partial listing. */
export async function scrapeTcfListing(options: ExamSelectorOptions = {}): Promise<ExamSelectorRow[]> {
  const listingPage = options.url ?? LISTING_PAGE;
  const fetchImpl = options.fetchImpl ?? fetch;
  const seenPages = new Set<string>();
  const byKey = new Map<string, ExamSelectorRow>();
  let nextUrl: string | null = listingPage;
  while (nextUrl) {
    if (seenPages.has(nextUrl) || seenPages.size >= MAX_PAGES) throw new Error("exam-selector: pagination loop or page limit reached");
    seenPages.add(nextUrl);
    const res = await fetchImpl(nextUrl, { headers: HEADERS, redirect: "error", signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`exam-selector listing fetch failed: ${res.status}`);
    if (res.url && new URL(res.url).origin !== new URL(listingPage).origin) throw new Error("exam-selector: unexpected listing origin");
    const page = parseExamSelectorPage(await res.text(), nextUrl, options.keyPrefix);
    let added = 0;
    for (const exam of page.exams) {
      const existing = byKey.get(exam.examKey);
      if (existing && JSON.stringify(existing) !== JSON.stringify(exam)) throw new Error(`exam-selector: conflicting duplicate exam ${exam.label}`);
      if (!existing) { byKey.set(exam.examKey, exam); added++; }
    }
    if (seenPages.size > 1 && added === 0) throw new Error("exam-selector: pagination made no progress");
    nextUrl = page.nextUrl;
  }
  return [...byKey.values()];
}

export function printExamRows(cityKey: string, exams: ExamSelectorRow[]): void {
  if (exams.length === 0) { console.log(`[${cityKey}] No exams listed on the page.`); return; }
  console.log(`\n[${cityKey}] ${exams.length} exam(s):\n`);
  for (const e of exams) {
    const opens = e.registrationOpensAt ? new Date(e.registrationOpensAt * 1000).toISOString() : "n/a";
    console.log(`  ${e.label}\n    schedule: ${e.schedule}\n    registration: ${e.registrationWindow}\n    location: ${e.location}\n    opens-at: ${opens} | status: ${e.statusClass} | spots: ${e.spotsLeft}\n    ${e.bookingUrl}\n`);
  }
}
