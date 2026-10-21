/* ---------- git ---------- */
const gt = { st: null, busy: false };
const PROTECTED = ['main', 'master'];
const fmtWhen = (s) => { const d = new Date(s); return isNaN(d) ? '' : d.toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }); };
async function loadGit() {
  try { gt.st = await call('/api/git/status'); } catch (e) { gt.st = null; $('git-empty').textContent = e.message; }
  renderGit();
}
function gitLog(text, isErr) { const l = $('git-log'); l.textContent = text; l.className = isErr ? 'err' : ''; }
async function gitOp(path, body, confirmMsg, okMsg) {
  if (gt.busy) return false;
  if (confirmMsg && !(await askConfirm(confirmMsg, { title: 'Conferma operazione git', danger: confirmMsg.startsWith('⚠') }))) return false;
  gt.busy = true; renderGit();
  let ok = false;
  try {
    const r = await call(path, body);
    gt.st = r.status;
    gitLog(r.output || 'Fatto.');
    if (r.conflict) toast('Conflitti nel merge: vedi sopra. Puoi annullare il merge.', true);
    else { toast(okMsg || 'Operazione completata'); ok = true; }
  } catch (e) {
    gitLog(e.message, true);
    toast((e.message.split('\n').find((l) => l.trim() && !/^git /.test(l)) || e.message).slice(0, 160), true);
    try { gt.st = await call('/api/git/status'); } catch { /* resta lo stato precedente */ }
  } finally { gt.busy = false; renderGit(); loadProject(); }
  return ok;
}
// Icona e descrizione del codice di stato git (XY): al posto di "??", "M", "A"…
const GIT_ICONS = {
  new: ['Nuovo file', '<path d="M12 5v14M5 12h14"/>'],
  mod: ['Modificato', '<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 013 3L8 19z"/>'],
  del: ['Eliminato', '<path d="M5 12h14"/>'],
  ren: ['Rinominato o spostato', '<path d="M4 12h15M14 7l5 5-5 5"/>'],
  conf: ['Conflitto da risolvere', '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17.5v.1"/>'],
  other: ['Cambiato', '<circle cx="12" cy="12" r="2.5"/>'],
};
// Pulsante "Analizza nel codice": apre il file in IntelliJ.
async function openInIde(rel) {
  try { const r = await call('/api/ide/open', { path: rel }); toast('Aperto in IntelliJ' + (r.ide ? ' (' + r.ide + ')' : '')); }
  catch (e) { toast(e.message, true); }
}
function ideButton(rel) {
  const b = mk('button', 'sm ide-btn'); b.type = 'button'; b.title = 'Apre il file in IntelliJ: ' + rel;
  b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5"/></svg>'; // svg costante
  b.append(document.createTextNode('Analizza nel codice'));
  b.onclick = (ev) => { ev.preventDefault(); ev.stopPropagation(); openInIde(rel); };
  return b;
}
function gitIcon(e) {
  const c = e.code || '';
  const k = /^(U.|.U|AA|DD)/.test(c) ? 'conf'
    : e.untracked || c === '??' || (/A/.test(c) && !/[MD]/.test(c)) ? 'new'
    : /D/.test(c) ? 'del'
    : /R|C/.test(c) ? 'ren'
    : /M|T/.test(c) ? 'mod' : 'other';
  const s = mk('span', 'gi ' + k); s.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + GIT_ICONS[k][1] + '</svg>'; // svg costanti
  return { el: s, label: GIT_ICONS[k][0] };
}
function renderGit() {
  const s = gt.st;
  $('git-empty').hidden = !!s && s.isRepo;
  $('git-body').hidden = !s || !s.isRepo;
  if (!s) return;
  if (!s.isRepo) { $('git-empty').textContent = 'Questa cartella non è un repository git. Inizializzalo da terminale con git init (o crea il progetto dal wizard, che lo fa da solo).'; return; }
  const dis = gt.busy;
  const cur = s.branch;
  const prot = !!cur && (PROTECTED.includes(cur) || cur === s.baseBranch);

  const parts = [mk('span', 'bname', cur || 'HEAD staccato')];
  parts.push(mk('span', 'up', s.upstream ? 'segue ' + s.upstream : 'nessun upstream (non ancora pubblicato)'));
  if (s.ahead) parts.push(chip('warn', s.ahead + ' commit da pubblicare'));
  if (s.behind) parts.push(chip('warn', s.behind + ' commit da scaricare'));
  if (!s.ahead && !s.behind && s.upstream) parts.push(chip('ok', 'allineato al remoto'));
  parts.push(s.changes ? chip('warn', s.changes + ' file modificati') : chip('ok', 'nessuna modifica tracciata'));
  if (s.untracked) parts.push(chip('', s.untracked + ' non tracciati'));
  $('git-state').replaceChildren(...parts);

  const notes = [];
  if (prot) notes.push(callout('warn', mk('b', '', 'Sei sul branch "' + cur + '". '), 'Per sviluppare un test crea un branch dedicato (sezione "Nuovo branch") così non tocchi il branch principale.'));
  if (!s.hasRemote) notes.push(callout('err', 'Nessun remote configurato: Aggiorna e Pubblica non sono disponibili.'));
  $('git-notes').replaceChildren(...notes);

  const mg = $('git-merging');
  mg.hidden = !s.merging;
  if (s.merging) {
    const ab = mk('button', 'danger', 'Annulla il merge'); ab.type = 'button'; ab.disabled = dis;
    ab.onclick = () => gitOp('/api/git/merge-abort', {}, 'Annullare il merge in corso?\n\nComando: git merge --abort\nIl branch torna com\'era prima del merge.', 'Merge annullato');
    mg.replaceChildren(callout('err', mk('b', '', 'Merge in corso con conflitti. '), s.conflicts.length ? 'File in conflitto: ' + s.conflicts.join(', ') + '. ' : '', 'Puoi annullare il merge qui, oppure risolvere i conflitti nel tuo editor e concludere con git commit da terminale.'), ab);
  }

  // modifiche / commit
  const checks = [];
  const list = $('git-changes');
  if (!s.entries.length) list.replaceChildren(mk('div', 'item', 'Nessuna modifica: il lavoro è tutto committato.'));
  else {
    list.replaceChildren(...s.entries.map((e) => {
      const it = mk('div', 'item');
      const lab = mk('label');
      const cb = mk('input'); cb.type = 'checkbox'; cb.checked = !e.untracked; cb.disabled = dis; cb.dataset.path = e.path;
      checks.push(cb);
      // solo il nome del file (o della cartella); il percorso completo resta nel suggerimento
      const shown = e.path.replace(/\/+$/, '').split(' -> ').pop().split('/').pop() + (e.path.endsWith('/') ? '/' : '');
      const nm = mk('code', '', shown); nm.title = e.path; lab.title = e.path;
      const gi = gitIcon(e); lab.title = gi.label + ' — ' + e.path;
      lab.append(cb, gi.el, nm);
      it.append(lab);
      if (!demoOn && !/D/.test(e.code || '') && !e.path.endsWith('/')) { it.style.display = 'flex'; it.style.alignItems = 'center'; it.style.gap = '10px'; it.append(ideButton(e.path.split(' -> ').pop())); }
      return it;
    }));
  }
  $('git-commit').disabled = dis || !s.entries.length || s.merging || !can('git.write');
  $('git-commit').onclick = async () => {
    const files = checks.filter((c) => c.checked).map((c) => c.dataset.path);
    const msg = $('git-msg').value.trim();
    if (!files.length) { toast('Scegli almeno un file.', true); return; }
    if (!msg) { toast('Scrivi il messaggio del commit.', true); return; }
    const ok = await gitOp('/api/git/commit', { files, message: msg },
      'Creare un commit su "' + cur + '" con ' + files.length + ' file?\n\n' + files.slice(0, 8).join('\n') + (files.length > 8 ? '\n… e altri ' + (files.length - 8) : '') + '\n\nMessaggio: ' + msg, 'Commit creato');
    if (ok) $('git-msg').value = '';
  };

  // aggiorna / push
  $('git-update').disabled = dis || !s.hasRemote || !can('git.write');
  const pushDenied = !can('git.push') || (prot && !can('git.protected'));
  $('git-push').disabled = dis || !s.hasRemote || !cur || s.merging || pushDenied;
  $('git-push').title = pushDenied ? (prot && can('git.push') ? 'Il tuo profilo non consente di pubblicare sul branch principale' : 'Il tuo profilo non consente di pubblicare') : '';
  $('git-update').onclick = () => gitOp('/api/git/update', {}, null, 'Branch aggiornato');
  $('git-push').onclick = () => gitOp('/api/git/push', {},
    (prot ? '⚠ STAI PUBBLICANDO SU "' + cur + '", il branch principale.\n\n' : '') +
    'Pubblicare "' + cur + '" su origin?\n\nComando: ' + (s.upstream ? 'git push' : 'git push -u origin ' + cur) + '\n' + (s.ahead ? s.ahead + ' commit verranno inviati.' : 'Non risultano commit da inviare.') + '\nNon viene mai usato il force push.', 'Pubblicato');

  // cambio branch
  const sw = $('git-switch');
  sw.replaceChildren();
  const gl = document.createElement('optgroup'); gl.label = 'Locali';
  for (const b of s.locals) { const o = mk('option', '', b.name + (b.name === cur ? ' (corrente)' : '') + (b.when ? ' · ' + fmtWhen(b.when) : '')); o.value = 'L:' + b.name; o.disabled = b.name === cur; gl.append(o); }
  sw.append(gl);
  const onlyRemote = s.remotes.filter((b) => !b.localExists);
  if (onlyRemote.length) {
    const gr = document.createElement('optgroup'); gr.label = 'Solo sul remoto (verrà creato il branch locale)';
    for (const b of onlyRemote) { const o = mk('option', '', b.name + (b.when ? ' · ' + fmtWhen(b.when) : '')); o.value = 'R:' + b.name; gr.append(o); }
    sw.append(gr);
  }
  // nessuna preselezione: il branch lo sceglie l'utente
  const hasOther = [...sw.options].some((o) => !o.disabled);
  const ph = mk('option', '', hasOther ? 'Scegli un branch…' : 'Nessun altro branch disponibile'); ph.value = ''; ph.disabled = true; sw.prepend(ph); sw.value = '';
  const swSync = () => { $('git-switch-go').disabled = dis || !sw.value || !can('git.write'); };
  sw.onchange = swSync; swSync();
  $('git-switch-go').onclick = () => {
    const v = sw.value; if (!v) return;
    gitOp('/api/git/switch', { name: v.slice(2), remote: v[0] === 'R' }, null, 'Branch cambiato');
  };
  $('git-switch-note').textContent = s.changes ? 'Hai ' + s.changes + ' file modificati: salvali con un commit prima di cambiare branch.' : 'Puoi tornare a questo branch in qualsiasi momento.';

  // nuovo branch
  const from = $('git-from');
  from.replaceChildren();
  const fromOpts = [...s.locals.map((b) => b.name), ...s.remotes.map((b) => b.name)];
  for (const n of fromOpts) { const o = mk('option', '', n + (n === cur ? ' (corrente)' : '')); o.value = n; from.append(o); }
  if (cur) from.value = cur;
  $('git-new').placeholder = s.branchPattern ? 'es. ' + s.branchPattern : 'es. feature/NX-2';
  $('git-new-note').textContent = (s.branchPattern ? 'Convenzione del profilo: ' + s.branchPattern + '. ' : '') + (s.changes ? 'Salva prima le modifiche con un commit.' : '');
  $('git-create').disabled = dis || !can('git.write');
  $('git-create').onclick = async () => {
    const name = $('git-new').value.trim();
    if (!name) { toast('Scrivi il nome del nuovo branch.', true); return; }
    const ok = await gitOp('/api/git/create', { name, from: from.value }, null, 'Branch "' + name + '" creato');
    if (ok) $('git-new').value = '';
  };

  // merge
  const ms = $('git-merge-src');
  ms.replaceChildren();
  for (const n of fromOpts.filter((x) => x !== cur)) { const o = mk('option', '', n); o.value = n; ms.append(o); }
  const mph = mk('option', '', ms.options.length ? 'Scegli il branch da unire…' : 'Nessun altro branch disponibile'); mph.value = ''; mph.disabled = true; ms.prepend(mph); ms.value = '';
  $('git-merge-into').textContent = cur || '—';
  const msSync = () => { $('git-merge-go').disabled = dis || !cur || !ms.value || s.merging || !can('git.write') || (prot && !can('git.protected')); };
  ms.onchange = msSync; msSync();
  $('git-merge-go').onclick = () => {
    const src = ms.value; if (!src) return;
    gitOp('/api/git/merge', { source: src },
      (prot ? '⚠ Stai unendo dentro "' + cur + '", il branch principale.\n\n' : '') + 'Unire "' + src + '" dentro "' + cur + '"?\n\nComando: git merge --no-edit ' + src + '\nSe ci sono conflitti potrai annullare il merge.', 'Merge completato');
  };
}

