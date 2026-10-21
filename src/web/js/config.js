/* ---------- accesso a Claude dalla UI ---------- */
// Pulsante che avvia `claude auth login` (si apre il browser), segue l'esito e poi chiama onDone.
function loginButton(onDone) {
  const wrap = mk('span'); wrap.style.cssText = 'display:inline-flex;gap:8px;align-items:center;flex-wrap:wrap';
  const b = mk('button', 'sm primary', 'Accedi a Claude'); b.type = 'button'; b.style.flex = 'none';
  const note = mk('small', ''); note.style.color = 'var(--muted)';
  let timer = null;
  const stop = () => { if (timer) clearInterval(timer); timer = null; };
  const poll = () => {
    timer = setInterval(async () => {
      try {
        const s = await call('/api/claude/login');
        if (s.state === 'running') {
          note.replaceChildren(document.createTextNode('Completa l\'accesso nel browser… '));
          if (s.url) { const a = mk('a', '', 'apri il link'); a.href = s.url; a.target = '_blank'; a.rel = 'noopener'; note.append(a); }
        } else if (s.state === 'done') {
          stop(); b.disabled = false; note.textContent = 'Accesso eseguito.'; toast('Accesso a Claude eseguito'); onDone && onDone();
        } else if (s.state === 'failed') {
          stop(); b.disabled = false; note.textContent = s.error || 'Accesso non riuscito.';
        } else { stop(); b.disabled = false; note.textContent = ''; }
      } catch { /* server momentaneamente non raggiungibile: riprova al prossimo giro */ }
    }, 1500);
  };
  b.onclick = async () => {
    b.disabled = true; note.textContent = 'Avvio l\'accesso…';
    try { await call('/api/claude/login', {}); poll(); } catch (e) { b.disabled = false; note.textContent = e.message; }
  };
  wrap.append(b, note);
  return wrap;
}

/* ---------- diagnostica ---------- */
async function runDiag() {
  const list = $('diag-list'), btn = $('diag-run');
  btn.disabled = true; btn.textContent = 'Controllo…';
  list.replaceChildren(nxLoader("Controllo l'ambiente…", 'Claude, login, Maven, Java e Git: qualche secondo'));
  try {
    const rows = await call('/api/diagnostics');
    list.replaceChildren(...rows.map((c) => {
      const it = mk('div', 'item ' + c.status);
      const main = mk('div', 'main');
      main.append(mk('b', '', c.label), mk('small', '', c.detail));
      if (c.hint) main.append(mk('small', 'hint', c.hint));
      if (c.id === 'auth' && c.status === 'fail') main.append(loginButton(runDiag));
      it.append(mk('span', 'sd ' + c.status), main);
      return it;
    }));
    const n = (s) => rows.filter((r) => r.status === s).length;
    $('diag-sum').replaceChildren(...[['ok', n('ok')], ['warn', n('warn')], ['fail', n('fail')]].filter(([, v]) => v).map(([k, v]) => mk('span', 'chip ' + k, v + ' ' + ({ ok: 'ok', warn: 'da vedere', fail: 'errori' })[k])));
  } catch (e) {
    list.replaceChildren(mk('div', 'item fail', 'Diagnostica non disponibile: ' + e.message));
  } finally { btn.disabled = false; btn.textContent = 'Ricontrolla'; }
}
$('diag-run').onclick = runDiag;

/* ---------- permessi ---------- */
const perm = { saved: [], draft: [], local: [], preset: [] };
const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
function renderPerm() {
  const rows = perm.draft.map((r, i) => {
    const it = mk('div', 'item rule');
    const x = mk('button', 'sm danger', 'Rimuovi');
    x.type = 'button';
    x.onclick = () => { perm.draft.splice(i, 1); renderPerm(); };
    const c = mk('code', '', r); c.title = r;
    it.append(c, x);
    return it;
  });
  if (!rows.length) rows.push(mk('div', 'item', 'Nessuna regola in settings.json.'));
  for (const r of perm.local) {
    const it = mk('div', 'item rule ro');
    const c = mk('code', '', r); c.title = r;
    it.append(c, mk('span', 'tag', 'settings.local.json · sola lettura'));
    rows.push(it);
  }
  $('perm-list').replaceChildren(...rows);
  const dirty = !sameList(perm.draft, perm.saved);
  $('perm-dirty').hidden = !dirty;
  $('perm-save').disabled = !dirty;
  const missing = perm.preset.filter((r) => !perm.draft.includes(r) && !perm.local.includes(r));
  $('perm-preset').disabled = !missing.length;
  $('perm-note').textContent = missing.length
    ? 'Preset implementTest: mancano ' + missing.length + ' regole (' + missing.join(', ') + ').'
    : 'Il preset implementTest è completamente coperto.';
}
function addRule() {
  const v = $('perm-new').value.trim();
  if (!v) return;
  if (!/^[A-Za-z][\w-]*(__\*)?(\([^\r\n]{1,300}\))?$/.test(v)) { toast('Formato non valido. Esempi: Bash(mvn test:*) · mcp__playwright · mcp__oracle-readonly__oracle_query_readonly', true); return; }
  if (!perm.draft.includes(v)) perm.draft.push(v);
  $('perm-new').value = '';
  renderPerm();
}
$('perm-add').onclick = addRule;
$('perm-new').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addRule(); } });
$('perm-preset').onclick = () => {
  for (const r of perm.preset) if (!perm.draft.includes(r) && !perm.local.includes(r)) perm.draft.push(r);
  renderPerm();
};
$('perm-save').onclick = async () => {
  $('perm-save').disabled = true;
  try {
    const j = await call('/api/config/permissions', { allow: perm.draft });
    perm.saved = j.allow.slice(); perm.draft = j.allow.slice();
    renderPerm();
    toast('Permessi salvati in .claude/settings.json');
    runDiag();
  } catch (e) { toast(e.message, true); renderPerm(); }
};
window.addEventListener('beforeunload', (e) => { if (!sameList(perm.draft, perm.saved)) { e.preventDefault(); e.returnValue = ''; } });

/* ---------- profilo ---------- */
const PROF_SEC = {
  'Ticket source (adapter)': 'Da dove arrivano i ticket',
  'Build & run': 'Compilazione ed esecuzione dei test',
  'Framework e layout test': 'Struttura del progetto di test',
  'Ambiente ed esplorazione': 'Applicazione da testare',
  'Git': 'Git e branch',
  'Regole di progetto': 'Regole di progetto',
};
// Nome comprensibile, spiegazione ed esempio per le voci del profilo. Le voci non elencate (progetti con profili personalizzati) mostrano la chiave tecnica.
const PROF = {
  ticket_source: { label: 'Dove si trovano i ticket', help: 'Uno tra: jira, azure-devops, file (ticket salvati in una cartella) o paste (li incolli tu in chat). Se non sai, lascia paste.', ex: 'jira' },
  ticket_id_pattern: { label: 'Formato della chiave del ticket', help: 'Come si scrive l\'identificativo di un ticket: serve a riconoscerlo quando lo scrivi o lo incolli.', ex: 'ABC-123' },
  ticket_contract_field: { label: 'Campo del ticket con le istruzioni del test', help: 'Il campo del ticket che descrive cosa va verificato. Di solito è la descrizione.', ex: 'description' },
  ticket_group_field: { label: 'Campo per raggruppare i test (facoltativo)', help: 'Se i ticket sono divisi per area o stream, indica il campo: serve a scegliere in quale cartella e suite mettere il test. Puoi lasciarlo com\'è.', ex: 'Stream' },
  attachments: { label: 'Scarica gli allegati del ticket', help: 'Se "sì", gli allegati vengono salvati in una cartella temporanea del progetto per poterli leggere.', ex: 'sì' },
  ticket_transition_on_pass: { label: 'Sposta il ticket a fine test', help: '"no" lascia il ticket com\'è. Se scrivi uno stato (es. Done) il ticket viene spostato lì quando il test passa, sempre dopo la tua conferma.', ex: 'no' },
  language: { label: 'Linguaggio e versione', help: 'Versione di Java usata dal progetto. Deve corrispondere al JDK scelto nella scheda Progetto.', ex: 'Java 11' },
  build_tool: { label: 'Strumento di compilazione', help: 'Di norma Maven. Cambialo solo se il progetto usa altro.', ex: 'Maven' },
  compile_cmd: { label: 'Comando per compilare', help: 'Il comando che controlla che il codice compili, senza lanciare i test.', ex: 'mvn -q test-compile' },
  run_cmd: { label: 'Comando per eseguire un test', help: 'Come si lancia una suite di test. È già impostato per il tuo progetto: modificalo solo se sai cosa stai facendo.' },
  test_runner: { label: 'Libreria dei test', help: 'Il framework che esegue i test. Informativa: non serve toccarla.' },
  private_repos: { label: 'Dove si scarica il framework', help: 'Il framework di test (Aletheia) viene scaricato da GitHub: serve il token configurato in fase di creazione del progetto. Informativa.' },
  shared_library: { label: 'Libreria condivisa del team', help: 'Codice comune ai progetti. Claude lo legge ma non lo modifica mai senza il tuo permesso.' },
  test_root: { label: 'Cartella dei test', help: 'Dove vengono salvati i file dei test. È già compilata alla creazione del progetto.' },
  page_pkg: { label: 'Package delle pagine (Page Object)', help: 'Dove stanno le classi che descrivono le pagine dell\'applicazione (campi e pulsanti).' },
  actions_pkg: { label: 'Package delle azioni', help: 'Dove stanno le classi con i passi riutilizzabili (es. "accedi", "cerca").' },
  base_class: { label: 'Classe base dei test', help: 'La classe da cui derivano tutti i test del progetto.' },
  suite_dir: { label: 'Cartella delle suite', help: 'Dove stanno i file XML che raggruppano i test da eseguire insieme.', ex: 'TestSuites/' },
  naming: { label: 'Regole sui nomi dei file', help: 'Come si chiamano test, pagine e azioni. Claude le segue quando crea un nuovo test.' },
  login_block: { label: 'Come si fa il login nei test', help: 'Se tutti i test iniziano con lo stesso login, scrivi qui quel blocco di codice o come si chiama: Claude lo riuserà così com\'è. Se non c\'è login, scrivi "nessuno".', ex: 'LoginActions.loginAs(user)' },
  title_rule: { label: 'Titolo del test', help: 'Il titolo del test è il titolo del ticket, identico: non tradotto e non accorciato.' },
  waits: { label: 'Attese', help: 'Si usano le attese del framework, mai pause fisse (Thread.sleep).' },
  target_type: { label: 'Tipo di applicazione', help: 'Di norma "web".', ex: 'web' },
  explore_tool: { label: 'Strumento per esplorare l\'applicazione', help: 'Il browser automatico con cui Claude guarda l\'applicazione prima di scrivere il test.' },
  base_url_source: { label: 'Dove si legge l\'indirizzo dell\'applicazione', help: 'Il file in cui è scritto l\'indirizzo web di ogni ambiente. Lo compila il wizard di creazione.' },
  credentials_source: { label: 'Dove si trovano le credenziali', help: 'Utente e password per il login stanno nel file .env, mai scritti qui né in chat.' },
  environment: { label: 'Ambiente su cui testare', help: 'Il nome dell\'ambiente usato di default (es. DEV, UAT). Mai produzione.', ex: 'DEV' },
  mutating_actions_allowed: { label: 'Azioni che modificano i dati', help: '"no" = salvare, confermare, eliminare o importare solo dopo la tua conferma esplicita.', ex: 'no' },
  locator_priority: { label: 'Come si individuano gli elementi in pagina', help: 'L\'ordine di preferenza con cui Claude sceglie come trovare pulsanti e campi (dal più stabile al meno).' },
  branching: { label: 'Lavori su un branch per ogni ticket?', help: 'Scrivi "sì" se per ogni ticket si crea un branch dedicato, "no" se si lavora sempre sullo stesso.', ex: 'sì' },
  base_branch: { label: 'Branch di partenza', help: 'Il branch da cui nascono i nuovi branch (di solito quello principale).', ex: 'main' },
  branch_pattern: { label: 'Come si chiamano i branch dei ticket', help: 'Lo schema del nome. Compilalo solo se lavori con un branch per ticket; <ticket> viene sostituito dalla chiave.', ex: 'feature/<ticket>' },
};
function renderProfile(p) {
  const list = $('prof-list');
  if (!p.exists) { list.replaceChildren(mk('div', 'item fail', 'project-profile.md non trovato.')); $('prof-sum').replaceChildren(); return; }
  const out = [];
  const rows = [];
  const heads = [];
  let only = false;
  const tools = mk('div', 'proftools');
  const tl = mk('label'); const tc = mk('input'); tc.type = 'checkbox';
  tl.append(tc, 'Mostra solo le voci da compilare');
  tools.append(tl);
  const applyFilter = () => {
    for (const r of rows) r.row.classList.toggle('hide', only && !r.e.tbd);
    for (const h of heads) h.el.classList.toggle('hide', only && !h.rows.some((r) => r.e.tbd));
  };
  tc.onchange = () => { only = tc.checked; applyFilter(); };
  out.push(tools);
  let sec = null, cur = null;
  for (const e of p.entries) {
    if (e.section !== sec) {
      sec = e.section;
      const name = sec.replace(/^\d+\.\s*/, '');
      const el = mk('div', 'subhead', PROF_SEC[name] || name);
      cur = { el, rows: [] }; heads.push(cur); out.push(el);
    }
    const info = PROF[e.key] || {};
    const row = mk('div', 'kv' + (e.tbd ? ' tbd' : ''));
    const inp = mk('input'); inp.value = e.tbd ? '' : e.value; inp.placeholder = e.tbd ? (info.ex ? 'Da compilare, es. ' + info.ex : 'Da compilare') : ''; inp.spellcheck = false; inp.setAttribute('aria-label', info.label || e.key);
    const btn = mk('button', 'sm', 'Salva'); btn.type = 'button'; btn.disabled = true;
    inp.oninput = () => { btn.disabled = !inp.value.trim() || inp.value.trim() === e.value; };
    const save = async () => {
      if (btn.disabled) return;
      btn.disabled = true;
      try {
        const j = await call('/api/config/profile', { key: e.key, value: inp.value });
        e.value = j.value; e.tbd = j.value.startsWith('TBD'); inp.value = e.tbd ? '' : j.value;
        row.classList.toggle('tbd', e.tbd);
        toast((info.label || e.key) + ' aggiornato');
        updateProfSum(p); applyFilter();
      } catch (err) { toast(err.message, true); btn.disabled = false; }
    };
    btn.onclick = save;
    inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); save(); } });
    const head = mk('span', 'k');
    head.append(mk('b', '', info.label || e.key));
    if (info.label) head.append(mk('small', 'mono', e.key));
    const tag = chip('warn', 'da compilare'); tag.classList.add('tbdtag'); head.append(tag);
    row.append(head, inp, btn);
    if (info.help) row.append(mk('div', 'kh', info.help + (info.ex ? ' Esempio: ' + info.ex : '')));
    const r = { row, e }; rows.push(r); cur.rows.push(r);
    out.push(row);
  }
  list.replaceChildren(...out);
  updateProfSum(p);
  const rc = p.entries.find((e) => e.key === 'run_cmd');
  $('cfg-runcmd').value = rc ? rc.value : '';
}
function updateProfSum(p) {
  const n = p.entries.filter((e) => e.tbd).length;
  $('prof-sum').replaceChildren(mk('span', 'chip ' + (n ? 'warn' : 'ok'), n ? n + (n === 1 ? ' voce da compilare' : ' voci da compilare') : 'completo'));
}

async function loadConfig() {
  try {
    const c = await call('/api/config');
    if (c.permissions.error) toast('settings.json non è JSON valido: correggilo a mano.', true);
    if (sameList(perm.draft, perm.saved)) { perm.draft = c.permissions.allow.slice(); }
    perm.saved = c.permissions.allow.slice();
    perm.local = c.permissions.local; perm.preset = c.preset;
    renderPerm();
    renderProfile(c.profile);
  } catch (e) { toast('Configurazione non caricata: ' + e.message, true); }
}

/* ---------- permission mode predefinita ---------- */
$('cfg-port').textContent = location.port || '80';
{
}

/* ---------- menu laterale ---------- */
{
  const side = $('side');
  if (store.get('sideCollapsed') === '1') side.classList.add('collapsed');
  $('side-toggle').onclick = () => { side.classList.toggle('collapsed'); store.set('sideCollapsed', side.classList.contains('collapsed') ? '1' : '0'); };
}

/* ---------- chiusura della UI ---------- */
$('quit').onclick = async () => {
  const active = lastStatus === 'running' || lastStatus === 'waiting';
  if (!(await askConfirm(active ? 'È in corso una sessione: verrà terminata e la UI si chiuderà. Continuare?' : 'Chiudere la UI?', { title: 'Chiudi la UI', ok: 'Chiudi', danger: active }))) return;
  try { await call('/api/shutdown', {}); } catch { /* il server può chiudersi prima di rispondere */ }
  if (evtSrc) evtSrc.close();
  document.title = 'UI chiusa';
  document.body.replaceChildren(Object.assign(document.createElement('div'), {
    textContent: 'La UI è stata chiusa. Per riaprirla avvia di nuovo NexsoftAutomationCockpit.exe. Puoi chiudere questa scheda.',
    style: 'margin:auto;padding:24px;text-align:center;color:#6a7280;font:15px "Segoe UI",system-ui,sans-serif',
  }));
  window.close();
};

