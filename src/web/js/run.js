/* ---------- pipeline e stato ---------- */
const stepsOn = () => !(proj.insp && proj.insp.pipeline && !proj.insp.pipeline.stepsMeaningful);
// Step della skill scelta nel progetto (se ne ha di propri), altrimenti quelli del kit.
function syncSteps() { STEPS = (proj.insp && proj.insp.pipeline && proj.insp.pipeline.steps) || DEFAULT_STEPS; }
function renderSteps(state) {
  syncSteps();
  lastSteps = state;
  if (!stepsOn()) {
    const li = document.createElement('li'); li.className = 'step pending';
    li.innerHTML = '<div class="dot">•</div><div class="t"><b></b><span></span></div>';
    li.querySelector('b').textContent = 'Skill del progetto';
    li.querySelector('span').textContent = 'Ha i propri step: segui l\'attività nella vista in corso e nella conversazione.';
    $('steps').replaceChildren(li);
    return;
  }
  $('steps').replaceChildren(...STEPS.map((s, i) => {
    let st = state[s.id] || 'pending';
    if (st === 'running' && lastStatus === 'waiting') st = 'waiting'; // lo step è fermo in attesa di te
    const li = document.createElement('li');
    li.className = 'step ' + st;
    li.innerHTML = '<div class="dot"></div><div class="t"><b></b><span></span></div>';
    li.querySelector('.dot').textContent = st === 'done' ? '✓' : st === 'error' ? '!' : st === 'waiting' ? '…' : String(i);
    li.querySelector('b').textContent = s.label.replace(/^\d+\s*/, '');
    li.querySelector('span').textContent = st === 'waiting' ? (lastResult.denials.length ? 'Bloccato: permesso negato' : 'In attesa della tua risposta') : (s.desc || DESC[s.id] || '');
    return li;
  }));
}
// Perché la pipeline è ferma: ogni fine turno porta a `waiting`, ma i motivi sono diversi.
// "domanda" vs "conclusa" è un'euristica sullo stato degli step, non un segnale esplicito della skill.
const baseTitle = document.title;
let lastAssistant = '';
let lastResult = { denials: [], isError: false };
function waitInfo() {
  const cur = STEPS.find((x) => lastSteps[x.id] === 'running');
  const stepName = cur ? cur.label.replace(/^\d+\s*/, '') : '';
  const inStep = stepName ? 'Step in pausa: ' + stepName : '';
  if (lastResult.denials.length) {
    return { kind: 'err', icon: '!', title: 'Bloccata: serve il tuo permesso', sub: (inStep ? inStep + ' · ' : '') + lastResult.denials.map((x) => x.rule).join(', ') + ' (usa "Consenti e riprendi" nella conversazione)' };
  }
  if (lastResult.authError) {
    return { kind: 'err', icon: '!', title: 'Sessione Claude scaduta', sub: 'Accedi di nuovo con il pulsante qui sotto, poi avvia una nuova esecuzione.', login: true };
  }
  if (lastResult.isError || STEPS.some((x) => lastSteps[x.id] === 'error')) {
    return { kind: 'err', icon: '!', title: 'Turno terminato con errore', sub: inStep || 'Controlla la conversazione, poi rispondi o avvia una nuova esecuzione' };
  }
  if (!cur && lastSteps.run === 'done') {
    return { kind: 'ok', icon: '✓', title: phaseDeveloped(), sub: 'Nessuna risposta richiesta. Puoi scrivere per chiedere modifiche oppure avviare una nuova esecuzione.' };
  }
  if (!stepsOn() && lastStatus === 'waiting') {
    const q2 = lastAssistant.replace(/[#*`>_|]/g, ' ').replace(/\s+/g, ' ').trim();
    return { kind: '', icon: '?', title: 'La skill ha terminato il turno', sub: (q2 ? '“' + (q2.length > 220 ? q2.slice(0, 220) + '…' : q2) + '”' : 'Rispondi per proseguire') + ' — se ha finito, avvia una nuova esecuzione.' };
  }
  if (lastStatus === 'error') return { kind: 'err', icon: '!', title: 'Sessione terminata', sub: 'La sessione si è interrotta (terminata da te o per un errore). Leggi la conversazione e, se serve, avvia una nuova esecuzione.' };
  if (lastStatus === 'done') return { kind: 'ok', icon: '✓', title: 'Sessione conclusa', sub: 'Il processo è terminato. Puoi avviare una nuova esecuzione.' };
  const q = lastAssistant.replace(/[#*`>_|]/g, ' ').replace(/\s+/g, ' ').trim();
  return { kind: '', icon: '?', title: "La pipeline ha bisogno di te", sub: (inStep ? inStep + ' · ' : '') + (q ? '“' + (q.length > 220 ? q.slice(0, 220) + '…' : q) + '”' : 'Rispondi qui sotto per proseguire') };
}

/* --- quale vista mostrare: nuova esecuzione / avanzamento / conversazione --- */
let pinChat = false;       // l'utente ha aperto la conversazione mentre la pipeline lavora
let dismissed = false;     // a esecuzione conclusa si è scelto "Nuova esecuzione"
let prevPane = '';
let needsAttn = false;     // la pipeline ha qualcosa per te e non hai ancora guardato
function choosePane() {
  if (lastStatus === 'idle') return 'start';
  if (lastStatus === 'running') return pinChat ? 'chat' : 'live';
  if (lastStatus === 'waiting') return 'chat';      // si apre da sola: serve la tua risposta
  return dismissed ? 'start' : 'chat';              // concluso o in errore: si legge l'esito
}
function renderAttn() {
  const box = $('attn');
  const show = lastStatus === 'waiting' || lastStatus === 'done' || lastStatus === 'error';
  box.hidden = !show;
  if (!show) return;
  const i = waitInfo();
  box.className = 'attn' + (i.kind ? ' ' + i.kind : '');
  box.replaceChildren(el('div', 'ai', i.icon), (() => { const d = el('div'); d.append(el('div', 'at', i.title), el('div', 'as', i.sub)); if (i.login) { const lb = loginButton(() => { lastResult.authError = false; renderAttn(); }); lb.style.marginTop = '8px'; d.append(lb); } d.style.minWidth = '0'; return d; })());
}
function renderPane() {
  const p = choosePane();
  for (const k of ['start', 'live', 'chat']) $('pane-' + k).hidden = k !== p;
  $('ch-back').hidden = !(lastStatus === 'running' && pinChat);
  $('ch-new').hidden = !(lastStatus === 'done' || lastStatus === 'error');
  $('ch-ticket').textContent = runInfo.title || '';
  renderAttn();
  if (p === 'chat' && prevPane !== 'chat') {
    unseen = 0; updateUnseen();
    requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; $('jump').hidden = true; });
  }
  prevPane = p;
  updateNavDot();
}
$('lv-open').onclick = () => { pinChat = true; renderPane(); };
$('ch-back').onclick = () => { pinChat = false; renderPane(); };
$('ch-new').onclick = () => { dismissed = true; renderPane(); };
$('goto-dash').onclick = () => gotoTab('dash');
let curTab = 'run';
function updateNavDot() {
  const b = document.querySelector('nav button[data-tab="run"]');
  if (b) b.classList.toggle('attn', needsAttn && curTab !== 'run');
}

function setUi(status) {
  const was = lastStatus;
  lastStatus = status;
  updateBtw();
  const active = status === 'running' || status === 'waiting';
  const b = $('badge'); b.className = 'pill ' + status; b.querySelector('span').textContent = ({ idle: 'Pronto', running: 'In corso', waiting: 'Serve una risposta', done: 'Concluso', error: 'Terminato' })[status] || status;
  $('start').disabled = active || !projOk || !can('run');
  $('stop').disabled = !active;
  const w = status === 'waiting';
  $('text').disabled = !w; $('send').disabled = !w; $('attach').disabled = !w;
  $('quick').hidden = !w;
  if (status === 'running') {
    if (was !== 'running') { pinChat = false; dismissed = false; if (!live.t0) live.t0 = Date.now(); needsAttn = false; }
    clearInterval(live.timer);
    live.timer = setInterval(paintLive, 1000);
    lastResult = { denials: [], isError: false };
  } else {
    clearInterval(live.timer);
    if (was === 'running' || was === 'idle') needsAttn = status === 'waiting' || status === 'error' || status === 'done';
  }
  document.title = (w ? '● Attende te — ' : '') + baseTitle;
  renderSteps(lastSteps);
  renderPane();
  paintLive();
  if (w && was !== 'waiting') setTimeout(() => $('text').focus(), 50);
  if (w && $('lv-win') && !$('lv-win').hidden) winSay('Sto aspettando una tua risposta', 'Rispondi dalla conversazione per farmi proseguire.', 'wait');
}

/* ---------- avanzamento: "cosa sta facendo ora" ---------- */
let techOn = false; try { techOn = localStorage.getItem('liveTech') === '1'; } catch { /* storage non disponibile */ }
const live = { t0: 0, ops: 0, feed: [], timer: null, seq: 0, filter: 'all', shown: [] };
const FEED_MAX = 80;
