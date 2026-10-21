/* ---------- progetto attivo e wizard ---------- */
// (proj è dichiarato in testa allo script: serve già all'avvio)
const chip = (k, t) => mk('span', 'chip ' + k, t);
const gotoTab = (t) => {
  // La Dashboard Test ha senso solo con un progetto agganciato: senza, si va alla scheda Progetto (se lo stato non è ancora noto si lascia passare).
  if (t === 'dash' && proj.info && !proj.info.attached) { toast('La Dashboard Test richiede un progetto agganciato: aggancia prima un progetto.', true); t = 'project'; }
  document.querySelector('nav button[data-tab="' + t + '"]').click();
};

// Stato del progetto agganciato: cosa c'è, cosa manca. Alimenta header, sidebar, scheda Progetto e blocco di Avvia.
async function loadProject() {
  try { proj.info = await call('/api/project'); } catch (e) { toast('Progetto non leggibile: ' + e.message, true); return; }
  proj.insp = null;
  if (proj.info.attached) {
    try { proj.insp = await call('/api/project/inspect'); } catch (e) { toast('Controllo del progetto non riuscito: ' + e.message, true); }
  }
  proj.env = null;
  proj.git = null;
  if (proj.info.attached) { try { proj.git = await call('/api/git/status'); } catch { /* repo non leggibile: la sidebar non mostra il branch */ } }
  renderProject();
  if (proj.info.attached) {
    // strumenti del computer (Claude CLI, login, Maven, Java): più lenti, arrivano dopo
    const my = ++projEnvToken;
    call('/api/diagnostics').then((rows) => {
      if (my !== projEnvToken) return;
      proj.env = rows.filter((r) => ['claude', 'auth', 'mvn', 'java', 'm2'].includes(r.id));
      renderProject();
    }).catch(() => { /* la scheda Configurazione mostra l'errore completo */ });
  }
}
let projEnvToken = 0;
// Intestazione del menu: nome del progetto agganciato, altrimenti il nome della piattaforma.
function updateBrand(i) {
  const name = i && i.attached ? i.name : '';
  $('brand-name').textContent = name || 'NACP';
  $('brand-sub').textContent = name ? 'NACP · progetto agganciato' : 'Nexsoft Automation Cockpit Platform';
  $('brand-name').title = name ? (i.root || name) : 'Nexsoft Automation Cockpit Platform';
}
function renderProject() {
  const i = proj.info, s = proj.insp;
  if (!i) return;
  updateBrand(i);
  const attached = i.attached;
  // Senza un progetto agganciato la Dashboard Test non si mostra (né la scorciatoia nella scheda Esecuzione).
  document.querySelector('nav button[data-tab="dash"]').hidden = !attached;
  if (attached) refreshMcpNav(); else { MCPV.key = null; MCPV.servers = []; document.querySelectorAll('nav button.mcpnav').forEach((x) => x.remove()); }
  $('goto-dash').hidden = !attached;
  if (!attached && curTab === 'dash') gotoTab('project');
  const envFail = proj.env ? proj.env.filter((r) => r.status === 'fail') : [];
  projOk = !!(attached && s && s.ready && !envFail.length);
  if (!$('view-dash').hidden && dt.items.length) renderDash(); // la Dashboard può essere stata disegnata prima che lo stato del progetto fosse noto
  const warns = s ? s.items.filter((x) => x.status === 'warn').length : 0;
  const state = !attached ? 'none' : !s ? 'unknown' : (!s.ready || envFail.length) ? 'fail' : (warns || (proj.env && proj.env.some((r) => r.status === 'warn'))) ? 'warn' : 'ok';
  const stateText = { none: 'Nessun progetto agganciato', unknown: 'Stato non letto', fail: 'Da preparare', warn: 'Pronto, con avvisi', ok: 'Pronto' }[state];

  const c = $('projchip');
  c.hidden = false; c.className = 'pill projchip ' + state; c.style.cursor = 'pointer';
  c.textContent = attached ? i.name : 'Nessun progetto'; c.title = (attached ? i.root + ' · ' : '') + stateText + ' · clic per gestire';
  c.onclick = () => gotoTab('project');

  // sidebar della scheda Esecuzione
  const box = $('projbox-body');
  const rows = [];
  if (attached) {
    rows.push(mk('b', '', i.name), mk('span', 'mono pth', i.root));
    if (proj.git && proj.git.isRepo) {
      const gb = mk('div', 'sum');
      gb.append(chip(PROTECTED.includes(proj.git.branch) || proj.git.branch === proj.git.baseBranch ? 'warn' : 'ok', 'branch: ' + (proj.git.branch || 'HEAD staccato')));
      rows.push(gb);
    }
    const st = mk('div', 'sum'); st.append(chip(state === 'fail' ? 'fail' : state === 'ok' ? 'ok' : 'warn', stateText));
    rows.push(st);
    if (state === 'fail') rows.push(mk('small', 'hint2', envFail.length ? 'Avvia è bloccato: ' + envFail.map((r) => r.label).join(', ') + ' (vedi scheda Progetto).' : 'Avvia è bloccato: apri Progetto e premi "Prepara il progetto".'));
    const b = mk('button', 'sm', state === 'fail' ? 'Prepara il progetto' : 'Cambia progetto'); b.type = 'button'; b.onclick = () => gotoTab('project');
    rows.push(b);
  } else {
    rows.push(mk('b', '', 'Nessun progetto agganciato'), mk('small', 'hint2', 'Per sviluppare un test devi agganciare un progetto: la pipeline lavora nella sua cartella.'));
    const b = mk('button', 'sm primary', 'Aggancia un progetto'); b.type = 'button'; b.style.flex = 'none'; b.onclick = () => gotoTab('project');
    rows.push(b);
  }
  box.replaceChildren(...rows);
  const active = lastStatus === 'running' || lastStatus === 'waiting';
  $('start').disabled = active || !projOk || !can('run');
  $('start').title = !can('run') ? 'Il tuo profilo non consente di lanciare la pipeline' : projOk ? '' : 'Aggancia e prepara un progetto dalla scheda Progetto';

  // scheda Progetto
  $('proj-name').textContent = attached ? i.name : 'Nessun progetto agganciato';
  $('proj-path').textContent = attached ? i.root : 'Aggancia la cartella di un progetto esistente oppure creane uno nuovo.';
  $('proj-path').classList.toggle('mono', attached);
  $('proj-flags').replaceChildren(...(attached ? [chip(state === 'fail' ? 'fail' : state === 'ok' ? 'ok' : 'warn', stateText)] : []));
  $('attach-label').textContent = attached ? 'Percorso della cartella del progetto (cambia progetto)' : 'Percorso della cartella del progetto';
  const rpar = $('repo-parent');
  if (!rpar.value && i.workspace) rpar.value = i.workspace;
  const rc = $('recent');
  const recents = i.recent || [];
  rc.hidden = !recents.length;
  rc.replaceChildren(...(recents.length ? [mk('span', '', 'Recenti:'), ...recents.map((d) => {
    const b = mk('button', 'sm', d.split(/[\\/]/).pop()); b.type = 'button'; b.title = d;
    b.onclick = () => attachProject(d);
    return b;
  })] : []));
  $('sec-inspect').hidden = !attached || !s;
  renderPipeCard(); updateCmdPreview();
  renderSteps(lastSteps); paintLive(); // gli step di Aletheia compaiono solo se il progetto usa i suoi agent
  if (attached && s) {
    const parts = [mk('div', 'subhead', 'Nel progetto'), diagRows(s.items), mk('div', 'subhead', 'Sul computer')];
    parts.push(proj.env ? diagRows(proj.env) : nxLoader("Controllo l'ambiente…", 'Claude, login, Maven e Java'));
    $('insp-list').replaceChildren(...parts);
    $('insp-prepare').hidden = !s.fixable;
  }
}
