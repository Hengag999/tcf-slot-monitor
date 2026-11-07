// COBA renders its public Montréal TCF catalogue inside an anonymous guest
// session. Navigation and search use the same component postbacks as the UI.
// Only navigation state and the fixed search term are sent.
const BASE = "https://monportail.stanislas.qc.ca/capnet/";
const MONTREAL = "CENTRE DE MONTRÉAL: CALENDRIER DES SESSIONS";
const CANADA = "TCF CANADA";

function unavailable(reason: string): never {
  throw new Error(`Stanislas guest catalogue: ${reason}`);
}

function attr(tag: string, name: string): string | undefined {
  return new RegExp(`(?:^|\\s)${name}=(["'])([\\s\\S]*?)\\1`, "i").exec(tag)?.[2];
}

function controls(html: string, kind: "button" | "a" | "h3") {
  const pattern = new RegExp(`<${kind}\\b([^>]*)>([\\s\\S]*?)</${kind}\\s*>`, "gi");
  return [...html.matchAll(pattern)].map(match => ({
    tag: match[1], label: match[2].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
    start: match.index!, end: match.index! + match[0].length,
  }));
}

function uniqueControl(html: string, kind: "button" | "a", label: string) {
  const matches = controls(html, kind).filter(control => control.label === label);
  if (matches.length !== 1) unavailable("missing or ambiguous navigation control");
  return matches[0].tag;
}

function actionParameter(tag: string, expectedAction: 1 | 2): string {
  let action;
  try {
    action = JSON.parse(decodeURIComponent(attr(tag, "data-action") || ""));
  } catch {
    unavailable("invalid navigation action");
  }
  if (action?.action !== expectedAction || typeof action.param !== "string" ||
      !action.param || action.param.length > 4096 || /[\s#]/.test(action.param) ||
      action.uploadFiles) unavailable("unexpected navigation action");
  return action.param;
}

function component(html: string) {
  const roots = [...html.matchAll(/<div\b[^>]*>/gi)]
    .map(match => match[0]).filter(tag => attr(tag, "class")?.split(/\s+/).includes("pagecoba") && /^C[\dA-F]+$/i.test(attr(tag, "id") ?? ""));
  if (roots.length !== 1) unavailable("unexpected component structure");
  const id = attr(roots[0], "id");
  const refresh = attr(roots[0], "data-param-refresh");
  if (!id || !/^C[\dA-F]+$/i.test(id) || !refresh || refresh.length > 4096 || /[\s#]/.test(refresh)) {
    unavailable("missing component state");
  }
  return { id, refresh };
}

function navigationForm(html: string, controlId: string, search = "") {
  const { id } = component(html);
  if (!controlId.startsWith(id + "_")) unavailable("mismatched component");
  const fields = new FormData();
  for (const match of html.matchAll(/<input\b[^>]*>/gi)) {
    const name = attr(match[0], "name");
    if (name === id + "__cpss" && attr(match[0], "type") === "hidden") fields.append(name, attr(match[0], "value") ?? "");
    else if (name === id + "_txtRecherche") fields.append(name, search);
  }
  if (fields.getAll(id + "__cpss").length !== 1 || !fields.get(id + "__cpss")) unavailable("missing guest view state");
  if (search && fields.getAll(id + "_txtRecherche").length !== 1) unavailable("missing inventory search");
  fields.append("__postcomponent", controlId);
  fields.append("__isautopb", "");
  fields.append("__addparam", "");
  fields.append("__id", id);
  fields.append("__rootpage", id);
  fields.append("__ts", String(Math.random()));
  return fields;
}

export async function fetchStanislasInventory(): Promise<string> {
  const cookies = new Map<string, string>();
  const signal = AbortSignal.timeout(50_000);

  async function request(path: "login.asp" | "index.coba" | "compo.coba", param: string, stage: string, body?: FormData, json = false) {
    const headers: Record<string, string> = {
      "User-Agent": "TCF-Slot-Monitor/1.0 (+https://github.com/Hengag999/tcf-slot-monitor)",
    };
    if (cookies.size) headers.Cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    if (body) {
      headers.Origin = new URL(BASE).origin;
      headers["X-Requested-With"] = "XMLHttpRequest";
    }
    let response: Response;
    try {
      response = await fetch(BASE + path + "?" + param, { method: body ? "POST" : "GET", body, headers, redirect: "error", signal });
    } catch {
      unavailable(`${stage} request failed`);
    }
    if (!response.ok) unavailable(`${stage} HTTP ${response.status}`);
    const expected = json ? "application/json" : "text/html";
    if (response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== expected) {
      unavailable(`${stage} unexpected response type`);
    }
    for (const cookie of response.headers.getSetCookie()) {
      const pair = /^([^=;\s]+)=([^;\r\n]*)/.exec(cookie);
      if (pair) cookies.set(pair[1], pair[2]);
    }
    try {
      return await response.text();
    } catch {
      unavailable(`${stage} response interrupted`);
    }
  }

  async function navigate(html: string, tag: string, idSuffix: RegExp, stage: string, json = false) {
    const controlId = attr(tag, "id") ?? "";
    if (!idSuffix.test(controlId)) unavailable(`${stage} unexpected control`);
    return request("compo.coba", actionParameter(tag, 2), stage, navigationForm(html, controlId), json);
  }

  const login = await request("login.asp", "NoRegr=3", "login page");
  const entry = uniqueControl(login, "button", "Créer un compte");
  // The guest entry opens the anonymous view. Creating a personal dossier
  // requires a separate form inside this view.
  const reply = await navigate(login, entry, /^C[\dA-F]+_btnConnecterInvite$/i, "guest entry", true);
  let redirect;
  try {
    const commands: unknown = JSON.parse(reply);
    if (Array.isArray(commands)) redirect = commands.find(command => command?.Code === "rediriger");
  } catch {
    unavailable("invalid guest response");
  }
  if (redirect?.Item1 !== "index.coba" || typeof redirect.Item2 !== "string" || !redirect.Item2 ||
      redirect.Item2.length > 4096 || /[\s#]/.test(redirect.Item2)) unavailable("unexpected guest redirect");
  const guest = await request("index.coba", redirect.Item2, "guest catalogue");
  if (!guest.includes("Compte invité")) unavailable("guest view missing");
  const montreal = await request("compo.coba", actionParameter(uniqueControl(guest, "a", MONTREAL), 1), "Montréal catalogue");

  // The catalogue provides date-folder links below its TCF CANADA heading.
  // Open one to obtain the Canada category breadcrumb, then search the entire
  // category once. Each link's opaque value belongs to this guest session.
  const headings = controls(montreal, "h3");
  const groups = headings.filter(heading => heading.label === CANADA);
  if (groups.length !== 1) unavailable("missing or ambiguous Canada group");
  const group = groups[0];
  const section = montreal.slice(group.end, headings[headings.indexOf(group) + 1]?.start);
  const dateLink = controls(section, "a").find(link => /^SESSION (?:DU )?\d{1,2}\b/i.test(link.label));
  if (!dateLink) unavailable("no Canada session directory");
  const date = await navigate(montreal, dateLink.tag, /^C[\dA-F]+_lienArboRep\d+$/i, "session directory");
  const categoryLink = uniqueControl(date, "a", CANADA);
  const category = await navigate(date, categoryLink, /^C[\dA-F]+_lnkfil\d+$/i, "Canada directory");
  const { id, refresh } = component(category);
  return request("compo.coba", refresh, "Canada inventory search", navigationForm(category, id + "_txtRecherche", "TCF"));
}
