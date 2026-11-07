import test from "node:test";
import assert from "node:assert/strict";
import { parseMontrealStanislas, STANISLAS_REGISTRATION } from "../scripts/scrapers/montrealStanislas";

const at = new Date("2026-11-08T02:30:00Z"); // November 7 in Montréal
const campus = "CENTRE DE MONTRÉAL: CALENDRIER DES SESSIONS";
const exam = (date: string, status: string) => row("TCF CANADA - TCFCA (CO EO CE EE) " + date, status, true);
const fee = (date: string, status: string) => row("FRAIS ADMINISTRATIFS - FRAIS ADM " + date + " CA", status, false);
function row(title: string, status: string, prerequisite: boolean) {
  return `<tr class="grid3__row"><td><h4>${title}</h4><span>Tarif : ${prerequisite ? "395" : "25"},00$</span>${prerequisite ? "<b>Préalable(s) requis</b>" : ""}<span>${status}</span></td><td><i>keyboard_arrow_down</i></td></tr>`;
}
function results(...rows: string[]) {
  return `<a>Accueil</a> &gt; <a>${campus}</a> &gt; <a>TCF CANADA</a><span>Recherche de <b>TCF</b> dans le répertoire <b>TCF CANADA</b>.</span><table>${rows.join("")}</table><span>(1 - ${rows.length} de ${rows.length} éléments)</span>`;
}

test("Stanislas requires seats on the full exam and its same-date administrative fee", () => {
  const slots = parseMontrealStanislas(results(
    exam("14 NOV. 26", "26 places restantes"), fee("14 NOV. 2026", "23 places restantes"),
    exam("5 DEC 26 P", "Complet"), fee("5 DEC. 2026", "Complet"),
    exam("19 JUIN 27", "116 places restantes"), fee("19 JUIN 2027", "Inscription à partir du 23-11-2026, 00:00"),
    exam("3 AV. 27", "Inscription à partir du 09-11-2026, 00:00"), fee("3 AVRIL 2027", "115 places restantes"),
    exam("12 JUIL.25", "Inscription terminée le 11-07-2026"),
    exam("07 NOV.26", "1 place restante"), fee("07 NOV. 2026", "1 place restante"),
    exam("5 JUIN 27", "127 places restantes"), fee("5 JUIN 2027", "116 places restantes")
      .replace("<span>Tarif", "<span>Samedi 5 juin 2027 de 08:45 à 17:00 Tarif"),
  ), at);
  assert.deepEqual(slots.map(s => s.date), ["2026-11-07", "2026-11-14", "2027-06-05"]);
  assert.ok(slots.every(s => s.bookingUrl === STANISLAS_REGISTRATION && !("availableSeats" in s)));
});

test("a complete recognised closed inventory can clear state; incomplete or unfamiliar results fail", () => {
  const examRow = exam("14 NOV. 26", "26 places restantes");
  const feeRow = fee("14 NOV. 2026", "23 places restantes");
  const paired = results(examRow, feeRow);
  assert.deepEqual(parseMontrealStanislas(results(exam("14 NOV. 26", "Inscription terminée"), feeRow), at), []);
  for (const malformed of [
    paired.replace(campus, "CENTRE DE QUÉBEC"), paired.replace("répertoire <b>TCF CANADA", "répertoire <b>ACCUEIL"),
    paired.replace("2 de 2", "2 de 30"), paired.replace("26 places restantes", "sur demande"),
    paired.replace("14 NOV. 26", "31 FÉV. 27"), paired.replace("CO EO CE EE", "CO CE"),
    paired.replace("Tarif : 25", "Samedi 21 novembre 2026 de 08:45 à 17:00 Tarif : 25"),
    paired.replace("Préalable(s) requis", "À déterminer"), paired.replace("26 places restantes", "26 places restantes Complet"),
    results(examRow), results(examRow, fee("12 NOV. 2026", "1 place restante")),
    results(examRow, feeRow, feeRow), results(examRow, feeRow, examRow), results(),
  ]) assert.throws(() => parseMontrealStanislas(malformed, at), /availability unknown/);
});
