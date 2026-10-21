/* ---------- scheda Tool (sola lettura) ---------- */
const TL = { data: null, mcpLive: null, busy: false };
const tlRow = (status, title, sub, tags, extra) => {
  const it = mk('div', 'item'); it.dataset.q = (title + ' ' + (sub || '') + ' ' + (tags || []).map((t) => t.text).join(' ')).toLowerCase();
  if (status) it.append(mk('span', 'sd ' + status));
  const main = mk('div', 'main'); main.append(mk('b', '', title));
  if (sub) main.append(mk('small', '', sub));
  if (extra) main.append(extra);
  it.append(main);
  for (const t of tags || []) it.append(chip(t.kind || '', t.text));
  return it;
};
const tlEmpty = (text) => { const d = mk('div', 'item'); d.append(mk('small', '', text)); d.dataset.empty = '1'; return d; };
function tlSet(id, rows, emptyText) { $(id).replaceChildren(...(rows.length ? rows : [tlEmpty(emptyText)])); }
function tlSum(id, parts) { $(id).replaceChildren(...parts.filter((p) => p.n).map((p) => chip(p.kind, p.n + ' ' + p.label))); }
const tlMono = (text) => { const c = mk('code', '', text); c.style.cssText = 'display:block;margin-top:2px;overflow-wrap:anywhere;color:var(--muted)'; return c; };

function renderTools() {
  const d = TL.data; if (!d) return;
  const live = new Map((TL.mcpLive || []).map((x) => [x.name, x]));
  // programmi
  tlSet('tl-prog', d.programs.map((p) => tlRow(p.status, p.label, p.why, [{ text: p.detail }])), 'Nessun dato.');
  tlSum('tl-prog-sum', [{ n: d.programs.filter((p) => p.status === 'ok').length, kind: 'ok', label: 'ok' }, { n: d.programs.filter((p) => p.status === 'warn').length, kind: 'warn', label: 'da vedere' }, { n: d.programs.filter((p) => p.status === 'fail').length, kind: 'fail', label: 'mancanti' }]);
  if (!d.project) {
    const none = 'Aggancia un progetto dalla scheda Progetto per vedere cosa carica.';
    for (const id of ['tl-mcp', 'tl-skills', 'tl-agents', 'tl-hooks']) tlSet(id, [], none);
    $('tl-files').replaceChildren(); $('tl-mcp-note').replaceChildren();
    for (const id of ['tl-mcp-sum', 'tl-skill-sum', 'tl-agent-sum', 'tl-hook-sum']) $(id).replaceChildren();
    return;
  }
  // server MCP del progetto, poi connettori dell'account (solo dopo "Verifica stato")
  const mcpRows = d.mcp.servers.map((s) => {
    const lv = live.get(s.name);
    const tags = [{ text: s.type }];
    if (lv) tags.unshift({ kind: lv.status, text: lv.detail });
    else tags.unshift(s.enabled === true ? { kind: 'ok', text: 'abilitato' } : s.enabled === false ? { kind: 'fail', text: 'disabilitato' } : { kind: 'warn', text: 'da approvare al primo uso' });
    const extra = mk('div'); extra.append(tlMono(s.command));
    if (s.envNames.length || s.headerNames.length) extra.append(mk('small', '', 'Richiede: ' + [...s.envNames, ...s.headerNames].join(', ')));
    extra.append(mk('small', '', 'Permessi: ' + s.permissions + (s.runtime ? ' · usa ' + s.runtime : '')));
    if (s.type === 'stdio') { const ob = mk('button', 'sm', 'Credenziali e scheda…'); ob.type = 'button'; ob.style.marginTop = '6px'; ob.title = 'Si apre in una nuova scheda del browser'; ob.onclick = () => window.open('/mcp.html?server=' + encodeURIComponent(s.name), 'nx-mcp'); extra.append(ob); }
    return tlRow(lv ? lv.status : (s.enabled === false ? 'fail' : ''), s.name, '', tags, extra);
  });
  if (TL.mcpLive) for (const x of TL.mcpLive) if (!d.mcp.servers.some((s) => s.name === x.name)) mcpRows.push(tlRow(x.status, x.name, x.scope === 'account' ? 'Connettore del tuo account' : 'Server locale', [{ kind: x.status, text: x.detail }], tlMono(x.command)));
  tlSet('tl-mcp', mcpRows, d.mcp.error || (d.mcp.file ? 'Nessun server in .mcp.json.' : 'Il progetto non ha un file .mcp.json.'));
  tlSum('tl-mcp-sum', [{ n: d.mcp.servers.length, kind: '', label: 'nel progetto' }, { n: TL.mcpLive ? TL.mcpLive.filter((x) => x.status === 'ok').length : 0, kind: 'ok', label: 'attivi' }, { n: TL.mcpLive ? TL.mcpLive.filter((x) => x.status !== 'ok').length : 0, kind: 'warn', label: 'da vedere' }]);
  // skill + comandi
  const originTag = (o) => ({ kind: o === 'kit' ? 'warn' : '', text: o === 'kit' ? 'nel kit' : 'del progetto' });
  const skillRows = [...d.skills.map((s) => tlRow('', '/' + s.name, s.description, [originTag(s.origin)])), ...d.commands.map((c) => tlRow('', '/' + c.name, c.description, [{ text: 'comando' }]))];
  tlSet('tl-skills', skillRows, 'Nessuna skill o comando in .claude.');
  tlSum('tl-skill-sum', [{ n: d.skills.length, kind: '', label: 'skill' }, { n: d.commands.length, kind: '', label: 'comandi' }]);
  // agent
  tlSet('tl-agents', d.agents.map((a) => tlRow('', a.name, a.description, [a.model ? { text: a.model } : null, originTag(a.origin)].filter(Boolean), a.tools ? mk('small', '', 'Strumenti: ' + a.tools) : null)), 'Nessun agent in .claude/agents.');
  tlSum('tl-agent-sum', [{ n: d.agents.length, kind: '', label: 'agent' }]);
  // hook + script
  tlSet('tl-hooks', d.hooks.map((h) => tlRow('', h.event + (h.matcher && h.matcher !== '*' ? ' · ' + h.matcher : ''), '', [{ text: h.source }, { text: h.type }], tlMono(h.command))), 'Nessun hook configurato nelle impostazioni.');
  $('tl-files').replaceChildren(...d.files.map((f) => tlRow('', f.path, f.description, f.registered ? [{ kind: 'ok', text: 'registrato' }] : [])));
  tlSum('tl-hook-sum', [{ n: d.hooks.length, kind: '', label: 'hook' }, { n: d.files.length, kind: '', label: 'file' }]);
  tlFilter();
}
function tlFilter() {
  const q = $('tl-filter').value.trim().toLowerCase();
  for (const id of ['tl-prog', 'tl-mcp', 'tl-skills', 'tl-agents', 'tl-hooks', 'tl-files']) {
    const box = $(id); let shown = 0, rows = 0;
    const old = box.querySelector('[data-nores]'); if (old) old.remove();
    for (const it of box.children) { if (it.dataset.empty) continue; rows++; const hit = !q || it.dataset.q.includes(q); it.hidden = !hit; if (hit) shown++; }
    if (rows && !shown) { const n = tlEmpty('Nessun risultato per il filtro.'); n.dataset.nores = '1'; box.append(n); }
    if (q && shown) secSet(box.closest('section'), true, false);
  }
}
async function loadTools() {
  if (TL.busy) return; TL.busy = true;
  if (!TL.data) $('tl-msg').replaceChildren(nxLoader('Leggo programmi, server e skill…', 'Controllo gli strumenti del computer e del progetto'));
  try { TL.data = await call('/api/tools'); $('tl-msg').replaceChildren(); renderTools(); loadCatalog(); }
  catch (e) { $('tl-msg').replaceChildren(mk('div', 'callout', 'Impossibile leggere i tool: ' + e.message)); }
  finally { TL.busy = false; }
}
async function checkMcp() {
  const b = $('tl-mcp-check'); b.disabled = true; const old = b.textContent; b.textContent = 'Verifica in corso…';
  $('tl-mcp-note').replaceChildren(nxLoader('Verifico lo stato dei server…', 'Li avvio uno per uno: può richiedere fino a un minuto'));
  try { TL.mcpLive = (await call('/api/tools/mcp-status')).items; $('tl-mcp-note').replaceChildren(); renderTools(); }
  catch (e) { $('tl-mcp-note').replaceChildren(mk('div', 'callout', e.message)); }
  finally { b.disabled = false; b.textContent = old; }
}
/* --- aggiungere al progetto (server MCP e kit); nessuna installazione --- */
TL.cat = null;
function catRow(title, desc, tags, btn, extra) {
  const it = tlRow('', title, desc, tags, extra);
  if (btn) it.append(btn);
  return it;
}
function catButton(present, noProject, onClick) {
  const b = mk('button', 'sm', present ? 'Già presente' : 'Aggiungi'); b.type = 'button'; b.style.flex = 'none';
  b.disabled = present || noProject || !can('config.edit');
  if (!present && !noProject && !can('config.edit')) b.title = 'Il tuo profilo non consente di modificare il progetto';
  if (!b.disabled) b.onclick = onClick;
  return b;
}
function renderCatalog() {
  const c = TL.cat; if (!c) return;
  const noProj = !c.project;
  $('tl-cat-note').replaceChildren(noProj ? mk('small', '', 'Aggancia un progetto dalla scheda Progetto per aggiungere elementi.') : '');
  const mcpRows = c.mcp.map((x) => {
    const tags = [x.present ? { kind: 'ok', text: 'nel progetto' } : null, !x.runtimeOk ? { kind: 'warn', text: x.runtime + ' non installato' } : null, { text: 'server MCP' }].filter(Boolean);
    const extra = mk('div');
    if (x.envNames.length) extra.append(mk('small', '', 'Variabili da impostare tu nell\'ambiente: ' + x.envNames.join(', ')));
    if (x.notes) extra.append(mk('small', '', x.notes));
    if (x.source) extra.append(mk('small', '', 'Fonte: ' + x.source));
    return catRow(x.label, x.description, tags, catButton(x.present, noProj, () => addCatalogItem('mcp', x)), extra);
  });
  const kitRows = c.kit.map((x) => catRow(x.label, x.description, [x.present ? { kind: 'ok', text: 'nel progetto' } : null, { text: x.type === 'skill' ? 'skill del kit' : 'agent del kit' }].filter(Boolean), catButton(x.present, noProj, () => addCatalogItem(x.type, x))));
  tlSet('tl-cat-mcp', mcpRows, 'Nessun server nel catalogo.');
  tlSet('tl-cat-kit', kitRows, 'Nessun elemento nel kit.');
  tlSum('tl-cat-sum', [{ n: c.mcp.filter((x) => !x.present).length + c.kit.filter((x) => !x.present).length, kind: '', label: 'da aggiungere' }]);
  tlFilter();
}
async function loadCatalog() {
  try { TL.cat = await call('/api/tools/catalog'); renderCatalog(); }
  catch (e) { $('tl-cat-note').replaceChildren(mk('div', 'callout', 'Impossibile leggere il catalogo: ' + e.message)); }
}
// Dopo l'aggiunta di un server: propone di configurarlo e creare la sua scheda (nuova scheda del browser). Il clic sul pulsante della conferma è il gesto che autorizza l'apertura.
async function offerPanel(key) {
  if (await askConfirm('Il server "' + key + '" è stato aggiunto al progetto.\n\nVuoi configurarlo e creare la sua scheda per usarlo da qui? Si apre in una nuova scheda del browser: imposti le credenziali e Claude prepara l\'interfaccia con te.\n\nPuoi farlo anche più tardi dal pulsante "Credenziali e scheda…" accanto al server.', { title: 'Server aggiunto', ok: 'Configura e crea la scheda' })) window.open('/mcp.html?setup=1&server=' + encodeURIComponent(key), 'nx-mcp');
}
async function addCatalogItem(type, x) {
  const lines = [];
  if (type === 'mcp') {
    lines.push('Aggiungere il server MCP "' + x.label + '" a .mcp.json del progetto?', '', 'Verrà aggiunta questa voce:', x.preview, '');
    if (x.envNames.length) lines.push('Le variabili ' + x.envNames.join(', ') + ' le imposti tu nell\'ambiente: nel progetto non viene scritto nessun valore.', '');
    lines.push(!x.runtimeOk ? 'Attenzione: ' + x.runtime + ' non è installato su questo computer, quindi il server non partirà finché non lo installi (qui non si installa nulla).' : 'Non viene installato nulla.', 'Il file viene riscritto (indentazione e a-capo mantenuti, ma le righe già presenti possono cambiare disposizione). Prima ne salvo una copia in .tmp/. Claude chiederà l\'approvazione del server al primo uso.');
  } else {
    lines.push('Copiare nel progetto ' + (type === 'skill' ? 'la skill' : 'l\'agent') + ' "' + x.label + '"?', '', ...x.files.slice(0, 12), x.files.length > 12 ? '… e altri ' + (x.files.length - 12) + ' file' : '', '', 'Non sovrascrive nulla e non installa nulla.' + (TL.cat.hasProfile ? '' : ' Il progetto non ha .claude/project-profile.md, che le skill e gli agent del kit leggono: usa "Prepara il progetto" per il kit completo.'));
  }
  if (!(await askConfirm(lines.filter((l, i) => l !== '' || lines[i - 1] !== '').join('\n'), { title: 'Aggiungi al progetto', ok: 'Aggiungi' }))) return;
  try {
    const r = await call('/api/tools/add', { type, id: x.id });
    toast('Aggiunto: ' + r.added.slice(0, 2).join(', ') + (r.added.length > 2 ? ' e altri ' + (r.added.length - 2) : '') + (r.backup ? ' (copia in ' + r.backup + ')' : '') + '.');
    if (r.note) toast(r.note);
    TL.mcpLive = null; await Promise.all([loadTools(), loadCatalog()]);
    if (type === 'mcp' && r.key) offerPanel(r.key);
  } catch (e) { toast(e.message, true); }
}
/* --- ricerca nel registro ufficiale MCP (terze parti: conferma rafforzata) --- */
const REG = { busy: false };
const REG_TOPICS = ['Atlassian', 'GitHub', 'GitLab', 'Slack', 'Postgres', 'MySQL', 'Oracle', 'MongoDB', 'Docker', 'Kubernetes', 'AWS', 'Azure', 'Google', 'Notion', 'Sentry', 'Linear', 'Figma', 'filesystem'];
$('tl-reg-chips').replaceChildren(...REG_TOPICS.map((t) => { const b = mk('button', 'sm', t); b.type = 'button'; b.style.flex = 'none'; b.onclick = () => { $('tl-reg-q').value = t; regRun(t); }; return b; }));
function regRow(e) {
  const opts = mk('div'); opts.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;align-items:center';
  e.options.forEach((o, i) => {
    if (o.ok) {
      const b = mk('button', 'sm', 'Aggiungi · ' + o.label); b.type = 'button';
      b.disabled = !TL.cat || !TL.cat.project || !can('config.edit');
      if (!b.disabled) b.onclick = () => addRegistryItem(e, i);
      opts.append(b);
    } else opts.append(mk('small', '', o.label + ': ' + o.why));
  });
  if (!e.options.length) opts.append(mk('small', '', 'Nessuna modalità di avvio indicata dal registro.'));
  const meta = mk('div'); meta.append(mk('small', '', 'Pubblicato da ' + e.publisher + (e.repo ? ' · ' + e.repo : ' · repository non indicato')));
  const tags = [{ text: 'v' + e.version }, { kind: 'warn', text: 'terze parti' }];
  if (e.status !== 'active') tags.push({ kind: 'fail', text: e.status });
  const row = tlRow('', e.name, e.description, tags, meta);
  row.querySelector('.main').append(opts);
  return row;
}
async function regRun(q) {
  if (REG.busy) return; REG.busy = true;
  const note = $('tl-reg-note'), list = $('tl-reg-list');
  note.replaceChildren(nxLoader('Ricerca nel registro MCP…'));
  $('tl-reg-go').disabled = true;
  try {
    const r = await call('/api/tools/registry?q=' + encodeURIComponent(q));
    const rows = r.results.map(regRow);
    list.replaceChildren(...(rows.length ? rows : [tlEmpty('Nessun server trovato per "' + q + '". Prova un altro termine.')]));
    list.hidden = false;
    tlSum('tl-reg-sum', [{ n: list.querySelectorAll('.item:not([data-empty])').length, kind: '', label: 'server' }]);
    note.replaceChildren(mk('small', '', r.total + ' server trovati' + (r.total > r.results.length ? ': mostro i primi ' + r.results.length + ' (restringi la ricerca)' : '') + (r.truncated ? ' · risultati oltre il limite non letti' : '') + '. Per ogni server c\'è l\'ultima versione pubblicata.'));
  } catch (e) {
    // Errore (di solito un timeout del registro, che è lento a intermittenza): messaggio con il pulsante per rilanciare la stessa ricerca.
    const box = mk('div', 'callout', e.message); box.style.cssText = 'display:flex;gap:12px;align-items:center;flex-wrap:wrap';
    const again = mk('button', 'sm primary', 'Riprova'); again.type = 'button'; again.style.flex = 'none'; again.onclick = () => regRun(q);
    box.append(again); note.replaceChildren(box);
  }
  finally { REG.busy = false; $('tl-reg-go').disabled = false; }
}
async function addRegistryItem(e, i) {
  const o = e.options[i];
  const lines = [
    'Aggiungere "' + e.name + '" v' + e.version + ' (registro MCP ufficiale) a .mcp.json del progetto?', '',
    'ATTENZIONE: è un server di terze parti. Il registro verifica chi possiede il nome "' + e.publisher + '", non il codice: controlla il repository prima di procedere.',
    'Repository: ' + (e.repo || 'non indicato'), '',
    o.summary, '', 'Verrà aggiunta questa voce:', o.preview, '',
  ];
  if (o.envNames.length) lines.push('Da impostare tu nell\'ambiente (nel progetto non viene scritto nessun valore): ' + o.envNames.map((x) => x.name).join(', '));
  else if (o.kind !== 'remote' && !o.optionalEnv.length) lines.push('Il registro non elenca variabili richieste: se il server ha bisogno di credenziali, sono nella sua documentazione.');
  if (o.optionalEnv.length) lines.push('Il registro le indica come facoltative e NON le scrivo: ' + o.optionalEnv.map((x) => x.name).join(', ') + '. Se il server le richiede, le aggiungi tu.');
  lines.push('', 'Non viene installato nulla adesso' + (o.kind === 'remote' ? '.' : ': il pacchetto si scarica ed esegue al primo avvio da parte di claude.') + ' Prima di scrivere salvo una copia di .mcp.json in .tmp/. Claude chiederà l\'approvazione del server al primo uso.');
  if (!(await askConfirm(lines.filter((l, k) => l !== '' || lines[k - 1] !== '').join('\n'), { title: 'Server di terze parti', ok: 'Ho capito, aggiungi' }))) return;
  try {
    const r = await call('/api/tools/add', { type: 'registry', id: e.name, version: e.version, option: i });
    toast('Aggiunto "' + r.key + '" a .mcp.json' + (r.backup ? ' (copia in ' + r.backup + ')' : '') + '.');
    if (r.note) toast(r.note);
    TL.mcpLive = null; await Promise.all([loadTools(), loadCatalog()]);
    if (r.key) offerPanel(r.key);
  } catch (err) { toast(err.message, true); }
}
$('tl-reg-go').onclick = () => { const q = $('tl-reg-q').value.trim(); if (q.length < 2) { toast('Scrivi almeno 2 caratteri.', true); return; } regRun(q); };
$('tl-reg-q').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); $('tl-reg-go').click(); } });
$('tl-filter').addEventListener('input', tlFilter);
$('tl-refresh').onclick = () => { TL.mcpLive = null; loadTools(); };
$('tl-mcp-check').onclick = checkMcp;
function bindNav(b) {
  b.onclick = () => {
    curTab = b.dataset.tab; if (curTab === 'run') needsAttn = false; updateNavDot(); updateBtw();
    if (curTab === 'run' && lastStatus === 'waiting') setTimeout(() => $('text').focus(), 80);
    document.querySelectorAll('nav button').forEach((x) => x.classList.toggle('active', x === b));
    $('view-run').hidden = b.dataset.tab !== 'run';
    $('view-project').hidden = b.dataset.tab !== 'project';
    $('view-git').hidden = b.dataset.tab !== 'git';
    $('view-dash').hidden = b.dataset.tab !== 'dash';
    $('view-jira').hidden = b.dataset.tab !== 'jira';
    $('view-config').hidden = b.dataset.tab !== 'config';
    $('view-license').hidden = b.dataset.tab !== 'license';
    $('view-tools').hidden = b.dataset.tab !== 'tools';
    if (b.dataset.tab === 'tools') loadTools();
    if (b.dataset.tab === 'license') loadLicense();
    if (b.dataset.tab === 'project') { loadProject(); if (!attachInit) { attachInit = true; setAttachMode('repo'); } }
    if (b.dataset.tab === 'git') loadGit();
    if (b.dataset.tab === 'jira') loadJira();
    if (b.dataset.tab === 'dash') loadDash();
    if (b.dataset.tab === 'config') { loadConfig(); if (!cfgLoaded) { cfgLoaded = true; runDiag(); } }
    $('view-mcp').hidden = !b.dataset.tab.startsWith('mcp:');
    if (b.dataset.tab.startsWith('mcp:')) showMcp(b.dataset.tab.slice(4));
  };
}
document.querySelectorAll('nav button').forEach(bindNav);

