/* ---------- conversazione ---------- */
let unseen = 0;
let runInfo = { title: '' };
// Id del test = chiave del ticket (es. TMTN-4517), ricavata dal titolo dell'esecuzione; vuoto se non c'è.
const ticketId = () => { const m = (runInfo.title || '').match(/\b[A-Z][A-Z0-9_]{1,19}-\d+\b/); return m ? m[0] : ''; };
// Messaggi di fase (in inglese): preparazione -> sviluppo -> sviluppato.
const PHASE_READY = 'ReadyForDeveloper';
const phaseDeveloping = () => 'Developing' + (ticketId() ? ' ' + ticketId() : '');
const phaseDeveloped = () => 'Developed test' + (ticketId() ? ' ' + ticketId() : '');
// Lo sviluppo parte quando inizia l'analisi (pipeline di Aletheia) oppure, con skill del progetto, alla prima modifica di file.
function devStarted(on) {
  if (on) return ['analyzer', 'explorer', 'coder', 'compile', 'validator', 'run'].some((id) => lastSteps[id] === 'running' || lastSteps[id] === 'done');
  return live.feed.some((f) => f.kind === 'edit') || live.feed.length >= 12;
}
const nearBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 160;
function clearLog() { log.replaceChildren(); $('jump').hidden = true; unseen = 0; updateUnseen(); }
// "Nuova esecuzione": azzera conversazione e avanzamento (richiamata anche dalla Dashboard Test)
function emptyState() { btw.items = []; if (typeof btwRender === 'function') btwRender(); clearLog(); runInfo = { title: '' }; live.feed = []; live.ops = 0; live.t0 = 0; live.shown = []; live.filter = 'all'; winReset(); }
function push(e) {
  const stick = nearBottom();
  log.appendChild(e);
  if (stick) log.scrollTop = log.scrollHeight; else $('jump').hidden = false;
}
log.addEventListener('scroll', () => { if (nearBottom()) $('jump').hidden = true; });
$('jump').onclick = () => { log.scrollTop = log.scrollHeight; $('jump').hidden = true; };
log.addEventListener('click', async (e) => {
  const b = e.target.closest && e.target.closest('.cp');
  if (!b) return;
  const text = b.closest('.codebox').querySelector('pre').textContent;
  try { await navigator.clipboard.writeText(text); b.textContent = 'Copiato ✓'; } catch { b.textContent = 'Non copiabile'; }
  setTimeout(() => { b.textContent = 'Copia'; }, 1500);
});
function add(cls, text) {
  if (cls === 'assistant' || cls === 'user') {
    const row = el('div', 'msg ' + cls);
    if (cls === 'assistant') row.append(el('div', 'av'));
    const col = el('div', 'col');
    const who = el('div', 'who'); who.append(el('b', '', cls === 'user' ? 'Tu' : 'Pipeline'), el('span', '', clock()));
    const bubble = el('div', 'bubble');
    if (cls === 'assistant') bubble.innerHTML = md(text); else bubble.textContent = text;
    col.append(who, bubble);
    if (cls === 'user' && text.length > 700) {
      bubble.classList.add('clip');
      const more = el('button', 'more', 'Mostra tutto'); more.type = 'button';
      more.onclick = () => { const open = bubble.classList.toggle('clip'); more.textContent = open ? 'Mostra tutto' : 'Comprimi'; };
      col.append(more);
    }
    row.append(col);
    push(row);
    if (cls === 'assistant') noteUnseen();
    return;
  }
  const p = el('div', 'm ' + cls, text);
  push(p);
}
// Permessi negati: la pipeline è ferma finché non vengono concessi (in modalità -p non esiste un prompt interattivo).
function addDenials(list) {
  const p = el('div', 'm warn');
  p.append(el('div', '', 'Pipeline bloccata: permesso negato per ' + list.length + (list.length === 1 ? ' comando' : ' comandi') + '. Scrivere in chat non lo sblocca.'));
  const ul = el('ul'); for (const x of list) ul.append(el('li', '', x.rule));
  const b = el('button', '', 'Consenti e riprendi'); b.type = 'button';
  b.onclick = async () => { b.disabled = true; if (!(await api('/api/allow', { rules: list.map((x) => x.rule) }))) b.disabled = false; };
  p.append(ul, b);
  push(p);
}
const toolKind = (name) => /^mcp__playwright/.test(name) ? 'web' : /^(Read|Glob|Grep)$/.test(name) ? 'read' : /^(Edit|Write|NotebookEdit)$/.test(name) ? 'edit' : name === 'Bash' ? 'cmd' : /^(Agent|Task|Skill)$/.test(name) ? 'agent' : 'misc';
// Le chiamate ai tool consecutive vengono raggruppate in un solo blocco espandibile, con lo step a cui appartengono.
function addTool(d) {
  let g = log.lastElementChild;
  if (!g || !g.classList.contains('group')) {
    g = el('details', 'group');
    const s = el('summary'); s.append(el('span', 'gi'), el('span', 'gt'), el('span', 'gs'));
    g.append(s, el('div', 'glist'));
    g.dataset.n = '0';
    push(g);
  }
  g.dataset.n = String(Number(g.dataset.n) + 1);
  if (d.label && d.label !== d.name) g.dataset.step = d.label.replace(/^\d+\s*/, '');
  g.querySelector('.gt').textContent = g.dataset.n + (g.dataset.n === '1' ? ' operazione' : ' operazioni');
  g.querySelector('.gs').textContent = g.dataset.step ? '· ' + g.dataset.step : '';
  const line = el('span', 'k-' + toolKind(d.name));
  line.append(el('b', '', d.name), el('em', '', d.detail || ''));
  g.querySelector('.glist').appendChild(line);
  if (d.id) toolLines.set(d.id, line);
  if (nearBottom()) log.scrollTop = log.scrollHeight;
}
function noteUnseen() { if (!$('pane-live').hidden) { unseen++; updateUnseen(); } }
function updateUnseen() { const u = $('lv-unseen'); u.hidden = !unseen; u.textContent = unseen; }

