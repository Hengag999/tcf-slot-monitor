import assert from "node:assert/strict";
import test from "node:test";
import { fetchStanislasInventory } from "../src/lib/stanislasGuest";

const action = (n: number, param: string) => encodeURIComponent(JSON.stringify({ action: n, param }));
const campus = "CENTRE DE MONTRÉAL: CALENDRIER DES SESSIONS";
const anchor = (label: string, id: string, n: number, param: string) =>
  `<a id='${id}' data-action="${action(n, param)}">${label}</a>`;
const component = (contents: string) =>
  `<div class="pagecoba" id="C123" data-param-refresh="refresh">${contents}<input type="hidden" name="C123__cpss" value="test-state"></div>`;
const login = component(`<input name="C123_txtMotDePasse" type="password" value="unused-test-value">
    <button id="C123_btnConnecterInvite" data-action="${action(2, "guest")}">Créer un compte</button>`);
const catalog = component(`<h3>TCF QUÉBEC</h3>${anchor("SESSION DU 01 MAI", "C123_lienArboRep2", 2, "other")}
    <h3>TCF CANADA</h3>${anchor("SESSION DU 02 MAI", "C123_lienArboRep3", 2, "session")}`);
const search = component('<input name="C123_txtRecherche" type="text">');

test("guest search follows only Montreal's TCF Canada directory and submits anonymous navigation fields", async t => {
  const expected = [
    ["login.asp?NoRegr=3", login],
    ["compo.coba?guest", JSON.stringify([{ Code: "rediriger", Item1: "index.coba", Item2: "portal" }])],
    ["index.coba?portal", "Compte invité" + anchor(campus, "lnk123", 1, "campus")],
    ["compo.coba?campus", catalog],
    ["compo.coba?session", component('<div class="pagecoba" id="pageGrilleInscriptionsItems"></div>' + anchor("TCF CANADA", "C123_lnkfil0", 2, "canada"))],
    ["compo.coba?canada", search],
    ["compo.coba?refresh", "<p>Inventory</p>"],
  ];
  let step = 0;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    const [path, result] = expected[step++];
    assert.equal(url, "https://monportail.stanislas.qc.ca/capnet/" + path);
    assert.equal(init.redirect, "error");
    const fields = init.body as FormData | undefined;
    if (fields) {
      assert.equal(fields.has("C123_txtMotDePasse"), false);
      assert.equal(fields.get("C123__cpss"), "test-state");
    }
    if (step === 7) assert.equal(fields?.get("C123_txtRecherche"), "TCF");
    return new Response(result, { headers: { "content-type": step === 2 ? "application/json" : "text/html" } });
  });
  assert.equal(await fetchStanislasInventory(), "<p>Inventory</p>");
  assert.equal(step, expected.length);
});

test("unexpected guest control cannot submit a dossier form", async t => {
  const mock = t.mock.method(globalThis, "fetch", async () =>
    new Response(login.replace("C123_btnConnecterInvite", "C123_submitProfile"), {headers: {"content-type": "text/html"}}));
  await assert.rejects(fetchStanislasInventory(), /guest entry unexpected control/);
  assert.equal(mock.mock.callCount(), 1);
});
