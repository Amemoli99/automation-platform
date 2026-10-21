/* ---------- jira ---------- */
const NL = String.fromCharCode(10);
const jr = { board: null, useFilter: true, sprint: "", state: null, meta: null, projects: [], selProjects: new Set(), selTypes: new Set(), selStatuses: new Set(), manual: false, jql: "", dashUrl: "", results: { title: "", jql: "", issues: [], nextPage: null }, selKey: null };
const jmsg = (id, kind, text) => { $(id).replaceChildren(...(text ? [callout(kind, text)] : [])); };

// All'apertura: se c'è già una connessione salvata la si VERIFICA (token ancora valido, Jira raggiungibile), non la si dà per buona.
async function loadJira() {
  try { jr.state = await call("/api/jira/state"); } catch (e) { jmsg("jira-conn-msg", "err", e.message); return; }
  jr.verify = null;
  renderJira();
  if (!jr.state.configured) return; // si parte scollegati: la connessione salvata si riattiva con un clic ("Riconnetti")
  await verifyJira();
}
async function verifyJira() {
  $("jira-conn-chip").replaceChildren(chip("", "verifico la connessione…"));
  try { jr.verify = await call("/api/jira/verify"); } catch (e) { jr.verify = { configured: true, ok: false, reason: "network", message: e.message }; }
  const v = jr.verify;
  if (v.ok) { jmsg("jira-conn-msg", "", ""); renderJira(); return; }
  if (v.reason === "network") { renderJira(); jmsg("jira-conn-msg", "warn", v.message + " Le query salvate restano visibili ma non posso aggiornare i ticket finché Jira non risponde."); return; }
  renderJira(true); // credenziali non valide o non decifrabili: si riapre il modulo già compilato con URL ed email
  findWindows(true);
  jmsg("jira-conn-msg", "err", (v.reason === "auth" ? "La connessione salvata non funziona più. " : "") + v.message + " Reinserisci l'API token e salva.");
}
function renderJira(editing) {
  const s = jr.state;
  const on = !!(s && s.configured);
  const saved = s && !s.configured && s.saved ? s.saved : null;
  const sv = $("jira-saved-conn");
  sv.hidden = !saved;
  sv.replaceChildren();
  if (saved) {
    sv.className = "osaved"; sv.style.marginBottom = "14px";
    const head = mk("div", "oh"); head.append(mk("b", "", "Connessione salvata"), mk("small", "", "Non collegata in questa sessione · per un altro account usa il modulo qui sotto"));
    const row = mk("div", "orow");
    const site = saved.baseUrl.replace(/^https?:\/\//, "");
    const tx = mk("div", "otx");
    tx.append(mk("b", "", saved.displayName || saved.email), mk("small", "", (saved.displayName ? saved.email + " · " : "") + site + (saved.source === "windows" ? " · credenziale di Windows" : "")));
    const go = mk("button", "sm primary", "Riconnetti"); go.type = "button"; go.title = "Usa la connessione salvata per questa sessione";
    go.onclick = async () => {
      go.disabled = true; jmsg("jira-conn-msg", "", "");
      try { jr.state = await call("/api/jira/link", {}); jr.verify = null; renderJira(); await verifyJira(); } catch (e) { jmsg("jira-conn-msg", "err", e.message); go.disabled = false; }
    };
    const del = mk("button", "sm oico"); del.type = "button"; del.title = "Dimentica la connessione salvata"; del.setAttribute("aria-label", "Dimentica la connessione Jira salvata");
    del.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a1 1 0 001 1h8a1 1 0 001-1l1-12M9 7V4h6v3"/></svg>';
    del.onclick = () => $("jira-conn-remove").onclick();
    row.append(mk("span", "obadge", "Jira"), tx, go, del);
    sv.append(head, row);
  }
  $("jira-conn-unlink").hidden = !on;
  $("jira-conn-form").hidden = on && !editing;
  $("jira-conn-edit").hidden = !on || !!editing;
  $("jira-conn-remove").hidden = !on;
  $("jc-cancel").hidden = !editing;
  const v = jr.verify;
  const chipEl = !on ? chip("warn", saved ? "non collegato" : "non configurato")
    : !v ? chip("", "salvato · da verificare")
    : v.ok ? chip("ok", "connesso come " + (v.displayName || s.displayName || s.email) + (s.source === "windows" ? " · credenziale di Windows" : ""))
    : v.reason === "network" ? chip("warn", "Jira non raggiungibile")
    : v.reason === "missing" ? chip("fail", "credenziale di Windows non trovata")
    : chip("fail", "credenziali non valide");
  $("jira-conn-chip").replaceChildren(chipEl);
  if (on && editing) { $("jc-url").value = s.baseUrl; $("jc-email").value = s.email; $("jc-token").placeholder = "lascia vuoto per mantenere il token salvato"; }
  else if (!on) $("jc-token").placeholder = "";
  $("jira-builder").hidden = !on || !!(v && !v.ok && v.reason !== "network");
  $("jira-saved").hidden = !on || !s.queries.length;
  if (on) { renderSaved(); renderProjects(); renderTypes(); }
}

$("jc-save").onclick = async () => {
  const b = $("jc-save"); b.disabled = true; b.textContent = "Verifico…";
  jmsg("jira-conn-msg", "", "");
  try {
    jr.state = await call("/api/jira/config", { baseUrl: $("jc-url").value, email: $("jc-email").value, token: $("jc-token").value });
    jr.verify = { configured: true, ok: true, displayName: jr.state.displayName };
    $("jc-token").value = "";
    toast("Connesso a Jira come " + (jr.state.displayName || jr.state.email));
    renderJira();
  } catch (e) { jmsg("jira-conn-msg", "err", e.message); }
  b.disabled = false; b.textContent = "Salva e verifica";
};
$("jira-conn-edit").onclick = () => renderJira(true);
$("jira-conn-unlink").onclick = async () => {
  try { jr.state = await call("/api/jira/unlink", {}); jr.verify = null; jmsg("jira-conn-msg", "", ""); renderJira(); toast("Jira scollegato: la connessione resta salvata"); } catch (e) { jmsg("jira-conn-msg", "err", e.message); }
};
$("jc-cancel").onclick = () => { jmsg("jira-conn-msg", "", ""); renderJira(); };
$("jira-conn-remove").onclick = async () => {
  if (!(await askConfirm("Rimuovere le credenziali Jira da questo computer?" + NL + NL + "Le query salvate restano. Potrai reinserire email e token quando vuoi.", { title: "Credenziali Jira", ok: "Rimuovi", danger: true }))) return;
  try { jr.state = await call("/api/jira/config/remove", {}); jr.verify = null; renderJira(); toast("Credenziali Jira rimosse"); } catch (e) { jmsg("jira-conn-msg", "err", e.message); }
};

/* --- credenziali già presenti in Gestione credenziali di Windows --- */
async function findWindows(quiet) {
  const b = $("jc-find"); b.disabled = true;
  try {
    const r = await call("/api/jira/discover");
    renderWindowsCandidates(r.candidates);
    if (!r.candidates.length && !quiet) jmsg("jira-conn-msg", "", "Nessuna credenziale che riguardi Atlassian o Jira trovata in Gestione credenziali di Windows. Inserisci email e API token qui sotto.");
  } catch (e) { if (!quiet) jmsg("jira-conn-msg", "err", e.message); }
  b.disabled = false;
}
$("jc-find").onclick = () => findWindows(false);
function renderWindowsCandidates(cands) {
  const box = $("jira-wcm");
  if (!cands.length) { box.hidden = true; box.replaceChildren(); return; }
  box.hidden = false;
  const list = mk("div", "list");
  for (const c of cands) {
    const it = mk("div", "item");
    const main = mk("div", "main");
    main.append(mk("b", "", c.target), mk("small", "", (c.user || "(senza utente)") + (c.baseUrl ? " · " + c.baseUrl : "")));
    let urlIn = null, mailIn = null;
    if (!c.baseUrl) { urlIn = mk("input"); urlIn.placeholder = "https://nome.atlassian.net"; urlIn.style.marginTop = "6px"; main.append(urlIn); }
    if (!c.emailLike) { mailIn = mk("input"); mailIn.placeholder = "Email Atlassian"; mailIn.type = "email"; mailIn.style.marginTop = "6px"; main.append(mailIn); }
    const use = mk("button", "sm primary", "Usa questa"); use.type = "button"; use.style.flex = "none";
    use.onclick = async () => {
      use.disabled = true; jmsg("jira-conn-msg", "", "");
      try {
        jr.state = await call("/api/jira/use-windows", { target: c.target, baseUrl: urlIn ? urlIn.value : undefined, email: mailIn ? mailIn.value : undefined });
        jr.verify = { configured: true, ok: true, displayName: jr.state.displayName };
        box.hidden = true; box.replaceChildren();
        renderJira(); toast("Jira connesso con la credenziale di Windows");
      } catch (e) { jmsg("jira-conn-msg", "err", e.message); }
      use.disabled = false;
    };
    it.append(main, use);
    list.append(it);
  }
  box.replaceChildren(callout("", mk("b", "", "Credenziali trovate in Gestione credenziali di Windows. "), "Scegli quella che ti serve: viene usata direttamente da Windows, senza copiarla."), list);
}

/* --- selezione progetti, tipi, stati --- */
function checkGroup(box, items, selected, onChange) {
  if (!items.length) { box.replaceChildren(mk("span", "empty-note", "—")); return; }
  box.replaceChildren(...items.map((it) => {
    const lab = mk("label"); const cb = mk("input"); cb.type = "checkbox"; cb.checked = selected.has(it.value);
    lab.classList.toggle("on", cb.checked);
    cb.onchange = () => { if (cb.checked) selected.add(it.value); else selected.delete(it.value); lab.classList.toggle("on", cb.checked); onChange(); };
    lab.append(cb, it.label);
    return lab;
  }));
}
function renderProjects() {
  if (!jr.projects.length) { $("jd-projects").replaceChildren(mk("span", "empty-note", "Nessun progetto: leggi una dashboard oppure aggiungi la chiave a mano.")); return; }
  checkGroup($("jd-projects"), jr.projects.map((p) => ({ value: p.key, label: p.key + (p.name ? " · " + p.name : "") })), jr.selProjects, () => { jr.meta = null; renderTypes(); rebuildJql(); });
}
function renderTypes() {
  const m = jr.meta;
  if (!m) { $("jd-types").replaceChildren(mk("span", "empty-note", "Premi \"Carica tipi e stati\" dopo aver scelto i progetti.")); $("jd-statuses").replaceChildren(mk("span", "empty-note", "—")); return; }
  checkGroup($("jd-types"), m.types.map((t) => ({ value: t.name, label: t.name })), jr.selTypes, () => { renderStatuses(); rebuildJql(); });
  renderStatuses();
}
// Gli stati proposti sono quelli dei tipi scelti (tutti, se non è stato scelto nessun tipo); le scelte non più valide si tolgono.
function renderStatuses() {
  const m = jr.meta; if (!m) return;
  const types = jr.selTypes.size ? m.types.filter((t) => jr.selTypes.has(t.name)) : m.types;
  const names = [...new Set(types.flatMap((t) => t.statuses))];
  for (const s of [...jr.selStatuses]) if (!names.includes(s)) jr.selStatuses.delete(s);
  checkGroup($("jd-statuses"), names.map((n) => ({ value: n, label: n })), jr.selStatuses, rebuildJql);
}
function toggleAll(sel, items, on, after) { sel.clear(); if (on) items.forEach((i) => sel.add(i)); after(); }
$("jt-all").onclick = () => jr.meta && toggleAll(jr.selTypes, jr.meta.types.map((t) => t.name), true, () => { renderTypes(); rebuildJql(); });
$("jt-none").onclick = () => jr.meta && toggleAll(jr.selTypes, [], false, () => { renderTypes(); rebuildJql(); });
$("js-all").onclick = () => { if (!jr.meta) return; const box = [...document.querySelectorAll("#jd-statuses input")]; box.forEach((c) => { c.checked = true; }); box.forEach((c) => c.dispatchEvent(new Event("change"))); };
$("js-none").onclick = () => { const box = [...document.querySelectorAll("#jd-statuses input")]; box.forEach((c) => { c.checked = false; }); box.forEach((c) => c.dispatchEvent(new Event("change"))); };

// Se è stata letta una board, i suoi ticket sono quelli del filtro della board (JQL: filter = ID); per le board Scrum si può limitare allo sprint.
function renderScope() {
  const b = jr.board, box = $("jd-scope");
  box.hidden = !b;
  if (!b) return;
  $("jd-usefilter").checked = !!b.filterId && jr.useFilter;
  $("jd-usefilter").disabled = !b.filterId;
  $("jd-usefilter-label").textContent = b.filterId
    ? "Solo i ticket della board «" + b.name + "» (usa il filtro della board)"
    : "La board «" + b.name + "» non ha un filtro leggibile: uso i progetti scelti";
  $("jd-sprintrow").hidden = !b.scrum;
  $("jd-sprint").value = jr.sprint || "";
}
const scopeFilter = () => (jr.board && jr.board.filterId && jr.useFilter ? jr.board.filterId : "");
const scopeSprint = () => (jr.board && jr.board.scrum ? jr.sprint : "");
$("jd-usefilter").onchange = () => { jr.useFilter = $("jd-usefilter").checked; rebuildJql(); };
$("jd-sprint").onchange = () => { jr.sprint = $("jd-sprint").value; rebuildJql(); };
async function rebuildJql() {
  if (jr.manual) return;
  const body = { projects: [...jr.selProjects], types: [...jr.selTypes], statuses: [...jr.selStatuses], filterId: scopeFilter(), sprint: scopeSprint() };
  if (!body.projects.length && !body.types.length && !body.statuses.length && !body.filterId && !body.sprint) { $("jd-jql").value = ""; return; }
  try { const r = await call("/api/jira/jql", body); if (!jr.manual) $("jd-jql").value = r.jql; } catch (e) { jmsg("jd-msg", "err", e.message); }
}
$("jd-jql").addEventListener("input", () => {
  jr.manual = true;
  $("jd-manual").replaceChildren(mk("span", "", "(modificata a mano) "), (() => { const a = mk("a", "tl", "ricostruisci dalle scelte"); a.onclick = () => { jr.manual = false; $("jd-manual").replaceChildren(); rebuildJql(); }; return a; })());
});

$("jd-read").onclick = async () => {
  const url = $("jd-url").value.trim();
  if (!url) { jmsg("jd-info", "err", "Incolla l'indirizzo della board (o della dashboard) del progetto."); return; }
  const b = $("jd-read"); b.disabled = true; b.textContent = "Leggo…";
  jmsg("jd-info", "", "");
  try {
    const d = await call("/api/jira/source", { url });
    jr.dashUrl = url;
    const have = new Set(jr.projects.map((p) => p.key));
    for (const p of d.projects) { if (!have.has(p.key)) jr.projects.push(p); jr.selProjects.add(p.key); }
    jr.meta = null;
    const info = mk("div", "callout ok");
    if (d.kind === "board") {
      jr.board = { id: d.board.id, name: d.board.name, type: d.board.type, scrum: !!d.scrum, filterId: d.filter ? d.filter.id : "" };
      jr.useFilter = !!jr.board.filterId; jr.sprint = "";
      info.append(mk("b", "", d.board.name), " · board " + (d.board.type || "") + (d.board.projectKey ? " del progetto " + d.board.projectKey : ""));
      if (d.filter) { const f = mk("div", "", "Filtro della board: " + d.filter.name + " — "); const c = mk("code", "", d.filter.jql); f.append(c); info.append(f); }
      if (d.columns.length) info.append(mk("div", "", "Colonne: " + d.columns.map((c) => c.name + (c.statuses.length ? " (" + c.statuses.join(", ") + ")" : "")).join(" · ")));
    } else {
      jr.board = null; jr.useFilter = true; jr.sprint = "";
      info.append(mk("b", "", d.dashboard.name), d.dashboard.description ? " · " + d.dashboard.description : "");
      if (d.filters.length) info.append(mk("div", "", "Filtri della dashboard: " + d.filters.map((f) => f.name).join(", ")));
    }
    $("jd-info").replaceChildren(info, ...d.notes.map((n) => callout("warn", n)));
    renderScope(); renderProjects(); renderTypes(); rebuildJql();
    if (d.projects.length) loadMeta();
  } catch (e) { jmsg("jd-info", "err", e.message); }
  b.disabled = false; b.textContent = "Leggi board";
};
$("jd-padd").onclick = () => {
  const k = $("jd-pkey").value.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{1,19}$/.test(k)) { jmsg("jd-msg", "err", "Chiave di progetto non valida: lettere maiuscole, numeri e _ (es. ABC)."); return; }
  jmsg("jd-msg", "", "");
  if (!jr.projects.some((p) => p.key === k)) jr.projects.push({ key: k, name: "" });
  jr.selProjects.add(k); $("jd-pkey").value = ""; jr.meta = null;
  renderProjects(); renderTypes(); rebuildJql();
};
$("jd-pkey").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("jd-padd").click(); } });
async function loadMeta() {
  const keys = [...jr.selProjects];
  if (!keys.length) { jmsg("jd-msg", "err", "Scegli almeno un progetto."); return; }
  const b = $("jd-meta"); b.disabled = true; b.textContent = "Carico…";
  jmsg("jd-msg", "", "");
  try {
    jr.meta = await call("/api/jira/meta", { projects: keys });
    for (const t of [...jr.selTypes]) if (!jr.meta.types.some((x) => x.name === t)) jr.selTypes.delete(t);
    renderTypes(); rebuildJql();
  } catch (e) { jmsg("jd-msg", "err", e.message); }
  b.disabled = false; b.textContent = "Carica tipi e stati";
};
$("jd-meta").onclick = loadMeta;

/* --- Dashboard Test: i test ricavati dalla JQL, con il pulsante Automatizza --- */
const STATUS_KIND = { new: "", indeterminate: "warn", done: "ok" };
const DT_PAGE = 20, DT_BLOCK = 100, DT_MAX = 1000; // righe per pagina, ticket per richiesta, tetto di ticket caricati
const dt = { items: [], nextPage: null, page: 1, run: 0, loading: false, existing: {}, source: null, selKey: null, adhoc: null, pick: null, ready: false, busy: false };

// La Dashboard Test parte dalle query salvate. Se Jira non è collegato lo si prova a collegare da solo (credenziali di Windows) e si verifica.
async function loadDash() {
  $("dt-msg").replaceChildren();
  let st;
  try { st = await call("/api/jira/state"); } catch (e) { jmsg("dt-msg", "err", e.message); return; }
  if (!st.configured) {
    try { const r = await call("/api/jira/auto", {}); if (r.used) { st = r.state; toast("Jira connesso con la credenziale di Windows"); } } catch { /* resta non configurato */ }
  }
  jr.state = st;
  if (!st.configured) { dashEmpty("Jira non è ancora collegato.", "Collega Jira", "jira"); return; }
  $("dt-chip").replaceChildren(chip("", "verifico Jira…"));
  let v;
  try { v = await call("/api/jira/verify"); } catch (e) { v = { ok: false, reason: "network", message: e.message }; }
  jr.verify = v;
  if (!v.ok) {
    $("dt-chip").replaceChildren(chip(v.reason === "network" ? "warn" : "fail", v.reason === "network" ? "Jira non raggiungibile" : "connessione non valida"));
    if (v.reason !== "network") { dashEmpty(v.message, "Sistema la connessione", "jira"); return; }
    jmsg("dt-msg", "warn", v.message);
  } else $("dt-chip").replaceChildren(chip("ok", "Jira: " + (v.displayName || st.email)));
  const sel = $("dt-query");
  const opts = [];
  if (dt.adhoc) opts.push({ value: "adhoc", label: dt.adhoc.title + " (non salvata)" });
  for (const q2 of st.queries) opts.push({ value: q2.id, label: q2.name });
  if (!opts.length) { dashEmpty("Non ci sono ancora query salvate: creane una dalla scheda Jira (dashboard del progetto, tipi di ticket e stati).", "Crea una query", "jira"); return; }
  sel.replaceChildren(...opts.map((o) => { const op = mk("option", "", o.label); op.value = o.value; return op; }));
  let want = dt.pick || (dt.adhoc ? "adhoc" : null);
  if (!want) { try { want = localStorage.getItem("dtQuery"); } catch { /* storage non disponibile */ } }
  sel.value = opts.some((o) => o.value === want) ? want : opts[0].value;
  dt.pick = null;
  await dashRun(false);
}
function dashEmpty(text, btnLabel, tab) {
  $("dt-wrap").hidden = true; $("dt-pager").hidden = true; dt.run++; $("dt-detail").hidden = true; $("dt-jql").textContent = "";
  $("dt-query").replaceChildren();
  const b = mk("button", "primary", btnLabel); b.type = "button"; b.style.flex = "none"; b.onclick = () => gotoTab(tab);
  const box = callout("warn", text + " "); box.append(b);
  $("dt-msg").replaceChildren(box);
}
$("dt-query").onchange = () => { try { localStorage.setItem("dtQuery", $("dt-query").value); } catch { /* storage non disponibile */ } dashRun(false); };
$("dt-reload").onclick = () => loadDash();

async function dashRun() {
  const val = $("dt-query").value;
  if (!val) return;
  const saved = jr.state.queries.find((x) => x.id === val);
  const src = val === "adhoc" ? { title: dt.adhoc.title, jql: dt.adhoc.jql } : saved ? { title: saved.name, jql: saved.jql, queryId: saved.id } : null;
  if (!src) return;
  const run = ++dt.run; // una nuova query o un ricarico annulla i caricamenti in corso
  dt.items = []; dt.nextPage = null; dt.page = 1; dt.selKey = null; dt.existing = {}; dt.source = src; dt.loading = true;
  $("dt-detail").hidden = true;
  try {
    for (let first = true; run === dt.run && (first || (dt.nextPage && dt.items.length < DT_MAX)); first = false) {
      const r = await call("/api/jira/search", { ...(src.queryId ? { queryId: src.queryId } : { jql: src.jql }), nextPage: first ? undefined : dt.nextPage, max: DT_BLOCK });
      if (run !== dt.run) return;
      dt.items = dt.items.concat(r.issues);
      dt.nextPage = r.nextPage;
      try { Object.assign(dt.existing, (await call("/api/tests/existing", { keys: r.issues.map((i) => i.key) })).existing || {}); } catch { /* nessun progetto agganciato: nessun confronto */ }
      if (run !== dt.run) return;
      if (first) $("dt-msg").replaceChildren();
      renderDash();
    }
  } catch (e) { if (run === dt.run) jmsg("dt-msg", "err", e.message); }
  if (run === dt.run) { dt.loading = false; renderDash(); }
}

// Numeri di pagina: 1 … 4 5 [6] 7 8 … 40, con precedente/successiva.
function pageList(cur, last) {
  const set = new Set([1, last, cur - 1, cur, cur + 1]);
  if (cur <= 3) { set.add(2); set.add(3); }
  if (cur >= last - 2) { set.add(last - 1); set.add(last - 2); }
  const nums = [...set].filter((n) => n >= 1 && n <= last).sort((a, b) => a - b);
  const out = [];
  nums.forEach((n, i) => { if (i && n - nums[i - 1] > 1) out.push("…"); out.push(n); });
  return out;
}
function renderPager() {
  const box = $("dt-pager");
  const last = Math.max(1, Math.ceil(dt.items.length / DT_PAGE));
  if (dt.items.length <= DT_PAGE && !dt.loading && !dt.nextPage) { box.hidden = true; return; }
  box.hidden = false;
  const go = (n) => { dt.page = Math.min(last, Math.max(1, n)); dt.selKey = null; $("dt-detail").hidden = true; renderDash(); };
  const mkBtn = (label, n, opts = {}) => {
    const b = mk("button", "pg" + (opts.cur ? " cur" : ""), label); b.type = "button"; b.disabled = !!opts.off;
    if (opts.cur) b.setAttribute("aria-current", "page");
    b.onclick = () => go(n); return b;
  };
  const items = [mkBtn("‹", dt.page - 1, { off: dt.page <= 1 })];
  for (const n of pageList(dt.page, last)) items.push(n === "…" ? mk("span", "pg-gap", "…") : mkBtn(String(n), n, { cur: n === dt.page }));
  items.push(mkBtn("›", dt.page + 1, { off: dt.page >= last }));
  const from = dt.items.length ? (dt.page - 1) * DT_PAGE + 1 : 0, to = Math.min(dt.items.length, dt.page * DT_PAGE);
  let info = from + "–" + to + " di " + dt.items.length;
  if (dt.loading) info += " · carico altri…";
  else if (dt.nextPage) info += "+ (mostrati i primi " + DT_MAX + ": restringi la query per vedere gli altri)";
  items.push(mk("span", "pg-info", info));
  box.replaceChildren(...items);
}

// Perché Automatizza non si può usare ora (o stringa vuota se si può).
function automateBlock() {
  if (!can('run')) return 'Il tuo profilo non consente di lanciare la pipeline';
  if (!(proj.info && proj.info.attached)) return "Aggancia un progetto dalla scheda Progetto";
  if (!projOk) return "Il progetto non è pronto: vedi la scheda Progetto";
  if (lastStatus === "running" || lastStatus === "waiting") return "C'è una sessione in corso: concludila o terminala prima";
  return "";
}
function renderDash() {
  $("dt-jql").textContent = dt.source ? dt.source.jql : "";
  $("dt-wrap").hidden = false;
  renderPager();
  const why = automateBlock();
  const proj0 = proj.info && proj.info.attached ? proj.info.name : "";
  if (!proj0) $("dt-msg").replaceChildren(callout("warn", "Nessun progetto agganciato: puoi vedere i test, ma per automatizzarli serve un progetto. "), ...[]);
  const body = $("dt-body");
  if (!dt.items.length) { const tr = mk("tr"); const td = mk("td", "", "Nessun ticket corrisponde alla query."); td.colSpan = 7; td.style.cursor = "default"; tr.append(td); body.replaceChildren(tr); return; }
  body.replaceChildren(...dt.items.slice((dt.page - 1) * DT_PAGE, dt.page * DT_PAGE).map((i) => {
    const tr = mk("tr"); if (i.key === dt.selKey) tr.className = "sel";
    const a = mk("a", "", i.key); a.href = i.url; a.target = "_blank"; a.rel = "noopener"; a.onclick = (e) => e.stopPropagation();
    const tdK = mk("td", "k"); tdK.append(a);
    const tdT = mk("td"); tdT.append(mk("div", "", i.summary), mk("small", "", i.type)); tdT.querySelector("small").style.color = "var(--muted)";
    const tdS = mk("td"); tdS.append(chip(STATUS_KIND[i.statusCategory] || "", i.status));
    const tdA = mk("td"); tdA.style.cssText = "text-align:right;white-space:nowrap";
    const ex = dt.existing[i.key];
    if (ex) { const c = chip("ok", "già nel progetto"); c.title = ex; c.style.marginRight = "8px"; tdA.append(c); }
    const bt = mk("button", "sm primary", "Automatizza"); bt.type = "button"; bt.style.flex = "none";
    bt.disabled = !!why || dt.busy; bt.title = why || "Lancia la pipeline su " + i.key;
    bt.onclick = (e) => { e.stopPropagation(); automate(i.key); };
    tdA.append(bt);
    tr.append(tdK, tdT, tdS, mk("td", "", i.assignee || "—"), mk("td", "", i.priority || "—"), mk("td", "", i.updated ? fmtDate(i.updated) : ""), tdA);
    tr.onclick = () => openIssue(i.key);
    return tr;
  }));
}

async function openIssue(key) {
  dt.selKey = key; renderDash();
  const box = $("dt-detail"); box.hidden = false; box.replaceChildren(nxLoader('Carico ' + key + '…'));
  try {
    const d = await call("/api/jira/issue", { key });
    const meta = mk("div", "meta");
    meta.append(chip(STATUS_KIND[d.statusCategory] || "", d.status), chip("", d.type));
    if (d.priority) meta.append(chip("", "priorità " + d.priority));
    if (d.assignee) meta.append(mk("span", "", "assegnato a " + d.assignee));
    for (const l of d.labels) meta.append(chip("", l));
    for (const c of d.components) meta.append(chip("", c));
    const desc = mk("div", "desc", d.description || "(nessuna descrizione)");
    const acts = mk("div", "acts");
    const go = mk("button", "primary", "Automatizza"); go.type = "button"; go.style.flex = "none";
    const why = automateBlock(); go.disabled = !!why || dt.busy; go.title = why || "Lancia /implementTest su " + d.key;
    go.onclick = () => automate(d.key, d);
    const open = mk("a", "", "Apri in Jira"); open.href = d.url; open.target = "_blank"; open.rel = "noopener";
    acts.append(go, open);
    const att = d.attachments.length ? mk("div", "qjql", "Allegati su Jira: " + d.attachments.map((a) => a.name).join(", ") + " (non vengono scaricati)") : null;
    box.replaceChildren(mk("h4", "", d.key + " — " + d.summary), meta, desc, ...(att ? [att] : []), acts);
    box.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (e) { box.replaceChildren(callout("err", e.message)); }
}

// Il "contratto" per la pipeline: chiave, titolo e descrizione del ticket (gli allegati di Jira non vengono scaricati).
function ticketText(d) {
  const text = d.key + " — " + d.summary + NL + NL + (d.description || "") + (d.attachments.length ? NL + NL + "Allegati su Jira (non scaricati): " + d.attachments.map((a) => a.name).join(", ") : "");
  return text.length > 19000 ? text.slice(0, 19000) + NL + "[descrizione troncata]" : text;
}
// Automatizza = lanciare /implementTest sul ticket. Niente altro: parte la stessa pipeline della scheda Esecuzione.
async function automate(key, detail) {
  const why = automateBlock();
  if (why) { toast(why, true); return; }
  if (dt.busy) return;
  dt.busy = true; renderDash();
  try {
    const d = detail || await call("/api/jira/issue", { key });
    const g = proj.git;
    const text0 = ticketText(d);
    const pv = await call("/api/pipeline/preview", { ticket: text0 });
    const cmd1 = pv.command.split(NL)[0];
    const lines = ["Lanciare " + (cmd1.length > 150 ? cmd1.slice(0, 150) + "…" : cmd1) + (pv.command.includes(NL) ? " …" : "") + " ?", "", "Ticket: " + d.key + " — " + d.summary, "Progetto: " + proj.info.name + (g && g.isRepo && g.branch ? " (branch " + g.branch + ")" : "")];
    if (dt.existing[d.key]) lines.push("", "ATTENZIONE: nel progetto esiste già " + dt.existing[d.key] + ". La pipeline potrebbe riscriverlo o duplicarlo.");
    if (g && g.isRepo && g.branch && (PROTECTED.includes(g.branch) || g.branch === g.baseBranch)) lines.push("", "ATTENZIONE: sei sul branch principale (" + g.branch + "). Meglio creare prima un branch dedicato dalla scheda Git.");
    if (!(await askConfirm(lines.join(NL), { title: "Avvia la pipeline", ok: "Lancia" }))) { dt.busy = false; renderDash(); return; }
    const text = ticketText(d);
    emptyState();
    await call("/api/start", { ticket: text, permissionMode: PERM_MODE, attachments: [] });
    $("ticket").value = text;
    toast("Pipeline avviata su " + d.key + ": " + cmd1.slice(0, 60));
    dt.busy = false;
    gotoTab("run");
    return;
  } catch (e) { toast(e.message.split(NL)[0].slice(0, 200), true); }
  dt.busy = false; renderDash();
}

// Anteprima nella scheda Jira: quanti ticket trova la JQL, senza tenerli lì; i risultati veri stanno nella Dashboard Test.
$("jd-try").onclick = async () => {
  const j = $("jd-jql").value.trim();
  if (!j) { jmsg("jd-msg", "err", "La JQL è vuota: fai almeno una scelta qui sopra."); return; }
  const b = $("jd-try"); b.disabled = true; b.textContent = "Provo…";
  try {
    const r = await call("/api/jira/search", { jql: j, max: 100 });
    const box = callout(r.issues.length ? "ok" : "warn", r.issues.length ? "La query trova " + r.issues.length + (r.nextPage ? "+" : "") + " ticket" + (r.issues[0] ? " (il più recente: " + r.issues[0].key + " — " + r.issues[0].summary + "). " : ". ") : "La query è valida ma non trova nessun ticket. ");
    if (r.issues.length) { const go = mk("button", "sm primary", "Vedili nella Dashboard Test"); go.type = "button"; go.style.flex = "none"; go.onclick = () => { dt.adhoc = { title: "Anteprima della query", jql: j }; dt.pick = "adhoc"; gotoTab("dash"); }; box.append(go); }
    $("jd-msg").replaceChildren(box);
  } catch (e) { jmsg("jd-msg", "err", e.message); }
  b.disabled = false; b.textContent = "Prova la query";
};

/* --- salvataggio e query salvate --- */
$("jd-save").onclick = async () => {
  const jql = $("jd-jql").value.trim(), name = $("jd-name").value.trim();
  if (!jql) { jmsg("jd-msg", "err", "La JQL è vuota."); return; }
  if (!name) { jmsg("jd-msg", "err", "Dai un nome alla query."); $("jd-name").focus(); return; }
  try {
    await call("/api/jira/search", { jql, max: 1 }); // la JQL deve essere valida per Jira prima di salvarla
    await call("/api/jira/queries", { name, jql, projects: [...jr.selProjects], types: [...jr.selTypes], statuses: [...jr.selStatuses], dashboardUrl: jr.dashUrl, filterId: scopeFilter(), sprint: scopeSprint(), boardName: jr.board ? jr.board.name : "" });
    jr.state = await call("/api/jira/state");
    $("jd-name").value = ""; jmsg("jd-msg", "", "");
    renderJira(); toast("Query salvata: " + name);
  } catch (e) { jmsg("jd-msg", "err", e.message); }
};
function renderSaved() {
  const list = $("jira-saved-list");
  list.replaceChildren(...jr.state.queries.map((qy) => {
    const it = mk("div", "qrow");
    const main = mk("div", "main");
    main.append(mk("div", "qname", qy.name), mk("div", "qjql", qy.jql));
    const meta = mk("div", "qmeta");
    if (qy.boardName) meta.append(chip("", "board: " + qy.boardName));
    if (qy.sprint) meta.append(chip("warn", qy.sprint === "active" ? "sprint attivo" : "backlog"));
    for (const p of qy.projects) meta.append(chip("", p));
    for (const x of qy.types) meta.append(chip("ok", x));
    for (const x of qy.statuses) meta.append(chip("warn", x));
    if (meta.childNodes.length) main.append(meta);
    const run = mk("button", "sm primary", "Apri nella Dashboard Test"); run.type = "button"; run.style.flex = "none"; run.onclick = () => { dt.pick = qy.id; gotoTab("dash"); };
    const edit = mk("button", "sm", "Modifica"); edit.type = "button"; edit.onclick = () => loadIntoBuilder(qy);
    const del = mk("button", "sm danger", "Elimina"); del.type = "button";
    del.onclick = async () => {
      if (!(await askConfirm("Eliminare la query \"" + qy.name + "\"?", { title: "Elimina query", ok: "Elimina", danger: true }))) return;
      try { await call("/api/jira/queries/delete", { id: qy.id }); jr.state = await call("/api/jira/state"); renderJira(); } catch (e) { toast(e.message, true); }
    };
    const acts = mk("div"); acts.style.cssText = "display:flex;gap:6px;flex:none"; acts.append(run, edit, del);
    it.append(main, acts);
    return it;
  }));
}
// Riporta una query salvata nel costruttore (con la sua JQL) per ritoccarla e salvarla con un altro nome.
function loadIntoBuilder(qy) {
  jr.selProjects = new Set(qy.projects); jr.selTypes = new Set(qy.types); jr.selStatuses = new Set(qy.statuses);
  for (const k of qy.projects) if (!jr.projects.some((p) => p.key === k)) jr.projects.push({ key: k, name: "" });
  jr.board = qy.filterId ? { id: "", name: qy.boardName || "board", type: "", scrum: !!qy.sprint, filterId: qy.filterId } : null;
  jr.useFilter = !!qy.filterId; jr.sprint = qy.sprint || "";
  jr.meta = null; jr.manual = true; jr.dashUrl = qy.dashboardUrl || ""; $("jd-url").value = jr.dashUrl;
  $("jd-jql").value = qy.jql; $("jd-name").value = qy.name + " (copia)";
  renderScope(); renderProjects(); renderTypes(); jmsg("jd-msg", "", "");
  $("jd-manual").replaceChildren(mk("span", "", "(caricata da una query salvata)"));
  $("jira-builder").scrollIntoView({ behavior: "smooth", block: "start" });
}

const W = {
  new: ['Prerequisiti', 'Dettagli', 'Riepilogo e creazione', 'Verifica e prossimi passi'],
  existing: ['Cartella', 'Anteprima', 'Applica'],
};
const wz = { mode: null, step: 0, token: 0, d: null };
const freshData = () => ({
  name: '', parent: '', envs: [{ name: 'DEV', url: '' }], username: '', password: '',
  ghUser: '', ghToken: '', tokenOk: false, skipToken: false, created: null, existingDir: '', initialCommit: true,
  pipeline: { mode: 'default', name: '' }, frameworkRepo: '',
});
const folderOf = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const joinWin = (a, b) => a.replace(/[\\/]+$/, '') + '\\' + b;
const targetDir = () => (wz.d.parent && folderOf(wz.d.name) ? joinWin(wz.d.parent, folderOf(wz.d.name)) : '');

function wizStart(mode) {
  if (proj.info && proj.info.running) { toast('Termina prima la sessione in corso.', true); return; }
  wz.mode = mode; wz.step = 0; wz.d = freshData();
  if (proj.info) wz.d.parent = proj.info.workspace || '';
  if (proj.info && proj.info.frameworkRepo) wz.d.frameworkRepo = proj.info.frameworkRepo;
  $('proj-home').hidden = true; $('proj-wiz').hidden = false;
  renderWiz();
}
function wizExit() { $('proj-wiz').hidden = true; $('proj-home').hidden = false; loadProject(); }
$('opt-new').onclick = () => wizStart('new');
$('pc-editor').onclick = () => { window.open('/pipelines.html', 'nx-pipelines'); }; // editor in una scheda a parte: il Cockpit resta com'è
$('opt-existing').onclick = () => wizStart('existing');

function fld(label, el, hint) {
  const d = mk('div', 'fld');
  if (label) d.append(mk('label', '', label));
  d.append(el);
  if (hint) d.append(mk('small', 'hint2', hint));
  return d;
}
function inp(value, ph, type, on) {
  const e = mk('input');
  e.value = value || ''; e.placeholder = ph || ''; e.spellcheck = false;
  if (type) { e.type = type; if (type === 'password') e.autocomplete = 'new-password'; }
  e.oninput = () => on(e.value);
  return e;
}
const callout = (kind, ...nodes) => { const c = mk('div', 'callout ' + kind); c.append(...nodes.map((n) => (typeof n === 'string' ? document.createTextNode(n) : n))); return c; };

let nav = {};
function setNav(o) { nav = o; renderNav(); }
function renderNav() {
  const b = $('wiz-back'), n = $('wiz-next');
  b.textContent = wz.step === 0 ? 'Annulla' : 'Indietro';
  b.disabled = !!nav.busy;
  n.hidden = !nav.next;
  if (nav.next) { n.textContent = nav.next.label; n.disabled = !!nav.next.disabled || !!nav.busy; }
}
$('wiz-back').onclick = () => { if (nav.busy) return; if (wz.step === 0) wizExit(); else { wz.step--; renderWiz(); } };
$('wiz-next').onclick = async () => {
  if (!nav.next || nav.busy) return;
  nav.busy = true; renderNav();
  let go;
  try { go = await nav.next.go(); } catch (e) { toast(e.message, true); go = false; }
  nav.busy = false;
  if (go === false) { renderNav(); return; }
  if (nav.next.final) { wizExit(); return; }
  wz.step++; renderWiz();
};

function renderWiz() {
  const names = W[wz.mode];
  $('wiz-title').textContent = wz.mode === 'new' ? 'Nuovo progetto' : 'Configura progetto esistente';
  $('wiz-steps').replaceChildren(...names.map((n, i) => {
    const li = mk('li', i < wz.step ? 'done' : i === wz.step ? 'cur' : '');
    li.append(mk('span', 'n', i < wz.step ? '✓' : String(i + 1)), mk('span', '', n));
    return li;
  }));
  const body = $('wiz-body');
  body.replaceChildren();
  wz.token++;
  nav = {};
  renderNav();
  STEP[wz.mode][wz.step](body, wz.token);
}

