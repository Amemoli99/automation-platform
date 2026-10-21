/* --- licenza e profili --- */
// Il server applica i permessi a ogni richiesta; qui si disattivano i comandi non consentiti per non far sbattere l'utente contro un errore.
let lic = null;
const DEMO_EXTRA = ['view', 'run', 'git.write']; // in Demo (simulazione) si possono provare queste funzioni anche senza licenza
const can = (cap) => !lic || lic.caps.includes(cap) || (demoOn && DEMO_EXTRA.includes(cap)); // finché la licenza non è nota decide il server
const CAP_LABEL = [
  ['view', 'Vedere Dashboard, storico e stato del progetto'], ['run', 'Lanciare la pipeline (Automatizza)'], ['git.write', 'Commit, branch, aggiornamenti e merge'],
  ['git.push', 'Pubblicare le modifiche (push) sui propri branch'], ['git.protected', 'Pubblicare o unire sul branch principale'],
  ['project.select', 'Agganciare e preparare il proprio progetto'], ['project.create', 'Creare nuovi progetti'], ['jira.connect', 'Collegare il proprio Jira e salvare le query'],
  ['config.edit', 'Modificare i permessi della pipeline e il profilo del progetto'], ['ide.open', 'Aprire i file in IntelliJ ("Analizza nel codice")'], ['demo', 'Usare la modalità Demo'],
];
async function loadLicense() {
  try { lic = await call('/api/license'); } catch { return; }
  applyLicense();
}
function licState() { return !lic ? 'ok' : lic.dev ? 'warn' : !lic.licensed ? 'fail' : (lic.daysLeft <= 14 ? 'warn' : 'ok'); }
function applyLicense() {
  if (!lic) return;
  const chipEl = $('role-chip');
  chipEl.hidden = false; chipEl.className = 'pill projchip ' + licState();
  chipEl.textContent = lic.dev ? 'Sviluppo · nessun limite' : !lic.licensed ? 'Nessuna licenza' : lic.roleLabel + (lic.daysLeft <= 30 ? ' · ' + lic.daysLeft + ' gg' : '');
  chipEl.title = lic.dev ? lic.message : !lic.licensed ? lic.message : lic.roleLabel + ' · ' + lic.org + ' · scade il ' + new Date(lic.expires).toLocaleDateString('it-IT');
  chipEl.onclick = () => gotoTab('license');
  const bar = $('lic-bar');
  const soon = lic.licensed && lic.daysLeft <= 14;
  bar.hidden = !((lic.configured && !lic.licensed) || soon);
  bar.className = soon && lic.licensed ? 'warn' : '';
  $('lic-bar-text').textContent = !lic.licensed ? (lic.message || 'Nessuna licenza valida.') : 'La licenza scade tra ' + lic.daysLeft + (lic.daysLeft === 1 ? ' giorno' : ' giorni') + ': richiedi il rinnovo.';
  $('lic-bar-btn').onclick = () => gotoTab('license');
  const d = $('demo-btn'); d.disabled = !can('demo') && !demoOn; d.title = d.disabled ? 'Il tuo profilo non consente la modalità Demo' : 'Simula il funzionamento senza toccare ticket, file o repository reali';
  const ro = !can('config.edit');
  for (const id of ['sec-perm', 'sec-run', 'sec-prof']) { const s = $(id); if (s) s.classList.toggle('ro', ro); }
  $('cfg-ro-note').hidden = !ro;
  const nw = $('opt-new'); if (nw) { nw.disabled = !can('project.create'); nw.title = nw.disabled ? 'Il tuo profilo non consente di creare nuovi progetti' : ''; }
  setUi(lastStatus);
  if (!$('view-dash').hidden && dt.items.length) renderDash();
  if (!$('view-git').hidden) renderGit();
  if (!$('view-license').hidden) renderLicenseView();
}
function renderLicenseView() {
  if (!lic) return;
  $('lic-chip').replaceChildren(chip(licState(), lic.dev ? 'sviluppo' : !lic.licensed ? 'non valida' : lic.daysLeft <= 14 ? 'in scadenza' : 'valida'));
  $('lic-sub').textContent = lic.licensed ? lic.roleLabel + ' · ' + lic.org : lic.dev ? 'Licenze non ancora attivate su questa installazione.' : 'Senza licenza è disponibile solo la modalità Demo.';
  $('lic-msg').replaceChildren(...(lic.licensed ? [] : [callout(lic.dev ? 'warn' : 'err', lic.message || 'Nessuna licenza valida.')]));
  const rows = [['Profilo', lic.roleLabel]];
  if (lic.licensed) rows.push(['Organizzazione', lic.org], ['Utente', lic.user], ['Email', lic.email], ['Emessa il', new Date(lic.issued).toLocaleDateString('it-IT')], ['Scade il', new Date(lic.expires).toLocaleDateString('it-IT') + ' (' + lic.daysLeft + (lic.daysLeft === 1 ? ' giorno' : ' giorni') + ')']);
  $('lic-grid').replaceChildren(...rows.flatMap(([k, v]) => [mk('dt', '', k), mk('dd', '', v)]));
  $('lic-caps').replaceChildren(...CAP_LABEL.map(([cap, label]) => {
    const yes = lic.caps.includes(cap);
    const r = mk('div', 'cap-row' + (yes ? '' : ' no')); r.append(mk('span', 'cm', yes ? '✓' : '–'), mk('span', '', label));
    return r;
  }));
  $('lic-code').value = lic.machineCode || '';
}
$('lic-copy').onclick = async () => { try { await navigator.clipboard.writeText($('lic-code').value); toast('Codice copiato'); } catch { $('lic-code').select(); toast('Seleziona e copia il codice (Ctrl+C)'); } };
$('lic-pick').onclick = () => $('lic-file').click();
$('lic-file').onchange = async () => {
  const f = $('lic-file').files[0]; $('lic-file').value = '';
  if (!f) return;
  if (f.size > 20000) { jmsg('lic-import-msg', 'err', 'Il file è troppo grande per essere una licenza.'); return; }
  try {
    lic = await call('/api/license/import', { text: await f.text() });
    jmsg('lic-import-msg', 'ok', 'Licenza importata: ' + lic.roleLabel + ' · ' + lic.org + '.');
    applyLicense();
  } catch (e) { jmsg('lic-import-msg', 'err', e.message); }
};

/* --- modalità Demo --- */
let demoOn = false;
async function setDemo(on) {
  try {
    await call('/api/demo', { on });
    try { sessionStorage.setItem('goDash', on ? '1' : ''); } catch { /* storage non disponibile */ }
    location.reload();
  } catch (e) { toast(e.message, true); }
}
$('demo-btn').onclick = () => setDemo(!demoOn);
$('demo-exit').onclick = () => setDemo(false);

// --- skill del progetto ---
const exampleTicket = "NX-2 — Titolo di esempio";
function argsPreview(tpl, ticket) {
  const first = ticket.split(/\r?\n/)[0].trim();
  const m = first.match(/^([A-Z][A-Z0-9_]*-\d+)\s*(?:[—–-]\s*(.*))?$/);
  const key = m ? m[1] : first, summary = m && m[2] ? m[2].trim() : first;
  return tpl.replace(/\{(key|summary|text)\}/g, (_, k) => (k === "key" ? key : k === "summary" ? summary : ticket));
}
const pcArgs = () => ($("pc-argsel").value === "custom" ? $("pc-args").value.trim() : $("pc-argsel").value);
function pcRenderPreview() {
  const cmd = "/" + $("pc-skill").value + " " + argsPreview(pcArgs() || "{key}", exampleTicket);
  const box = $("pc-preview"); box.replaceChildren("Esempio del comando che verrà lanciato: ", el("code", "", cmd));
  box.firstChild.parentNode.querySelector("code").style.cssText = "font:12.5px var(--mono);background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:1px 7px";
}
function renderPipeCard() {
  const s = proj.insp, card = $("pipe-card");
  const p = s && s.pipeline;
  card.hidden = !(proj.info && proj.info.attached && p && p.skills.length);
  if (card.hidden) return;
  loadJdks();
  const sel = $("pc-skill");
  sel.replaceChildren(...p.skills.map((k) => { const o = mk("option", "", k.name + (k.kind === "command" ? "  (comando)" : "")); o.value = k.name; return o; }));
  if (!p.chosen) { const o = mk("option", "", "— scegli una skill —"); o.value = ""; o.disabled = true; sel.prepend(o); sel.value = ""; } else sel.value = p.chosen;
  const std = ["{key}", "{key} — {summary}", "{text}"];
  $("pc-argsel").value = std.includes(p.args) ? p.args : "custom";
  $("pc-args").hidden = $("pc-argsel").value !== "custom"; if (!$("pc-args").hidden) $("pc-args").value = p.args;
  const cur = p.skills.find((k) => k.name === sel.value);
  $("pc-desc").textContent = cur && cur.description ? cur.description : (p.chosen ? "" : "Nessuna scelta automatica possibile: seleziona la skill da lanciare.");
  $("pc-hint").textContent = cur && cur.argHint ? "La skill indica gli argomenti: " + cur.argHint : "";
  $("pc-addkit").hidden = !!p.chosen || !p.skills.length;
  if (p.chosen) pcRenderPreview(); else $("pc-preview").replaceChildren("Scegli una skill per vedere il comando.");
}
// JDK del progetto: si sceglie tra quelli trovati sul computer o si indica una cartella; vale dalla prossima esecuzione.
async function loadJdks() {
  const sel = $("pc-jdk");
  try {
    const j = await call("/api/jdks");
    const list = [{ v: "", t: "Come il computer" + (j.system ? " — " + j.system.label : " (JAVA_HOME non impostato)") }, ...j.jdks.map((d) => ({ v: d.home, t: d.label }))];
    if (j.selected && !j.jdks.some((d) => d.home.toLowerCase() === j.selected.toLowerCase())) list.push({ v: j.selected, t: j.selected + (j.selectedValid ? "" : " (non più valido)") });
    list.push({ v: "__custom", t: "Altro percorso…" });
    sel.replaceChildren(...list.map((x) => { const o = mk("option", "", x.t); o.value = x.v; return o; }));
    sel.value = j.selected || "";
    $("pc-jdk-custom").hidden = true;
    $("pc-jdk-hint").textContent = j.selected && !j.selectedValid ? "Il JDK scelto non esiste più: si usa quello del computer." : (j.jdks.length ? "Vale dalla prossima esecuzione. Il progetto compila per Java 11 (pom.xml): un JDK più recente funziona comunque." : "Nessun JDK trovato nelle cartelle abituali: indica il percorso con “Altro percorso…”.");
  } catch (e) { $("pc-jdk-hint").textContent = "Impossibile leggere i JDK: " + e.message; }
}
async function saveJdk(home) {
  try { await call("/api/project/jdk", { home }); toast(home ? "JDK salvato: vale dalla prossima esecuzione." : "Si usa il JDK del computer."); await loadJdks(); loadProject(); } catch (e) { toast(e.message, true); await loadJdks(); }
}
$("pc-jdk").onchange = () => { const v = $("pc-jdk").value; if (v === "__custom") { $("pc-jdk-custom").hidden = false; $("pc-jdk-path").focus(); } else { $("pc-jdk-custom").hidden = true; saveJdk(v); } };
$("pc-jdk-use").onclick = () => { const v = $("pc-jdk-path").value.trim(); if (!v) { toast("Indica la cartella del JDK.", true); return; } saveJdk(v); };
$("pc-skill").onchange = () => {
  const p = proj.insp.pipeline, k = p.skills.find((x) => x.name === $("pc-skill").value);
  $("pc-desc").textContent = k && k.description ? k.description : ""; $("pc-hint").textContent = k && k.argHint ? "La skill indica gli argomenti: " + k.argHint : "";
  pcRenderPreview();
};
$("pc-argsel").onchange = () => { $("pc-args").hidden = $("pc-argsel").value !== "custom"; if (!$("pc-args").hidden) { $("pc-args").focus(); } pcRenderPreview(); };
$("pc-args").addEventListener("input", pcRenderPreview);
$("pc-save").onclick = async () => {
  const skill = $("pc-skill").value;
  if (!skill) { toast("Scegli una skill.", true); return; }
  if (!pcArgs()) { toast("Indica cosa passare alla skill.", true); return; }
  try { await call("/api/project/pipeline", { skill, args: pcArgs() }); toast("Salvato: si lancerà /" + skill); await loadProject(); } catch (e) { toast(e.message, true); }
};
$("pc-addkit").onclick = async () => {
  if (!(await askConfirm("Aggiungere al progetto la pipeline di Aletheia (skill implementTest, agent e profilo)?\n\nI file già presenti non vengono toccati.", { title: "Pipeline di Aletheia", ok: "Aggiungi" }))) return;
  try { const r = await call("/api/project/prepare", { addKit: true }); toast(r.created.length + " file aggiunti dal kit."); await loadProject(); } catch (e) { toast(e.message, true); }
};
// Anteprima del comando reale sotto il ticket (stessa logica del server)
let cmdTimer;
function updateCmdPreview() {
  clearTimeout(cmdTimer);
  cmdTimer = setTimeout(async () => {
    const box = $("cmd-preview");
    if (!(proj.info && proj.info.attached && projOk)) { box.hidden = true; return; }
    try { const r = await call("/api/pipeline/preview", { ticket: $("ticket").value.trim() }); const first = r.command.split(NL)[0]; box.replaceChildren("Verrà lanciato: ", el("code", "", first.length > 140 ? first.slice(0, 140) + "…" : first), r.command.includes(NL) ? " …" : ""); box.hidden = false; } catch { box.hidden = true; }
  }, 350);
}
$("ticket").addEventListener("input", updateCmdPreview);

$('insp-recheck').onclick = () => loadProject();
$('insp-prepare').onclick = async () => {
  const b = $('insp-prepare'); b.disabled = true;
  try {
    const r = await call('/api/project/prepare', {});
    toast(r.created.length + ' file aggiunti dal kit, ' + r.skipped.length + ' già presenti (non toccati).');
    await loadProject();
  } catch (e) { toast(e.message, true); }
  b.disabled = false;
};

// Aggancio: il percorso si scrive/incolla (sempre disponibile) oppure si sceglie con "Sfoglia…" (finestra di Windows).
function attachMsg(kind, text) {
  $('attach-msg').replaceChildren(...(text ? [callout(kind, text)] : []));
}
async function attachProject(dir) {
  const d = String(dir || '').trim();
  if (!d) { attachMsg('err', 'Indica la cartella del progetto: incolla il percorso oppure usa "Sfoglia…".'); $('attach-path').focus(); return; }
  if (proj.info && proj.info.running) { attachMsg('err', 'Termina prima la sessione in corso: non si può cambiare progetto mentre la pipeline lavora.'); return; }
  const go = $('attach-go'); go.disabled = true; go.textContent = 'Aggancio…';
  attachMsg('', 'Verifico la cartella…');
  try {
    proj.info = await call('/api/project/activate', { dir: d });
    attachMsg('', '');
    $('attach-path').value = '';
    cfgLoaded = false;
    await loadProject();
    toast('Progetto agganciato: ' + (proj.info.name || ''));
  } catch (e) { attachMsg('err', e.message); }
  go.disabled = false; go.textContent = 'Aggancia';
}
$('attach-go').onclick = () => attachProject($('attach-path').value);
// "Sfoglia…" della Cartella locale: apre la finestra di Windows (la stessa del wizard), compila il percorso e porta il focus su Aggancia.
$('proj-switch').onclick = async () => {
  const b = $('proj-switch'); const old = b.textContent;
  b.disabled = true; b.textContent = 'Scegli la cartella…';
  toast('Scegli la cartella nella finestra di Windows (può essere dietro al browser).');
  try {
    const { dir } = await call('/api/project/pick-folder', {});
    if (dir) { $('attach-path').value = dir; attachMsg('', ''); $('attach-go').focus(); }
  } catch (e) { toast(e.message, true); }
  finally { b.disabled = false; b.textContent = old; }
};

// Origine Git: GitHub (organizzazione o utente) oppure GitLab (server + gruppo). Elenco e clone, oppure cartella locale.
const rp = { source: null, sources: [], saved: [], repos: [], loaded: '', busy: false };
const plainSource = (s) => ({ provider: s.provider, host: s.host, owner: s.owner });
function setAttachMode(mode) {
  document.querySelectorAll('#attach-seg button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  $('attach-repo').hidden = mode !== 'repo';
  $('attach-local').hidden = mode !== 'local';
  attachMsg('', '');
  if (mode === 'repo') loadOwners();
}
document.querySelectorAll('#attach-seg button').forEach((b) => { b.onclick = () => setAttachMode(b.dataset.mode); });

async function loadOwners(keep) {
  try {
    const r = await call('/api/repos/sources');
    rp.sources = r.sources; rp.saved = r.savedList || [];
    const sel = $('repo-owner');
    sel.replaceChildren(...r.sources.map((s) => { const o = mk('option', '', s.label); o.value = s.key; return o; }));
    renderSavedOrigins();
    $('repo-owner-unlink').disabled = !r.sources.length; $('repo-owner-del').disabled = !r.sources.length; $('repo-reload').disabled = !r.sources.length;
    if (!r.sources.length) {
      rp.source = null; rp.repos = []; rp.loaded = '';
      $('repo-list').replaceChildren(mk('div', 'item', rp.saved.length ? 'Nessuna origine collegata.' : 'Nessuna origine configurata. Premi "Aggiungi…" e scegli GitHub o GitLab.'));
      return;
    }
    const k = keep && r.sources.some((s) => s.key === keep) ? keep : r.sources[0].key;
    sel.value = k;
    rp.source = r.sources.find((s) => s.key === k);
    if (rp.loaded !== k) loadRepos(false);
  } catch (e) { attachMsg('err', e.message); }
}
// Origini salvate ma non collegate in questa sessione: si ricollegano con un clic (o si eliminano con la X).
function renderSavedOrigins() {
  const box = $('repo-saved');
  const active = new Set(rp.sources.map((s) => s.key));
  const off = rp.saved.filter((s) => !active.has(s.key));
  box.hidden = !off.length;
  box.replaceChildren();
  if (!off.length) return;
  const head = mk('div', 'oh');
  head.append(mk('b', '', 'Origini salvate'), mk('small', '', rp.sources.length ? 'Non collegate in questa sessione' : 'Collegane una per vedere i suoi repository'));
  box.append(head);
  for (const s of off) {
    const row = mk('div', 'orow');
    const gh = s.provider === 'github';
    const tx = mk('div', 'otx'); tx.append(mk('b', '', s.owner), mk('small', '', gh ? 'github.com' : s.host));
    const go = mk('button', 'sm primary', 'Collega'); go.type = 'button'; go.title = 'Collega ' + s.label + ' per questa sessione'; go.onclick = () => linkOrigin(s);
    const del = mk('button', 'sm oico'); del.type = 'button'; del.title = 'Elimina dalle origini salvate'; del.setAttribute('aria-label', 'Elimina ' + s.label + ' dalle origini salvate');
    del.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a1 1 0 001 1h8a1 1 0 001-1l1-12M9 7V4h6v3"/></svg>';
    del.onclick = () => forgetOrigin(s);
    row.append(mk('span', 'obadge', gh ? 'GitHub' : 'GitLab'), tx, go, del);
    box.append(row);
  }
}
async function linkOrigin(s) {
  try { await call('/api/repos/sources', { sources: rp.saved.map(plainSource), link: [s.key] }); rp.loaded = ''; attachMsg('', ''); await loadOwners(s.key); } catch (e) { attachMsg('err', e.message); }
}
async function forgetOrigin(s) {
  if (!(await askConfirm('Eliminare "' + s.label + '" dalle origini salvate?\n\nNon cancella nulla sul server né sul tuo computer.', { title: 'Elimina origine', ok: 'Elimina', danger: true }))) return;
  try { await call('/api/repos/sources', { sources: rp.saved.filter((x) => x.key !== s.key).map(plainSource) }); await loadOwners(rp.source && rp.source.key); } catch (e) { attachMsg('err', e.message); }
}
async function loadRepos(refresh) {
  if (!rp.source) return;
  const src = rp.source;
  $('repo-list').replaceChildren(nxLoader('Carico i repository di ' + src.label + '…', "Dipende dal server: può volerci un po'"));
  attachMsg('', '');
  try {
    const r = await call('/api/repos/list', { source: plainSource(src), parent: $('repo-parent').value.trim(), refresh: !!refresh });
    if (!rp.source || rp.source.key !== src.key) return; // nel frattempo l'utente ha cambiato origine
    rp.repos = r.repos; rp.loaded = src.key;
    renderRepos();
  } catch (e) {
    rp.repos = []; rp.loaded = '';
    $('repo-list').replaceChildren(mk('div', 'item', 'Elenco non disponibile.'));
    attachMsg('err', e.message);
  }
}
const fmtDate = (s) => { const d = new Date(s); return isNaN(d) ? '' : d.toLocaleDateString('it-IT'); };
const VIS = { private: ['warn', 'privato'], internal: ['', 'interno'], public: ['ok', 'pubblico'] };
function renderRepos() {
  const q = $('repo-filter').value.trim().toLowerCase();
  const all = rp.repos.filter((r) => !q || r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q) || r.description.toLowerCase().includes(q));
  const shown = all.slice(0, 100);
  if (!rp.repos.length) { if (rp.source && rp.loaded === rp.source.key) $('repo-list').replaceChildren(mk('div', 'item', 'Nessun repository visibile in ' + rp.source.label + '.')); return; }
  if (!shown.length) { $('repo-list').replaceChildren(mk('div', 'item', 'Nessun repository corrisponde alla ricerca.')); return; }
  const rows = shown.map((r) => {
    const it = mk('div', 'item');
    const main = mk('div', 'main');
    const top = mk('div'); top.append(mk('span', 'rn', r.path), ' ');
    const v = VIS[r.visibility] || ['', r.visibility];
    top.append(chip(v[0], v[1]));
    if (r.archived) top.append(' ', chip('', 'archiviato'));
    main.append(top);
    const meta = [r.description, r.pushedAt ? 'ultimo aggiornamento ' + fmtDate(r.pushedAt) : ''].filter(Boolean).join(' · ');
    if (meta) main.append(mk('div', 'rd', meta));
    const b = mk('button', r.local ? 'sm' : 'sm primary', r.local ? 'Aggancia (già in locale)' : 'Clona e aggancia');
    b.type = 'button'; b.style.flex = 'none'; b.disabled = rp.busy;
    b.onclick = () => cloneAndAttach(r);
    it.append(main, b);
    return it;
  });
  if (all.length > shown.length) rows.push(mk('div', 'item', 'Mostrati i primi 100 di ' + all.length + ': restringi la ricerca.'));
  $('repo-list').replaceChildren(...rows);
}
async function cloneAndAttach(r) {
  if (rp.busy || !rp.source) return;
  if (proj.info && proj.info.running) { attachMsg('err', 'Termina prima la sessione in corso: non si può cambiare progetto mentre la pipeline lavora.'); return; }
  const parent = $('repo-parent').value.trim();
  if (!parent) { attachMsg('err', 'Indica la cartella in cui clonare.'); $('repo-parent').focus(); return; }
  rp.busy = true; renderRepos();
  attachMsg('', r.local ? 'Aggancio la copia locale…' : 'Clone di ' + rp.source.label + '/' + r.path + ' in corso: può richiedere alcuni minuti. Non chiudere la pagina.');
  try {
    const res = await call('/api/repos/clone', { source: plainSource(rp.source), repo: r.path, parent });
    proj.info = res.project;
    attachMsg('', '');
    cfgLoaded = false;
    await loadProject();
    toast(res.cloned ? 'Clonato e agganciato: ' + r.name : 'Progetto agganciato: ' + r.name);
    rp.busy = false;
    await loadRepos(false); // aggiorna i segni "già in locale"
    return;
  } catch (e) { attachMsg('err', e.message); }
  rp.busy = false; renderRepos();
}
$('repo-owner').onchange = () => { rp.source = rp.sources.find((s) => s.key === $('repo-owner').value) || null; rp.repos = []; rp.loaded = ''; loadRepos(false); };
$('repo-reload').onclick = () => loadRepos(true);
$('repo-filter').addEventListener('input', renderRepos);
let parentTimer;
$('repo-parent').addEventListener('input', () => { clearTimeout(parentTimer); parentTimer = setTimeout(() => { if (rp.source) loadRepos(false); }, 600); });
let attachInit = false; // l'elenco dal server Git (e la lettura delle credenziali) parte solo alla prima apertura della scheda Progetto

// Aggiunta di un'origine: provider (GitHub o GitLab), server (solo GitLab) e organizzazione/gruppo.
function syncAddForm() {
  const gitlab = $('add-provider').value === 'gitlab';
  $('add-host').hidden = !gitlab;
  $('add-owner').placeholder = gitlab ? 'Gruppo, es. mio-gruppo oppure gruppo/sottogruppo' : 'Organizzazione o utente, es. mia-organizzazione';
  $('add-hint').textContent = gitlab
    ? 'Server e gruppo come compaiono nell indirizzo dei progetti: https://<server>/<gruppo>/<progetto>. Si usano le credenziali che Git ha già salvato per quel server.'
    : 'Il nome che compare in github.com/<nome>/… Si usano le credenziali che Git ha già salvato per GitHub.';
}
$('add-provider').onchange = syncAddForm;
$('repo-owner-add').onclick = () => {
  if (!$('repo-add').hidden) { $('repo-add').hidden = true; return; }
  const gl = (rp.saved || []).find((s) => s.provider === 'gitlab');
  $('add-host').value = gl ? gl.host : '';
  syncAddForm();
  $('repo-add').hidden = false;
  $('add-owner').focus();
};
$('add-cancel').onclick = () => { $('repo-add').hidden = true; };
$('repo-owner-unlink').onclick = async () => {
  if (!rp.source) return;
  try { await call('/api/repos/sources', { sources: rp.saved.map(plainSource), unlink: [rp.source.key] }); rp.loaded = ''; rp.repos = []; attachMsg('', ''); await loadOwners(); } catch (e) { attachMsg('err', e.message); }
};
$('repo-owner-del').onclick = async () => {
  if (!rp.source) return;
  if (!(await askConfirm('Togliere "' + rp.source.label + '" dall\'elenco delle origini?\n\nNon cancella nulla sul server né sul tuo computer.', { title: 'Togli origine', ok: 'Togli', danger: true }))) return;
  try {
    const rest = rp.saved.filter((s) => s.key !== rp.source.key).map(plainSource);
    await call('/api/repos/sources', { sources: rest });
    rp.loaded = ''; rp.repos = [];
    attachMsg('', '');
    await loadOwners();
  } catch (e) { attachMsg('err', e.message); }
};
$('add-save').onclick = async () => {
  const provider = $('add-provider').value;
  const item = { provider, host: provider === 'gitlab' ? $('add-host').value.trim() : 'github.com', owner: $('add-owner').value.trim() };
  if (!item.owner) { attachMsg('err', 'Indica il nome dell organizzazione, utente o gruppo.'); return; }
  const btn = $('add-save'); btn.disabled = true;
  try {
    const cur = await call('/api/repos/sources');
    const r = await call('/api/repos/sources', { sources: [...(cur.savedList || []).map(plainSource), item], linkNew: true });
    const added = r.sources.find((s) => s.provider === provider && s.owner.toLowerCase() === item.owner.toLowerCase());
    $('repo-add').hidden = true; $('add-owner').value = '';
    attachMsg('', '');
    rp.loaded = '';
    await loadOwners(added ? added.key : undefined);
  } catch (e) { attachMsg('err', e.message); }
  btn.disabled = false;
};

