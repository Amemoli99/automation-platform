/* ---------- in diretta: le finestre di Claude (cosa scrive, cosa sta eseguendo) ---------- */
const toolLines = new Map(); // id azione -> riga nella conversazione (per attaccarci l'output)
const win = { act: null, timer: null };
const winChip = (id, cls, text) => { const c = $(id); c.className = 'win-chip' + (cls ? ' ' + cls : ''); c.textContent = text; };
function winFollow(pre, fn) { const stick = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 40; fn(); if (stick) pre.scrollTop = pre.scrollHeight; }
function winShow() { $('lv-win').hidden = false; }
function winReset() {
  win.act = null; clearInterval(win.timer); win.timer = null; toolLines.clear();
  if (!$('lv-win')) return;
  $('lv-win').hidden = true;
  $('ww-body').replaceChildren(); winChip('ww-chip', '', '');
  $('wa-body').replaceChildren(); $('wa-title').textContent = 'Azione in corso'; winChip('wa-chip', '', ''); winSay('In attesa della prossima azione…', '');
}
// Frase in italiano per ciò che Claude sta facendo (costruita qui, senza chiedere nulla a Claude). `now` = in corso, `past` = concluso.
const NOW_CMD = {
  'Controlla lo stato del codice': 'controllando lo stato del codice', 'Passa al branch di lavoro': 'passando al branch di lavoro',
  'Salva le modifiche': 'salvando le modifiche', 'Pubblica le modifiche': 'pubblicando le modifiche', 'Aggiorna il codice': 'aggiornando il codice',
  'Compila il progetto': 'compilando il progetto', 'Esegue il test': 'eseguendo il test', 'Esegue la compilazione del progetto': 'compilando il progetto',
  'Esplora le cartelle del progetto': 'esplorando le cartelle del progetto', 'Legge e cerca nei file': 'leggendo e cercando nei file',
  'Gestisce file e cartelle': 'gestendo file e cartelle', 'Contatta un servizio esterno': 'contattando un servizio esterno',
  'Esegue uno strumento di supporto': 'eseguendo uno strumento di supporto',
};
const NOW_WEB = { navigate: "aprendo una pagina dell'applicazione", click: 'cliccando un elemento', type: 'scrivendo in un campo', fill_form: 'compilando un modulo', snapshot: 'osservando la pagina', wait_for: 'aspettando che la pagina sia pronta', take_screenshot: 'catturando la schermata', select_option: 'scegliendo una voce', hover: 'passando sopra un elemento', press_key: 'premendo un tasto', evaluate: 'leggendo i dati della pagina', navigate_back: 'tornando indietro', close: 'chiudendo il browser', tabs: 'gestendo le schede del browser' };
const baseName = (s) => String(s || '').split('\n')[0].split(/[\\/]/).pop();
const nLines = (s) => (String(s || '').replace(/\n$/, '').match(/\n/g) || []).length + (s ? 1 : 0);
function narrate(name, title, body) {
  const tt = String(title || '').split('\n')[0], b = String(body || '');
  const f = baseName(tt) ? ' ' + baseName(tt) : '';
  if (name === 'Bash') {
    const r = CMD_RULES.find(([re]) => re.test(tt));
    const now = r && NOW_CMD[r[1]] ? NOW_CMD[r[1]] : 'eseguendo un comando sul computer';
    return { now: 'Sto ' + now, past: 'Comando concluso', sub: b.startsWith('# ') ? b.slice(2).split('\n')[0] : (r ? r[1] : ''), run: true };
  }
  if (name === 'Read') return { now: 'Sto leggendo il file' + f, past: 'Ho letto il file' + f, sub: tt };
  if (name === 'Write') { const n = nLines(b); return { now: 'Sto scrivendo il file' + f + (n ? ' (' + n + (n === 1 ? ' riga' : ' righe') + ' finora)' : ''), past: 'Ho creato il file' + f + (n ? ' (' + n + ' righe)' : ''), sub: tt }; }
  if (name === 'Edit') {
    const del = (b.match(/^- /gm) || []).length, add = (b.match(/^\+ /gm) || []).length;
    const what = del || add ? ': tolgo ' + del + (del === 1 ? ' riga' : ' righe') + ', ne aggiungo ' + add : '';
    return { now: 'Sto modificando il file' + f + what, past: 'Ho modificato il file' + f + what.replace('tolgo', 'tolte').replace(', ne aggiungo ', ', aggiunte '), sub: tt };
  }
  if (name === 'Glob') return { now: 'Sto cercando i file del progetto', past: 'Ho cercato i file del progetto', sub: tt };
  if (name === 'Grep') return { now: 'Sto cercando nel codice' + (tt ? ' «' + tt.slice(0, 50) + '»' : ''), past: 'Ho cercato nel codice', sub: '' };
  if (name === 'Agent' || name === 'Task') return { now: 'Sto affidando un lavoro a un collaboratore', past: 'Il collaboratore ha finito', sub: tt, run: true };
  if (name === 'Skill') return { now: 'Sto avviando la procedura ' + tt, past: 'Procedura completata', sub: '', run: true };
  if (name === 'ToolSearch') return { now: 'Sto preparando gli strumenti necessari', past: 'Strumenti pronti', sub: '' };
  if (name.startsWith('mcp__playwright')) { const k = name.split('__').pop().replace('browser_', ''); return { now: 'Sto ' + (NOW_WEB[k] || "usando l'applicazione nel browser"), past: "Ho usato l'applicazione nel browser", sub: tt, run: true }; }
  return { now: 'Sto usando lo strumento ' + name.split('__').pop(), past: 'Ho finito di usare ' + name.split('__').pop(), sub: tt };
}
function winSay(main, sub, cls) {
  const box = $('wa-say'); if (!box) return;
  box.className = 'win-say' + (cls ? ' ' + cls : '');
  box.replaceChildren(el('b', '', main), ...(sub ? [el('small', '', sub)] : []));
}
function winSayAct() { // aggiorna la frase secondo la fase dell'azione corrente
  const a = win.act; if (!a || !a.say) return;
  const s = a.say, secs = Math.round((Date.now() - a.t0) / 1000);
  if (a.done) { winSay(s.past + (a.err ? ' (con un errore: vedi il dettaglio)' : ''), s.sub, a.err ? 'err' : 'ok'); return; }
  if (a.phase === 'write') { winSay(s.now + '…', s.sub); return; }
  const wait = s.run ? (secs >= 60 ? ' Ci vuole un po\u2019, ma è ancora in corso (' + secs + ' s).' : ' Aspetto che finisca' + (secs >= 3 ? ' (' + secs + ' s)' : '') + '.') : '';
  winSay(s.now + '.' + wait, s.sub);
}
function winTick() {
  const a = win.act;
  if (!a || a.done) { clearInterval(win.timer); win.timer = null; return; }
  winSayAct();
  winChip('wa-chip', 'run', (a.phase === 'write' ? 'scrive ' : 'in esecuzione ') + Math.round((Date.now() - a.t0) / 1000) + ' s');
}
function winStart(id, name, phase) {
  win.act = { id, name, t0: Date.now(), done: false, phase, say: narrate(name, '', '') };
  winSayAct();
  if (!win.timer) win.timer = setInterval(winTick, 1000);
}
function winText(p) { // il testo che Claude sta scrivendo
  winShow();
  const pre = $('ww-body');
  winFollow(pre, () => { pre.textContent = p.text; pre.appendChild(el('span', 'win-cur')); });
  winChip('ww-chip', 'run', 'scrive…');
}
// righe colorate: + e - per le modifiche, # per i commenti
function winLines(pre, text, kind) {
  for (const l of String(text).split('\n')) pre.appendChild(el('span', kind === 'edit' ? (l.startsWith('+ ') ? 'add' : l.startsWith('- ') ? 'del' : '') : (l.startsWith('# ') ? 'dim' : ''), l + '\n'));
}
function winAction(p) { // i parametri dell'azione (comando, file, codice) mentre Claude li scrive
  winShow();
  const kind = toolKind(p.name);
  if (!win.act || win.act.id !== p.id) { winStart(p.id, p.name, 'write'); $('wa-body').replaceChildren(); }
  win.act.phase = 'write'; win.act.say = narrate(p.name, p.title, p.body); winSayAct();
  $('wa-title').textContent = p.name + (p.title ? ' · ' + p.title.split('\n')[0].slice(0, 90) : '');
  const pre = $('wa-body');
  winFollow(pre, () => {
    pre.replaceChildren();
    if (kind === 'cmd' && p.title) pre.appendChild(el('span', '', '$ ' + p.title + '\n'));
    else if (p.title) pre.appendChild(el('span', 'dim', p.title + '\n'));
    if (p.body) winLines(pre, p.body, p.name === 'Edit' ? 'edit' : 'other');
    pre.appendChild(el('span', 'win-cur'));
  });
  winTick();
}
function winEnd(d) { // fine del blocco: il testo è completo, oppure l'azione è scritta e ora gira
  if (d.kind === 'text') { winChip('ww-chip', '', ''); const c = $('ww-body').querySelector('.win-cur'); if (c) c.remove(); return; }
  if (win.act && win.act.id === d.id) { win.act.phase = 'run'; win.act.t0 = Date.now(); const c = $('wa-body').querySelector('.win-cur'); if (c) c.remove(); winTick(); }
}
// se la CLI non manda i messaggi parziali (o alla ricarica della pagina) si parte dall'azione completa
function winFallback(d) {
  if (!d.id || (win.act && win.act.id === d.id)) return;
  winShow();
  winStart(d.id, d.name, 'run'); win.act.say = narrate(d.name, d.detail, ''); winSayAct();
  $('wa-title').textContent = d.name + (d.detail ? ' · ' + String(d.detail).split('\n')[0].slice(0, 90) : '');
  const pre = $('wa-body'); pre.replaceChildren();
  pre.appendChild(el('span', toolKind(d.name) === 'cmd' ? '' : 'dim', (toolKind(d.name) === 'cmd' ? '$ ' : '') + (d.detail || d.name) + '\n'));
  winTick();
}
function winOut(d) { // risultato dell'azione (arriva a comando finito)
  const a = win.act;
  if (!a || a.id !== d.id) return;
  a.done = true; a.err = !!d.isError; clearInterval(win.timer); win.timer = null;
  if (a.say) { a.say.past = a.say.past + (a.say.run ? ' in ' + Math.max(1, Math.round((Date.now() - a.t0) / 1000)) + ' s' : ''); winSayAct(); }
  const pre = $('wa-body');
  winFollow(pre, () => {
    const c = pre.querySelector('.win-cur'); if (c) c.remove();
    pre.appendChild(el('span', 'sep', '── risultato ──\n'));
    pre.appendChild(el('span', d.isError ? 'del' : 'out', (d.text || '(nessun output)') + '\n'));
    if (d.size > (d.text || '').length + 20) pre.appendChild(el('span', 'dim', '… output lungo: mostrata solo la parte finale\n'));
  });
  winChip('wa-chip', d.isError ? 'err' : 'ok', (d.isError ? 'errore · ' : 'ok · ') + Math.max(1, Math.round((Date.now() - a.t0) / 1000)) + ' s');
}
function winClear() { // il processo è terminato: nulla resta "in corso"
  clearInterval(win.timer); win.timer = null;
  for (const id of ['ww-body', 'wa-body']) { const c = $(id).querySelector('.win-cur'); if (c) c.remove(); }
  if (win.act && !win.act.done) winChip('wa-chip', '', '');
  winChip('ww-chip', '', '');
  if (win.act && !win.act.done) winSay('Il lavoro si è fermato prima di concludere questa azione.', '');
}
// l'output dell'azione compare anche nella conversazione, sotto la riga dell'azione
function toolOutput(d) {
  const line = toolLines.get(d.id);
  if (!line || !d.text) return;
  const det = el('details', 'tout');
  det.append(el('summary', '', 'output' + (d.size > d.text.length + 20 ? ' (parziale)' : '')), el('pre', '', d.text));
  line.insertAdjacentElement('afterend', det);
}
// Frase leggibile per chi non è del mestiere. `tech` è il dettaglio grezzo (comando, pattern): si vede solo con "Dettagli tecnici".
const CMD_RULES = [
  [/\bgit\s+(status|diff|log|show|branch|rev-parse)\b/i, 'Controlla lo stato del codice'],
  [/\bgit\s+(checkout|switch)\b/i, 'Passa al branch di lavoro'],
  [/\bgit\s+(add|commit|stash)\b/i, 'Salva le modifiche'],
  [/\bgit\s+push\b/i, 'Pubblica le modifiche'],
  [/\bgit\s+(fetch|pull|merge)\b/i, 'Aggiorna il codice'],
  [/\bmvn\b[^|;&]*\b(test-compile|compile|package|install)\b/i, 'Compila il progetto'],
  [/\bmvn\b[^|;&]*(\btest\b|-Dtest|verify|surefire)/i, 'Esegue il test'],
  [/\bmvn\b/i, 'Esegue la compilazione del progetto'],
  [/\b(Get-ChildItem|dir|ls|tree|find)\b/i, 'Esplora le cartelle del progetto'],
  [/\b(Get-Content|Select-String|cat|type|head|tail|grep|findstr|rg)\b/i, 'Legge e cerca nei file'],
  [/\b(mkdir|New-Item|Copy-Item|Move-Item|Remove-Item|cp|mv|rm|del)\b/i, 'Gestisce file e cartelle'],
  [/\b(curl|wget|Invoke-WebRequest|Invoke-RestMethod)\b/i, 'Contatta un servizio esterno'],
  [/\b(node|python|java|npm|npx)\b/i, 'Esegue uno strumento di supporto'],
];
const WEB_VERBS = { navigate: "Apre una pagina dell'applicazione", click: 'Clicca un elemento', type: 'Scrive in un campo', fill_form: 'Compila un modulo', snapshot: 'Osserva la pagina', wait_for: 'Attende che la pagina sia pronta', take_screenshot: 'Cattura la schermata', select_option: 'Sceglie una voce', hover: 'Passa sopra un elemento', press_key: 'Preme un tasto', evaluate: 'Legge i dati della pagina', navigate_back: 'Torna indietro', close: 'Chiude il browser', tabs: 'Gestisce le schede del browser' };
function friendlyTool(name, detail) {
  const d = String(detail || '');
  if (name === 'Bash') { const r = CMD_RULES.find(([re]) => re.test(d)); return { verb: r ? r[1] : "Esegue un'operazione sul computer", sub: '', tech: d }; }
  if (name.startsWith('mcp__playwright')) { const k = name.split('__').pop().replace('browser_', ''); return { verb: WEB_VERBS[k] || "Usa l'applicazione nel browser", sub: '', tech: d }; }
  if (name === 'Read') return { verb: 'Legge un file', sub: d, tech: d };
  if (name === 'Edit') return { verb: 'Modifica un file', sub: d, tech: d };
  if (name === 'Write') return { verb: 'Crea un file', sub: d, tech: d };
  if (name === 'Glob') return { verb: 'Cerca i file del progetto', sub: '', tech: d };
  if (name === 'Grep') return { verb: 'Cerca nel codice', sub: '', tech: d };
  if (name === 'Agent' || name === 'Task') return { verb: 'Assegna il lavoro a un collaboratore', sub: d, tech: d };
  if (name === 'Skill') return { verb: 'Avvia la procedura', sub: d, tech: d };
  if (name === 'ToolSearch') return { verb: 'Prepara gli strumenti necessari', sub: '', tech: d };
  return { verb: name, sub: '', tech: d };
}
const KIND = {
  read: { label: 'Letture', svg: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.8"/>' },
  cmd: { label: 'Comandi', svg: '<path d="M4 6l6 6-6 6"/><path d="M12 19h8"/>' },
  edit: { label: 'Modifiche', svg: '<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 013 3L8 19z"/><path d="M14.5 6.5l3 3"/>' },
  agent: { label: 'Agenti', svg: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 17l.7 1.8L21.5 19.5l-1.8.7L19 22l-.7-1.8-1.8-.7 1.8-.7z"/>' },
  web: { label: 'Browser', svg: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.7 3.9 5.7 3.9 9S14.6 18.3 12 21c-2.6-2.7-3.9-5.7-3.9-9S9.4 5.7 12 3z"/>' },
  misc: { label: 'Altro', svg: '<circle cx="12" cy="12" r="3"/>' },
};
const kindIcon = (k) => { const s = el('span', 'ic'); s.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + (KIND[k] || KIND.misc).svg + '</svg>'; return s; }; // svg costanti, nessun dato esterno
const ago = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 5 ? 'adesso' : s < 60 ? s + ' s fa' : Math.floor(s / 60) + ' min fa'; };
function describe(name, d) {
  const q = d ? ': ' + d : '', x = d ? ' ' + d : '';
  if (name.startsWith('mcp__playwright')) return 'Interagisce con il browser (' + name.split('__').pop().replace('browser_', '') + ')';
  const map = {
    Read: 'Legge' + x, Glob: 'Cerca file' + q, Grep: 'Cerca nel codice' + q, Bash: 'Esegue un comando' + q,
    Edit: 'Modifica' + x, Write: 'Scrive' + x, Agent: 'Delega a un agente' + q, Task: 'Delega a un agente' + q,
    Skill: 'Avvia la skill' + x, ToolSearch: 'Carica gli strumenti necessari',
  };
  return map[name] || name + x;
}
// Storico a linea del tempo: le voci già disegnate restano, si aggiungono solo le nuove (con animazione).
function paintFeed() {
  const wrap = $('tl-wrap'), ul = $('lv-feed');
  // contatori per tipo = filtri
  const counts = {}; for (const f of live.feed) counts[f.kind] = (counts[f.kind] || 0) + 1;
  const kinds = ['read', 'cmd', 'edit', 'agent', 'web', 'misc'].filter((k) => counts[k]);
  if (live.filter !== 'all' && !counts[live.filter]) live.filter = 'all';
  const sig = live.feed.length + ':' + live.filter;
  const chipsEl = $('tl-chips');
  if (chipsEl.dataset.sig !== sig) {
    chipsEl.dataset.sig = sig;
    const mkChip = (k, label, n) => {
      const b = el('button', 'tl-chip' + (live.filter === k ? ' on' : '')); b.type = 'button';
      if (k !== 'all') { const d = el('i'); d.style.setProperty('--kc', ({ read: '#6b8afd', cmd: '#7c3aed', edit: 'var(--ok)', agent: 'var(--brand)', web: '#0ea5a4', misc: 'var(--line-strong)' })[k]); b.append(d); }
      b.append(document.createTextNode(label + ' '), el('b', '', String(n)));
      b.onclick = () => { live.filter = k; live.shown = []; paintFeed(); };
      return b;
    };
    const tech = el('button', 'tl-chip tl-tech' + (techOn ? ' on' : ''), 'Dettagli tecnici'); tech.type = 'button';
    tech.title = 'Mostra anche comandi e percorsi completi';
    tech.onclick = () => { techOn = !techOn; try { localStorage.setItem('liveTech', techOn ? '1' : '0'); } catch { /* storage non disponibile */ } live.shown = []; chipsEl.dataset.sig = ''; paintFeed(); };
    chipsEl.replaceChildren(mkChip('all', 'Tutte', live.feed.length), ...kinds.map((k) => mkChip(k, KIND[k].label, counts[k])), tech);
  }
  const list = live.feed.filter((f) => live.filter === 'all' || f.kind === live.filter);
  if (!list.length) {
    ul.replaceChildren(); live.shown = [];
    if (!ul.nextElementSibling) wrap.append(Object.assign(el('div', 'tl-empty'), { textContent: 'Sessione in avvio: le azioni compariranno qui.' }));
    return;
  }
  const emp = wrap.querySelector('.tl-empty'); if (emp) emp.remove();
  const nearEnd = wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 80;
  const ids = list.map((f) => f.seq);
  const keep = live.shown.length && live.shown.every((s, i) => ids[i] === s);
  const fresh = keep ? list.slice(live.shown.length) : list;
  if (!keep) ul.replaceChildren();
  for (const f of fresh) {
    const li = el('li', 'k-' + f.kind + (keep ? ' new' : '')); li.dataset.t = f.t; const fr = friendlyTool(f.name || '', f.detail); li.title = techOn && fr.tech ? fr.verb + ' — ' + fr.tech : fr.verb;
    const bd = el('div', 'bd'); bd.append(el('div', 'vb', fr.verb));
    const shownSub = techOn ? fr.tech : fr.sub;
    if (shownSub) bd.append(el('span', 'dt', shownSub));
    const tm = el('div', 'tm'); tm.append(el('b', '', new Date(f.t).toLocaleTimeString('it-IT')), el('span', 'ag'));
    li.append(kindIcon(f.kind), bd, tm);
    if (f.file && !demoOn) li.insertBefore(ideButton(f.file), tm);
    ul.append(li);
  }
  live.shown = ids;
  const running = lastStatus === 'running';
  const rows = ul.children;
  for (let i = 0; i < rows.length; i++) {
    const last = i === rows.length - 1;
    rows[i].classList.toggle('now', last && running); rows[i].classList.toggle('past', !(last && running));
    rows[i].querySelector('.ag').textContent = ago(Date.now() - Number(rows[i].dataset.t));
  }
  if (nearEnd || fresh.length === list.length) wrap.scrollTop = wrap.scrollHeight;
}

function paintLive() {
  if ($('pane-live').hidden) return;
  const on = stepsOn();
  const cur = on ? STEPS.find((x) => lastSteps[x.id] === 'running') : null;
  const done = on ? STEPS.filter((x) => lastSteps[x.id] === 'done').length : 0;
  $('lv-ticket').textContent = runInfo.title || 'Esecuzione in corso';
  $('lv-title').textContent = devStarted(on) ? phaseDeveloping() : PHASE_READY; // niente nome della skill: conta in che fase siamo
  $('lv-sub').textContent = on ? (cur ? (cur.desc || DESC[cur.id]) : 'Coordina la pipeline e prepara il prossimo step') : 'La skill del progetto sta lavorando';
  $('lv-bar').parentElement.style.display = on ? '' : 'none';
  $('lv-bar').style.width = Math.round((done / Math.max(STEPS.length, 1)) * 100) + '%';
  $('lv-prog').textContent = on ? done + ' di ' + STEPS.length + ' step completati' : '';
  $('lv-ops').textContent = live.ops + (live.ops === 1 ? ' operazione' : ' operazioni');
  const sec = Math.max(0, Math.floor((Date.now() - (live.t0 || Date.now())) / 1000));
  $('lv-time').textContent = String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
  paintFeed();
}

