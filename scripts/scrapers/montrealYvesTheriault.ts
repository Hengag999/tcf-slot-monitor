import type { RegistrationExam } from "../../src/lib/registrationReminders";

export const YVES_THERIAULT_PAGE = "https://centre-yves-theriault.cssdm.gouv.qc.ca/programmes/tests-francais/";
const months = "janvier février mars avril mai juin juillet août septembre octobre novembre décembre".split(" ");
const weekdays = "dimanche lundi mardi mercredi jeudi vendredi samedi".split(" ");
const localHour = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", hour: "numeric", hourCycle: "h23" });
const tcfTitle = "Test de connaissance du français Québec, Canada et tout public.";
const tefTitle = "Test d'évaluation du français (TEF)";
const fridayNote = "Si le nombre de demandes est trop élevé pour l'examen du samedi et que vous êtes inscrit au TCFQ ou TCF TP, ces examens pourraient être devancés le vendredi PM.";

function plain(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&rsquo;|’/gi, "'").replace(/\s+/g, " ").trim().normalize("NFC");
}

function invalid(reason: string): never {
  throw new Error(`Yves-Thériault: ${reason}; registration calendar unknown`);
}

function frenchDate(raw: string): Date {
  const fields = /^(\d{1,2}) ([a-zéûô]+) (20\d\d)$/iu.exec(raw);
  if (!fields) return invalid("unrecognized date");
  const [, day, month, year] = fields;
  const index = months.indexOf(month.toLowerCase());
  const date = new Date(Date.UTC(Number(year), index, Number(day), 18));
  if (index === -1 || date.getUTCMonth() !== index || date.getUTCDate() !== Number(day)) {
    return invalid("invalid calendar date");
  }
  return date;
}

export function parseMontrealYvesTheriault(html: string): RegistrationExam[] {
  const clean = html.replace(/<!--[\s\S]*?-->|<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  if (!/Sur place Se présenter au centre entre 13 h 30 et 15 h les jours d'inscription\./i.test(plain(clean))
      || !/3925,? rue Villeray/i.test(plain(clean))) {
    return invalid("unrecognized in-person registration instructions");
  }
  const headings = [...clean.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]\s*>/gi)];
  const titles = headings.map(heading => plain(heading[1]));
  const i = titles.indexOf(tcfTitle);
  if (i < 1 || titles.lastIndexOf(tcfTitle) !== i || titles[i - 1] !== "Horaire des tests" || titles[i + 1] !== tefTitle) {
    return invalid("unrecognized TCF calendar boundaries");
  }
  const section = clean.slice(headings[i].index! + headings[i][0].length, headings[i + 1].index);
  if (/<(?:del|s|strike)\b|\bhidden\b|display\s*:\s*none|text-decoration\s*:\s*line-through/i.test(section)) {
    return invalid("hidden or struck calendar content");
  }
  const lists = [...section.matchAll(/<ul\b[^>]*>([\s\S]*?)<\/ul>/gi)];
  if (lists.length !== 1) return invalid("expected one session list");
  const remainder = plain(section.replace(lists[0][0], ""));
  if (remainder && remainder !== fridayNote) return invalid("unrecognized calendar notice");
  const rows = [...lists[0][1].matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)];
  if (!rows.length || plain(lists[0][1].replace(/<li\b[^>]*>[\s\S]*?<\/li>/gi, ""))) return invalid("incomplete list");
  const seen = new Set<string>();
  return rows.map(([, row]) => {
    const match = /^(.+?)\s*:\s*inscription le (\p{L}+) (.+)$/iu.exec(plain(row));
    if (!match) return invalid("unrecognized session");
    const exam = frenchDate(match[1]);
    const registration = frenchDate(match[3]);
    if (weekdays[registration.getUTCDay()] !== match[2].toLowerCase() || registration >= exam) {
      return invalid("conflicting registration date");
    }
    const date = exam.toISOString().slice(0, 10);
    if (seen.has(date)) return invalid("duplicate sitting");
    seen.add(date);
    // At 18:00 UTC, Montréal is already observing that day's EST or EDT.
    const registrationOpensAt = registration.getTime() / 1000 + (13.5 - Number(localHour.format(registration))) * 3600;
    const examKey = `montreal-yves-theriault/${date}`;
    return {
      id: examKey, examKey, examType: "TCF Canada", date, label: date,
      schedule: date, location: "Centre Yves-Thériault · 现场报名 13:30–15:00 · 3925, rue Villeray",
      bookingUrl: YVES_THERIAULT_PAGE, registrationWindow: `${match[3]} · 13:30–15:00 (Montréal)`,
      registrationOpensAt, spotsLeft: null, statusClass: "in-person-registration-calendar",
    };
  });
}

export async function scrapeMontrealYvesTheriault(): Promise<RegistrationExam[]> {
  const response = await fetch(YVES_THERIAULT_PAGE, { redirect: "error", signal: AbortSignal.timeout(20000) });
  if (!response.ok || !/^text\/html\b/i.test(response.headers.get("content-type") ?? "")) return invalid(`calendar response HTTP ${response.status}`);
  return parseMontrealYvesTheriault(await response.text());
}

if (process.argv[1]?.endsWith("montrealYvesTheriault.ts")) {
  scrapeMontrealYvesTheriault().then(rows => console.log(rows)).catch(error => { console.error(error); process.exitCode = 1; });
}
