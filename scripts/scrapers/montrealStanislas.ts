// COBA exposes the Montréal TCF Canada catalogue to guests. A candidate needs
// both the four-part exam and the corresponding administrative fee to be open.
import { fetchStanislasInventory } from "../../src/lib/stanislasGuest";

export const STANISLAS_CALENDAR = "https://stanislas.qc.ca/tcf/";
export const STANISLAS_REGISTRATION = "https://monportail.stanislas.qc.ca/capnet/login.asp?NoRegr=3";

function text(html: string) {
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ").trim();
}

function invalid(reason: string): never {
  throw new Error(`Stanislas Montréal: ${reason}; availability unknown`);
}

const monthNumber: Record<string, number> = {
  JAN: 1, JANV: 1, JANVIER: 1, FEV: 2, FEVRIER: 2, MARS: 3, AV: 4, AVR: 4, AVRIL: 4,
  MAI: 5, JUIN: 6, JUIL: 7, JUILLET: 7, AOUT: 8, SEPT: 9, SEPTEMBRE: 9,
  OCT: 10, OCTOBRE: 10, NOV: 11, NOVEMBRE: 11, DEC: 12, DECEMBRE: 12,
};

function isoDate(label: string) {
  const match = /^(\d{1,2}) ([A-Z]+)\.?\s*(\d{2}|20\d{2})$/.exec(label);
  if (!match) invalid("unrecognized activity date");
  const [, dayText, monthText, yearText] = match;
  const year = yearText.length === 2 ? Number("20" + yearText) : Number(yearText);
  const month = monthNumber[monthText];
  if (!month || +dayText < 1 || +dayText > new Date(Date.UTC(year, month, 0)).getUTCDate()) invalid("invalid calendar date");
  return `${year}-${String(month).padStart(2, "0")}-${dayText.padStart(2, "0")}`;
}

function parseRow(html: string) {
  const heading = html.match(/<h4\b[^>]*>([\s\S]*?)<\/h4>/i);
  if (!heading || heading.index === undefined) invalid("missing activity heading");
  const label = text(heading[1]).normalize("NFD").replace(/\p{M}/gu, "").toUpperCase();
  const fee = /^FRAIS ADMINISTRATIFS - FRAIS ADM (.+?) CA(?:\s*-?\s*PM)?$/.exec(label);
  const exam = /^TCF CANADA - TCFCA \(CO EO CE EE\) (.+?)(?: P)?$/.exec(label);
  if (!exam && !fee) invalid("unrecognized activity in TCF Canada results");
  const date = isoDate((exam ?? fee)![1]);

  let details = text(html.slice(heading.index + heading[0].length)).replace(/\s+keyboard_arrow_down$/, "");
  const schedule = /^(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche) (\d{1,2} [\p{L}]+ 20\d{2}) de \d{2}:\d{2} à \d{2}:\d{2} /iu.exec(details);
  if (schedule) {
    const scheduledDate = schedule[1].normalize("NFD").replace(/\p{M}/gu, "").toUpperCase();
    if (isoDate(scheduledDate) !== date) invalid("activity label and schedule disagree");
    details = details.slice(schedule[0].length);
  }
  const priceAndPrerequisite = exam
    ? /^Tarif : [\d\s]+,\d\d\$ Préalable\(s\) requis (.+)$/
    : /^Tarif : [\d\s]+,\d\d\$ (.+)$/;
  const status = priceAndPrerequisite.exec(details)?.[1];
  if (!status) invalid("unknown activity fields or prerequisites");
  const count = /^(\d+) places? restantes?$/.exec(status);
  const closed = /^(?:Complet|Inscription terminée(?: le \d{2}-\d{2}-\d{4})?|Inscription à partir du \d{2}-\d{2}-\d{4}, \d{2}:\d{2})$/i.test(status);
  if (!closed && (!count || !Number.isSafeInteger(Number(count[1])))) invalid("unknown registration status");
  return { kind: exam ? "exam" : "fee", date, seats: count ? Number(count[1]) : 0 } as const;
}

export function parseMontrealStanislas(html: string, now = new Date()) {
  const content = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  const context = text(content);
  if (!context.includes("Accueil > CENTRE DE MONTRÉAL: CALENDRIER DES SESSIONS > TCF CANADA")
      || !/Recherche de TCF dans le répertoire TCF CANADA\s*\./.test(context)) invalid("wrong catalogue or search scope");
  const totals = [...context.matchAll(/\((\d+)\s*-\s*(\d+) de (\d+) éléments?\)/g)];
  const tables = [...content.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table\s*>/gi)];
  if (totals.length !== 1 || tables.length !== 1) invalid("missing unique activity grid or result count");
  const rows = [...tables[0][1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)];
  const [, first, last, total] = totals[0];
  if (first !== "1" || !rows.length || last !== total || Number(total) !== rows.length) invalid("incomplete results");
  const exams = new Map<string, number>();
  const fees = new Map<string, number>();
  for (const row of rows) {
    const {kind, date, seats} = parseRow(row[1]);
    const map = kind === "exam" ? exams : fees;
    if (map.has(date)) invalid("duplicate exam or fee date");
    map.set(date, seats);
  }
  if (!exams.size || !fees.size) invalid("missing exam or administrative-fee activities");
  const today = new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: "America/Toronto",
  }).format(now);
  const slots = [];
  for (const [date, examSeats] of [...exams].sort(([a], [b]) => a.localeCompare(b))) {
    if (date < today || !examSeats) continue;
    const feeSeats = fees.get(date);
    if (feeSeats === undefined) invalid("open exam lacks its dated administrative prerequisite");
    if (feeSeats > 0) {
      // COBA reports two separate counts. A single seat count in Discord would
      // obscure which activity it belongs to.
      slots.push({id: `montreal-stanislas-${date}`, examType: "TCF Canada", date, bookingUrl: STANISLAS_REGISTRATION});
    }
  }
  // A future fee alone can indicate an exam that disappeared from the search.
  for (const [date, seats] of fees) {
    if (date >= today && seats > 0 && !exams.has(date)) invalid("open fee lacks its dated exam");
  }
  return slots;
}

export async function scrapeMontrealStanislas() {
  return parseMontrealStanislas(await fetchStanislasInventory());
}

if (process.argv[1]?.endsWith("/montrealStanislas.ts")) {
  scrapeMontrealStanislas().then(slots => console.log(slots)).catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
