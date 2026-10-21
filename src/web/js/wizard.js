/* --- diagnostica a righe, riusata dai passi --- */
function diagRows(rows) {
  const l = mk('div', 'list');
  l.append(...rows.map((c) => {
    const it = mk('div', 'item ' + c.status);
    const main = mk('div', 'main');
    main.append(mk('b', '', c.label), mk('small', '', c.detail));
    if (c.hint) main.append(mk('small', 'hint', c.hint));
    if (c.id === 'auth' && c.status === 'fail') main.append(loginButton(() => renderWiz()));
    it.append(mk('span', 'sd ' + c.status), main);
    return it;
  }));
  return l;
}

async function planFiles(payload) {
  const r = await call('/api/project/plan', payload);
  const kit = r.files.filter((f) => f.path.startsWith('.claude/agents/') || f.path.startsWith('.claude/skills/'));
  const rest = r.files.filter((f) => !kit.includes(f));
  const list = mk('div', 'list');
  for (const f of rest) {
    const it = mk('div', 'item');
    const m = mk('div', 'main');
    m.append(mk('code', '', f.path));
    if (f.secret) m.append(mk('small', '', 'Contiene le credenziali: resta solo in locale, escluso da git.'));
    it.append(m, f.exists ? mk('span', 'tag', 'già presente · non toccato') : chip('ok', 'nuovo'));
    list.append(it);
  }
  const kn = kit.filter((f) => !f.exists).length;
  const it = mk('div', 'item');
  const m = mk('div', 'main');
  m.append(mk('b', '', 'Kit della pipeline (.claude/agents e skills)'), mk('small', '', kit.length + ' file, di cui ' + kn + ' da creare'));
  it.append(m, kn ? chip('ok', 'nuovo') : mk('span', 'tag', 'già presente'));
  list.append(it);
  return { dir: r.dir, list, newCount: r.files.filter((f) => !f.exists).length };
}

/* --- passi: nuovo progetto --- */
const STEP = { new: [], existing: [] };

STEP.new[0] = async (body, tk) => {
  const d = wz.d;
  body.append(callout('', mk('b', '', 'Il computer è pronto? '), 'Controllo gli strumenti necessari e l\'accesso al framework di test. Se qualcosa è rosso, segui il suggerimento e premi "Ricontrolla".'));
  const holder = mk('div'); holder.append(nxLoader('Verifica del computer…', 'Controllo gli strumenti necessari'));
  const tokenBox = mk('div'); tokenBox.style.marginTop = '18px';
  const why = mk('small', 'hint2'); why.style.cssText = 'display:block;color:var(--muted);font-size:12px;margin-top:12px';
  body.append(holder, tokenBox, why);
  const again = mk('button', 'sm', 'Ricontrolla'); again.type = 'button'; again.onclick = () => renderWiz();
  setNav({ busy: true });
  let blockers = [];
  const hasToken = () => d.tokenOk || !!(proj.info && proj.info.m2 && proj.info.m2.hasGithub);
  const update = () => {
    const missing = [];
    if (blockers.length) missing.push('risolvi gli elementi in rosso (' + blockers.map((b) => b.label).join(', ') + ')');
    if (!hasToken() && !d.skipToken) missing.push('configura l\'accesso a GitHub oppure scegli "Lo faccio dopo"');
    why.textContent = missing.length ? 'Per continuare: ' + missing.join(' · ') + '.' : '';
    setNav({ next: { label: 'Continua', disabled: !!missing.length, go: () => true } });
  };
  const renderToken = () => {
    tokenBox.replaceChildren(mk('div', 'subhead', 'Accesso al framework (GitHub)'));
    if (hasToken()) { tokenBox.append(callout('ok', 'L\'accesso a GitHub è già configurato su questo computer (~/.m2/settings.xml). Non devi fare nulla.')); return; }
    const ol = mk('ol');
    [
      'Apri GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token.',
      'Spunta il permesso read:packages. Se la tua organizzazione usa il Single Sign-On, autorizza il token per l\'organizzazione.',
      'Copia il token (si vede una sola volta) e incollalo qui sotto.',
    ].forEach((t) => ol.append(mk('li', '', t)));
    tokenBox.append(callout('', mk('b', '', 'A cosa serve: '), 'il progetto scarica il framework di test (Aletheia) da GitHub, e GitHub chiede un token personale per sapere chi sei.', ol));
    const a = mk('a', '', 'Apri la pagina dei token su GitHub'); a.href = 'https://github.com/settings/tokens'; a.target = '_blank'; a.rel = 'noopener';
    const linkP = mk('p'); linkP.append(a);
    const two = mk('div', 'fld two');
    two.append(fld('Username GitHub', inp(d.ghUser, '', null, (v) => { d.ghUser = v; })), fld('Token', inp(d.ghToken, 'ghp_…', 'password', (v) => { d.ghToken = v; })));
    const save = mk('button', 'primary', 'Salva il token'); save.type = 'button'; save.style.flex = 'none';
    save.onclick = async () => {
      save.disabled = true;
      try {
        const r = await call('/api/m2/token', { username: d.ghUser, token: d.ghToken });
        d.tokenOk = true; d.ghToken = '';
        toast('Token ' + r.action + ' in ~/.m2/settings.xml');
        renderToken(); update();
      } catch (e) { toast(e.message, true); save.disabled = false; }
    };
    const skip = mk('button', 'sm', d.skipToken ? 'Lo faccio dopo ✓ (annulla)' : 'Lo faccio dopo'); skip.type = 'button';
    skip.onclick = () => { d.skipToken = !d.skipToken; renderToken(); update(); };
    const acts = mk('div', 'row'); acts.style.marginTop = '4px'; acts.append(save, skip);
    tokenBox.append(linkP, two, acts);
    if (d.skipToken) tokenBox.append(callout('warn', 'Senza token la compilazione finale non potrà riuscire. Potrai configurarlo più avanti.'));
  };
  try {
    const [all] = await Promise.all([call('/api/diagnostics'), loadProject()]);
    if (tk !== wz.token) return;
    const rows = all.filter((r) => ['node', 'claude', 'auth', 'mvn', 'java', 'm2', 'git'].includes(r.id));
    holder.replaceChildren(diagRows(rows));
    blockers = rows.filter((r) => r.status === 'fail');
    if (blockers.length) holder.append(again);
    renderToken(); update();
  } catch (e) { holder.replaceChildren(callout('err', 'Diagnostica non disponibile: ' + e.message)); setNav({}); }
};

STEP.new[1] = (body) => {
  const d = wz.d;
  body.append(callout('', 'Bastano pochi dati. I campi con * sono obbligatori; il resto si può lasciare com\'è e cambiare dopo.'));
  const errEl = () => { const s = mk('small'); s.style.cssText = 'display:block;color:var(--err);font-size:12px;margin-top:4px'; return s; };
  let shown = false;
  const checks = [];
  const watch = (el, fn) => { checks.push({ el, fn }); return el; };
  const showErrs = () => { shown = true; for (const c of checks) c.el.textContent = c.fn(); };
  const live = () => { if (shown) showErrs(); };

  const preview = mk('span', 'mono');
  const refresh = () => { preview.textContent = targetDir() || '—'; };
  const nameMsg = () => (/^[A-Za-z][A-Za-z0-9 _-]{1,40}$/.test(d.name.trim()) ? '' : 'Il nome deve iniziare con una lettera e avere da 2 a 41 caratteri (lettere, numeri, spazi, - e _).');
  const nameErr = watch(errEl(), nameMsg);
  const nameF = fld('Nome del progetto *', inp(d.name, 'es. Acme Portal', null, (v) => { d.name = v; refresh(); live(); }), 'Come lo chiami tu. Diventa il nome della cartella e del package Java.');
  nameF.append(nameErr);
  body.append(nameF);

  const parent = inp(d.parent, 'C:\\Users\\nome\\IdeaProjects', null, (v) => { d.parent = v.trim(); refresh(); live(); });
  const browse = mk('button', '', 'Sfoglia…'); browse.type = 'button';
  browse.onclick = async () => {
    toast('Scegli la cartella nella finestra di Windows (può essere dietro al browser).');
    try { const { dir } = await call('/api/project/pick-folder', {}); if (dir) { d.parent = dir; parent.value = dir; refresh(); live(); } } catch (e) { toast(e.message, true); }
  };
  const prow = mk('div', 'row'); prow.append(parent, browse);
  const pf = fld('In quale cartella lo creo? *', prow, 'La cartella che contiene i tuoi progetti: ne verrà creata una nuova al suo interno.');
  const pv = mk('small', 'hint2'); pv.append('Verrà creato in: ', preview); pf.append(pv, watch(errEl(), () => (d.parent ? '' : 'Scegli la cartella in cui creare il progetto.')));
  body.append(pf);

  const envBox = mk('div');
  const envMsg = (e) => (!/^[A-Za-z0-9_-]{1,30}$/.test(e.name) ? 'Nome ambiente non valido (lettere, numeri, - e _; es. DEV).' : !/^https?:\/\/\S+$/.test(e.url) ? 'L\'indirizzo di "' + e.name + '" deve iniziare con http:// o https://' : '');
  const renderEnvs = () => {
    envBox.replaceChildren(...d.envs.map((e, i) => {
      const r = mk('div', 'envrow');
      const rm = mk('button', 'sm danger', 'Rimuovi'); rm.type = 'button'; rm.disabled = d.envs.length === 1;
      rm.onclick = () => { d.envs.splice(i, 1); renderEnvs(); live(); };
      r.append(inp(e.name, 'Nome (es. DEV)', null, (v) => { e.name = v.trim(); live(); }), inp(e.url, 'Indirizzo web, es. https://dev.miosito.it', null, (v) => { e.url = v.trim(); live(); }), rm);
      return r;
    }));
  };
  renderEnvs();
  const addEnv = mk('button', 'sm', 'Aggiungi un altro ambiente'); addEnv.type = 'button';
  addEnv.onclick = () => { if (d.envs.length < 10) { d.envs.push({ name: '', url: '' }); renderEnvs(); } };
  const ef = fld('Applicazione da testare *', envBox, 'Un "ambiente" è una copia dell\'applicazione (es. DEV = sviluppo, UAT = collaudo). Scrivi un nome e l\'indirizzo web a cui i test devono collegarsi. Ne basta uno: il primo è quello usato di default.');
  ef.append(addEnv, watch(errEl(), () => { for (const e of d.envs) { const m = envMsg(e); if (m) return m; } return ''; }));
  body.append(ef);

  const repoMsg = () => (/^https:\/\/[A-Za-z0-9.-]+(:\d{1,5})?(\/[A-Za-z0-9._~-]+)*\/?$/.test(d.frameworkRepo.trim()) ? '' : 'Indica l\'indirizzo del repository Maven del framework: deve iniziare con https:// (es. https://maven.pkg.github.com/organizzazione/repository).');
  const repoF = fld('Repository Maven del framework *', inp(d.frameworkRepo, 'https://maven.pkg.github.com/organizzazione/repository', null, (v) => { d.frameworkRepo = v.trim(); live(); }), 'Da dove il progetto scarica il framework di test. Te lo fornisce il team che lo gestisce; l\'app lo ricorda per i prossimi progetti.');
  repoF.append(watch(errEl(), repoMsg));
  body.append(repoF);

  const PIPE_RE = /^[a-z][a-z0-9-]{1,40}$/;
  const pipeMsg = () => {
    const pl = d.pipeline;
    if (pl.mode === 'default') return '';
    if (!PIPE_RE.test(pl.name) || pl.name.endsWith('-')) return 'Usa solo minuscole, numeri e trattini, iniziando con una lettera (es. implementa-test).';
    if (['implementtest', 'run-test'].includes(pl.name.toLowerCase())) return '"' + pl.name + '" è riservato alla pipeline predefinita: scegli un altro nome.';
    return '';
  };
  const pipeBox = mk('div', 'fld');
  pipeBox.append(mk('label', '', 'Pipeline di sviluppo *'));
  pipeBox.append(mk('small', 'hint2', 'La pipeline è la sequenza di agent che trasforma un ticket in un test automatico. Puoi usare quella del team, farne una copia da adattare oppure partire da zero.'));
  const pipeName = inp(d.pipeline.name, 'es. implementa-test', null, (v) => { d.pipeline.name = v.trim(); live(); });
  const nameRow = fld('Nome della pipeline *', pipeName, 'Con questo nome la lanci dalla chat (/nome). Minuscole, numeri e trattini.');
  nameRow.append(watch(errEl(), pipeMsg));
  const PIPES = [
    { m: 'default', t: 'Pipeline predefinita (implementTest)', s: 'Quella già usata dal team: dal ticket al test eseguibile con Analyzer, Explorer, Coder e Validator. Consigliata se non hai esigenze particolari.' },
    { m: 'base', t: 'Parti dalla predefinita e adattala', s: 'Ricevi una copia con un nome tuo, da modificare liberamente senza toccare l\'originale.' },
    { m: 'empty', t: 'Crea una pipeline nuova', s: 'Uno scheletro minimo (una skill e un agent) da far crescere: gli step e gli agent li aggiungi tu.' },
  ];
  const syncPipe = () => { nameRow.hidden = d.pipeline.mode === 'default'; live(); };
  for (const o of PIPES) {
    const lab = mk('label'); lab.style.cssText = 'display:flex;gap:10px;align-items:flex-start;padding:10px 12px;margin-top:8px;border:1.5px solid var(--line);border-radius:10px;cursor:pointer;font-weight:400';
    const r = mk('input'); r.type = 'radio'; r.name = 'pipe-mode'; r.style.cssText = 'width:auto;margin-top:3px'; r.checked = d.pipeline.mode === o.m;
    r.onchange = () => { d.pipeline.mode = o.m; syncPipe(); };
    const tx = mk('span'); tx.append(mk('b', '', o.t), mk('small', 'hint2', o.s)); tx.lastChild.style.display = 'block';
    lab.append(r, tx); pipeBox.append(lab);
  }
  pipeBox.append(nameRow);
  body.append(pipeBox);
  syncPipe();

  const opt = mk('details'); opt.style.cssText = 'margin-top:8px';
  const sum = mk('summary', '', 'Opzioni facoltative (puoi saltarle)'); sum.style.cssText = 'cursor:pointer;font-weight:600;margin-bottom:12px';
  opt.append(sum);
  const two = mk('div', 'fld two');
  two.append(
    fld('Utente per il login nell\'applicazione', inp(d.username, '', null, (v) => { d.username = v; })),
    fld('Password per il login nell\'applicazione', inp(d.password, '', 'password', (v) => { d.password = v; })),
  );
  opt.append(two, mk('small', 'hint2', 'Sono le credenziali che i test useranno per entrare nell\'applicazione da testare. Restano solo nel file .env del progetto, escluso da git. Se non le hai a portata di mano le compili dopo.'));
  const icLab = mk('label'); icLab.style.cssText = 'display:flex;gap:8px;align-items:center;margin-top:16px;color:var(--fg);font-size:13px';
  const ic = mk('input'); ic.type = 'checkbox'; ic.style.width = 'auto'; ic.checked = d.initialCommit;
  ic.onchange = () => { d.initialCommit = ic.checked; };
  icLab.append(ic, 'Salva lo stato iniziale con git (consigliato)');
  opt.append(icLab, mk('small', 'hint2', 'Serve per poter creare branch in seguito. Se git non è installato il progetto viene creato lo stesso, senza versioning.'));
  body.append(opt);
  refresh();

  setNav({
    next: {
      label: 'Continua',
      go: () => {
        showErrs();
        const first = checks.find((c) => c.el.textContent);
        if (first) { first.el.scrollIntoView({ behavior: 'smooth', block: 'center' }); throw new Error(first.el.textContent); }
        d.name = d.name.trim();
        return true;
      },
    },
  });
};

STEP.new[2] = async (body, tk) => {
  const d = wz.d;
  if (d.created) {
    body.append(callout('ok', mk('b', '', 'Il progetto è già stato creato '), 'in ', mk('b', 'mono', d.created.dir), '. Non verrà creato di nuovo: continua con la verifica.'));
    setNav({ next: { label: 'Continua', go: () => true } });
    return;
  }
  const msg = mk('div');
  body.append(msg, mk('div', 'item', 'Preparo il riepilogo…'));
  setNav({ busy: true });
  try {
    const p = await planFiles({ mode: 'new', name: d.name, dir: targetDir(), envs: d.envs, username: d.username, password: d.password, pipeline: d.pipeline, frameworkRepo: d.frameworkRepo });
    if (tk !== wz.token) return;
    body.replaceChildren(msg, callout('', 'Questi file verranno creati in ', mk('b', 'mono', p.dir), '. Nessun file esistente viene sovrascritto. Premi "Crea il progetto" per procedere.'), p.list);
    setNav({
      next: {
        label: 'Crea il progetto',
        go: async () => {
          msg.replaceChildren(nxLoader('Creazione del progetto…', 'Non chiudere la pagina'));
          try {
            const r = await call('/api/project/create', { mode: 'new', name: d.name, dir: targetDir(), envs: d.envs, username: d.username, password: d.password, initialCommit: d.initialCommit, pipeline: d.pipeline, frameworkRepo: d.frameworkRepo });
            d.created = r; d.password = '';
            loadProject();
            return true;
          } catch (e) { msg.replaceChildren(callout('err', e.message)); return false; }
        },
      },
    });
  } catch (e) { body.replaceChildren(callout('err', e.message)); setNav({}); }
};

STEP.new[3] = (body) => {
  const d = wz.d;
  const r = d.created;
  body.append(callout('ok', mk('b', '', 'Progetto creato. '), r.created.length + ' file in ', mk('b', 'mono', r.dir), (r.git ? ' · repository git inizializzato su main' : ' · git non disponibile: il progetto è stato creato senza versioning') + (r.initialCommit ? ', commit iniziale creato.' : (r.commitNote ? '. Commit iniziale non creato: ' + r.commitNote + '.' : '.'))));

  body.append(mk('div', 'subhead', 'Verifica che compili (facoltativa, consigliata)'));
  const out = mk('div');
  body.append(callout('', 'Compilo il progetto con Maven per essere sicuri che tutto funzioni. La prima volta può richiedere alcuni minuti perché scarica le dipendenze. ', 'Non apre il browser né esegue test.'), out);
  const go = mk('button', 'primary', d.verified ? 'Ripeti la verifica' : 'Avvia la verifica'); go.type = 'button'; go.style.flex = 'none';
  const showRes = (v) => {
    out.replaceChildren(callout(v.ok ? 'ok' : 'err', mk('b', '', v.ok ? 'Compilazione riuscita. Il progetto è pronto.' : 'Compilazione fallita.'),
      v.hint ? mk('div', '', v.hint) : '', v.output && !v.ok ? mk('pre', '', v.output) : ''));
  };
  go.onclick = async () => {
    go.disabled = true; setNav({ busy: true });
    out.replaceChildren(nxLoader('Compilazione in corso…', 'Può richiedere minuti (scarica le dipendenze): non chiudere la pagina'));
    try { d.verified = await call('/api/project/verify', { dir: d.created.dir }); showRes(d.verified); } catch (e) { out.replaceChildren(callout('err', e.message)); }
    go.disabled = false; go.textContent = 'Ripeti la verifica'; setNav({ next: finish });
  };
  body.append(go);
  if (d.verified) showRes(d.verified);

  const todo = mk('ol');
  const pl = d.pipeline;
  [
    ...(pl.mode === 'default' ? [] : [pl.mode === 'base'
      ? 'La tua pipeline "' + pl.name + '" è una copia della predefinita: adattala dall\'editor (skill in .claude/skills/' + pl.name + ', agent in .claude/agents).'
      : 'La tua pipeline "' + pl.name + '" è uno scheletro: dall\'editor completa la skill e l\'agent ' + pl.name + '-worker, poi aggiungi gli agent e gli step che ti servono.']),
    'Apri la Configurazione e compila le voci del profilo ancora da completare (le trovi evidenziate).',
    'Se usi Jira, collegalo dalla scheda Jira per leggere i ticket.',
    'Dalla Dashboard scegli un ticket e avvia il primo test.',
  ].forEach((t) => todo.append(mk('li', '', t)));
  body.append(mk('div', 'subhead', 'Cosa fare adesso'), callout('', todo));
  if (pl.mode !== 'default') { const ed = mk('button', '', 'Apri l\'editor della pipeline in una nuova scheda'); ed.type = 'button'; ed.onclick = () => window.open('/pipelines.html', 'nx-pipelines'); body.append(ed); }

  const finish = { label: 'Fine: apri la configurazione', final: true, go: () => { document.querySelector('nav button[data-tab="config"]').click(); return true; } };
  setNav({ next: finish });
};

/* --- passi: progetto esistente --- */
STEP.existing[0] = (body) => {
  const d = wz.d;
  body.append(callout('', 'Scegli la cartella del progetto. La pipeline aggiunge solo ciò che manca (profilo, permessi, .mcp.json e kit): il codice non viene toccato e nessun file esistente viene sovrascritto.'));
  const path = inp(d.existingDir, 'C:\\Users\\nome\\IdeaProjects\\progetto', null, (v) => { d.existingDir = v.trim(); });
  const browse = mk('button', '', 'Sfoglia…'); browse.type = 'button';
  browse.onclick = async () => {
    toast('Scegli la cartella nella finestra di Windows (può essere dietro al browser).');
    try { const { dir } = await call('/api/project/pick-folder', {}); if (dir) { d.existingDir = dir; path.value = dir; } } catch (e) { toast(e.message, true); }
  };
  const row = mk('div', 'row'); row.append(path, browse);
  body.append(fld('Cartella del progetto', row));
  setNav({ next: { label: 'Continua', go: () => { if (!d.existingDir) throw new Error('Indica la cartella del progetto.'); return true; } } });
};
STEP.existing[1] = async (body, tk) => {
  const d = wz.d;
  body.append(mk('div', 'item', 'Analizzo il progetto…'));
  setNav({ busy: true });
  try {
    const p = await planFiles({ mode: 'existing', dir: d.existingDir });
    if (tk !== wz.token) return;
    body.replaceChildren(callout('', 'In ', mk('b', 'mono', p.dir), p.newCount ? ' verranno aggiunti questi file:' : ' c\'è già tutto: non serve aggiungere nulla.'), p.list);
    setNav({ next: { label: p.newCount ? 'Applica' : 'Attiva il progetto', go: () => true } });
  } catch (e) { body.replaceChildren(callout('err', e.message)); setNav({}); }
};
STEP.existing[2] = async (body, tk) => {
  const d = wz.d;
  body.append(mk('div', 'item', 'Applico…'));
  setNav({ busy: true });
  try {
    const r = await call('/api/project/create', { mode: 'existing', dir: d.existingDir });
    if (tk !== wz.token) return;
    body.replaceChildren(callout('ok', mk('b', '', 'Fatto. '), r.created.length + ' file aggiunti, ' + r.skipped.length + ' già presenti. Il progetto è ora attivo.'),
      callout('warn', 'Prossimo passo: apri la Configurazione e compila le voci "da compilare" del profilo, poi controlla la diagnostica.'));
    loadProject(); cfgLoaded = false;
    setNav({ next: { label: 'Apri la configurazione', final: true, go: () => { document.querySelector('nav button[data-tab="config"]').click(); return true; } } });
  } catch (e) { body.replaceChildren(callout('err', e.message)); setNav({}); }
};
