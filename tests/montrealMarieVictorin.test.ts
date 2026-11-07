import { test } from "node:test";
import assert from "node:assert/strict";
import { MARIE_VICTORIN_CATALOG as base, scrapeMontrealMarieVictorin } from "../scripts/scrapers/montrealMarieVictorin";

// Reduced from the public 2026-11-07 catalogue. No session tokens, cart identifiers
// or signed media URLs are needed to distinguish enabled and disabled registration.
function card(id: string, day: string, sold = false) {
  return `<div class='course-card fade-in'>
    ${sold ? "<div class='sold-out-overlay'>Complet</div>" : ""}
    <h3 class='course-title'><a href="${base}/${id}-tcf-canada-montreal-qc-${day}-novembre-2026">TCF CANADA</a></h3>
    <div class='course-date'><i class='fa fa-calendar'></i>${day} novembre 2026 à 09h00</div>
    <a id="add_${id}" class="course-cta ${sold ? "disabled" : ""}" style="" title="Ajouter au panier"
       ${sold ? 'onclick="return false;"' : ""} data-remote="true" data-method="post" href="/fr/students/carts_sessions?session_id=${id}">+</a>
    <a class="course-cta" id="cart_link_${id}" style="display:none" title="Finaliser la commande">✓</a>
    </div>`;
}
const emptyNotice = "Essayer un autre critère de recherche, celui-ci n&#39;a pas de succès";
function listing(cards: string[], count = cards.length, next = "") {
  return `<img alt="Cegep Marie-Victorin - Tests de français logo"><div class='results-count text-sm'>
  <strong class='font-semibold'>${count}</strong> cours trouvé(s)</div><div id='courses'>${cards.length
    ? `<div id='courses-list'>${cards.join("")}</div>` : `<div class='alert alert-info'>${emptyNotice}</div>`}</div>
  <div id='courses_paginate'>${next}</div>`;
}
function readAt(now: Date, ...pages: string[]) {
  let page = 0;
  return scrapeMontrealMarieVictorin({ now, fetchImpl: async (url, opts) => {
    assert.equal(url, page === 0 ? base : `${base}?page=${page + 1}`);
    assert.equal(opts?.method ?? "GET", "GET");
    return new Response(pages[page++]);
  } });
}
function read(...pages: string[]) {
  return readAt(new Date("2026-11-07T12:00:00Z"), ...pages);
}
const open = card("39030", "25"), sold = card("39026", "11", true);
test("Marie-Victorin returns only the enabled Montreal TCF Canada card", async () => {
  assert.deepEqual(await read(listing([sold, open])), [{id:"39030",examType:"TCF Canada",date:"2026-11-25",
    bookingUrl:`${base}/39030-tcf-canada-montreal-qc-25-novembre-2026`,startTime:"09:00"}]);
});
test("Marie-Victorin keeps today's sitting through local midnight and still validates stale cards", async () => {
  const afterMidnight = new Date("2026-11-26T05:00:00Z");
  const dates = listing([card("39026", "11"), open]);
  assert.deepEqual((await readAt(new Date("2026-11-26T04:59:59Z"), dates)).map(slot => slot.date), ["2026-11-25"]);
  assert.deepEqual(await readAt(afterMidnight, dates), []);
  await assert.rejects(readAt(afterMidnight, listing([open.replace("Ajouter au panier", "Bientôt")])), /registration action/);
});
test("Marie-Victorin requires a complete, consistent public catalogue", async () => {
  const next = '<a rel="next" href="?page=2">Suivant</a>';
  assert.equal((await read(listing([sold],2,next), listing([open],2))).length, 1);
  for (const html of [listing([open],2),listing([open,open]),listing([open],2,next.replace("?page=2","https://example.org/?page=2")),
    listing([]).replace(emptyNotice,""),listing([open]).replace("français logo","training logo"),
    listing([open]).replace('id=\'courses\'','id=\'active_filters\'')]) await assert.rejects(read(html));
  assert.deepEqual(await read(listing([])), []);
});
test("Marie-Victorin preserves unknown state on contradictory identity, date, or registration controls", async () => {
  for (const html of [open.replace("à 09h00","à 29h00"),open.replace("25 novembre 2026","11 novembre 2026"),
    open.replace('style=""','style="display:none"'),open.replace("session_id=39030","session_id=39026"),
    sold.replace("sold-out-overlay","stale"),open.replace('href="https://cmvtcf.webinscription.com','href="https://example.org'),
    open.replace("TCF CANADA</a>","TCF QUÉBEC</a>"),open.replace("Ajouter au panier","Bientôt")]) {
    await assert.rejects(read(listing([html])));
  }
});
