// Operazioni git per la UI: stato, cambio/creazione branch, aggiornamento, merge, push.
// git è lanciato con execFile (nessuna shell, argomenti sempre in array) e i nomi di branch sono validati
// e confrontati con quelli realmente presenti nel repository. Mai force push, mai reset/clean/delete.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const config = require('./config');

const BRANCH_RE = /^(?!-)(?!.*\.\.)(?!.*\/\/)(?!.*\/$)(?!.*\.lock$)(?!.*\.$)[A-Za-z0-9._\/-]{1,100}$/;
let busy = false;

function git(root, args, timeout = 60000) {
  return new Promise((resolve) => {
    execFile('git', args, {
      cwd: root, timeout, windowsHide: true, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true', GIT_MERGE_AUTOEDIT: 'no' },
    }, (err, stdout, stderr) => resolve({
      ok: !err, code: err ? err.code : 0, out: String(stdout || '').trim(), raw: String(stdout || ''), err: String(stderr || '').trim(),
      timedOut: !!(err && err.killed),
    }));
  });
}
const text = (r) => [r.out, r.err].filter(Boolean).join('\n');
const fail = (r, what) => { throw new Error(r.timedOut ? what + ': tempo scaduto (rete o credenziali?)' : (text(r) || what + ' non riuscito')); };

async function exclusive(fn) {
  if (busy) throw new Error('Un\'altra operazione git è ancora in corso.');
  busy = true;
  try { return await fn(); } finally { busy = false; }
}

function profileValue(root, key, fallback) {
  const e = config.readProfile(root).entries.find((x) => x.key === key);
  return e && !e.tbd ? e.value.trim() : fallback;
}

async function status(root) {
  const inside = await git(root, ['rev-parse', '--is-inside-work-tree']);
  if (!inside.ok || inside.out !== 'true') return { isRepo: false };

  const [cur, up, cnt, st, loc, rem, remotes] = await Promise.all([
    git(root, ['symbolic-ref', '--short', 'HEAD']),
    git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']),
    git(root, ['rev-list', '--left-right', '--count', 'HEAD...@{u}']),
    git(root, ['status', '--porcelain=v1']),
    git(root, ['for-each-ref', 'refs/heads', '--format=%(refname:short)%09%(upstream:short)%09%(committerdate:iso-strict)']),
    git(root, ['for-each-ref', 'refs/remotes', '--format=%(refname:short)%09%(committerdate:iso-strict)']),
    git(root, ['remote']),
  ]);

  // `raw` e non `out`: la prima riga del porcelain può iniziare con uno spazio (" M file") e il trim ne spezzerebbe il percorso
  const lines = st.ok ? st.raw.split(/\r?\n/).filter(Boolean) : [];
  const tracked = lines.filter((l) => !l.startsWith('??'));
  const [ahead, behind] = cnt.ok ? cnt.out.split(/\s+/).map(Number) : [0, 0];
  const locals = loc.ok && loc.out
    ? loc.out.split(/\r?\n/).map((l) => { const [name, upstream, when] = l.split('\t'); return { name, upstream: upstream || null, when }; })
    : [];
  const localNames = new Set(locals.map((b) => b.name));
  const remoteBranches = rem.ok && rem.out
    ? rem.out.split(/\r?\n/).map((l) => { const [name, when] = l.split('\t'); return { name, when }; }).filter((b) => b.name.includes('/') && !b.name.endsWith('/HEAD'))
    : [];
  return {
    isRepo: true,
    branch: cur.ok ? cur.out : null, // null = HEAD staccato
    upstream: up.ok ? up.out : null,
    ahead: cnt.ok ? ahead : 0,
    behind: cnt.ok ? behind : 0,
    changes: tracked.length,
    changedFiles: tracked.slice(0, 15).map((l) => l.trim()),
    untracked: lines.length - tracked.length,
    // tutte le voci (max 300) per la scelta dei file da committare: codice XY + percorso
    entries: lines.slice(0, 300).map((l) => ({ code: l.slice(0, 2), path: l.slice(3).replace(/^"|"$/g, ''), untracked: l.startsWith('??') })),
    merging: fs.existsSync(path.join(root, '.git', 'MERGE_HEAD')),
    conflicts: lines.filter((l) => /^(U.|.U|AA|DD)/.test(l)).map((l) => l.slice(3)),
    locals,
    remotes: remoteBranches.map((b) => ({ ...b, localExists: localNames.has(b.name.replace(/^[^/]+\//, '')) })),
    hasRemote: remotes.ok && !!remotes.out,
    baseBranch: profileValue(root, 'base_branch', 'main'),
    branchPattern: profileValue(root, 'branch_pattern', ''),
  };
}

function checkBranchName(n, label) {
  const s = String(n || '').trim();
  if (!BRANCH_RE.test(s)) throw new Error(`${label}: nome non valido (lettere, numeri, . _ - e /; niente spazi né ..).`);
  return s;
}
const needClean = (s) => {
  if (s.changes) throw new Error(`Hai ${s.changes} file modificati non salvati in un commit (${s.changedFiles.slice(0, 3).join(', ')}…). Salvali con un commit o mettili da parte prima di continuare.`);
};
const noMerge = (s) => { if (s.merging) throw new Error('C\'è un merge in corso: concludilo o annullalo prima.'); };

// Aggiorna: fetch di tutti i remoti e, se il branch ha un upstream, pull in sola avanzamento (mai merge automatici).
async function update(root) {
  return exclusive(async () => {
    const s = await status(root);
    if (!s.isRepo) throw new Error('La cartella non è un repository git.');
    if (!s.hasRemote) throw new Error('Nessun remote configurato: non c\'è niente da aggiornare.');
    const f = await git(root, ['fetch', '--all', '--prune'], 120000);
    if (!f.ok) fail(f, 'Fetch');
    let out = 'git fetch --all --prune\n' + (text(f) || 'ok');
    if (s.branch && s.upstream) {
      noMerge(s);
      const p = await git(root, ['pull', '--ff-only'], 120000);
      out += '\n\ngit pull --ff-only\n' + text(p);
      if (!p.ok) throw new Error(out + '\n\nIl branch non si può aggiornare in avanzamento semplice (divergenza o file locali in conflitto). Usa "Unisci" per integrare le novità.');
    } else out += '\n\nIl branch corrente non ha un upstream: aggiornati solo i riferimenti remoti.';
    return { output: out };
  });
}

async function switchTo(root, name, remote) {
  const n = checkBranchName(name, 'Branch');
  return exclusive(async () => {
    const s = await status(root);
    needClean(s); noMerge(s);
    if (remote) {
      if (!s.remotes.some((b) => b.name === n)) throw new Error('Branch remoto non trovato: ' + n + ' (prova prima "Aggiorna").');
      const local = n.replace(/^[^/]+\//, '');
      const exists = s.locals.some((b) => b.name === local);
      const r = exists ? await git(root, ['switch', local]) : await git(root, ['switch', '-c', local, '--track', n]);
      if (!r.ok) fail(r, 'Cambio branch');
      return { output: text(r) || 'Passato a ' + local };
    }
    if (!s.locals.some((b) => b.name === n)) throw new Error('Branch locale non trovato: ' + n);
    const r = await git(root, ['switch', n]);
    if (!r.ok) fail(r, 'Cambio branch');
    return { output: text(r) || 'Passato a ' + n };
  });
}

async function create(root, name, from) {
  const n = checkBranchName(name, 'Nuovo branch');
  const f = from ? checkBranchName(from, 'Branch di partenza') : null;
  return exclusive(async () => {
    const s = await status(root);
    needClean(s); noMerge(s);
    if (s.locals.some((b) => b.name === n)) throw new Error('Esiste già un branch locale chiamato ' + n);
    const valid = await git(root, ['check-ref-format', '--branch', n]);
    if (!valid.ok) throw new Error('Nome di branch non accettato da git: ' + n);
    const args = ['switch', '-c', n];
    if (f) {
      if (!s.locals.some((b) => b.name === f) && !s.remotes.some((b) => b.name === f)) throw new Error('Branch di partenza non trovato: ' + f);
      args.push(f);
    }
    const r = await git(root, args);
    if (!r.ok) fail(r, 'Creazione branch');
    return { output: 'git ' + args.join(' ') + '\n' + (text(r) || 'ok') };
  });
}

// Unisce `source` dentro il branch corrente. In caso di conflitto lascia il merge aperto: l'utente decide se annullarlo.
async function merge(root, source) {
  const src = checkBranchName(source, 'Branch da unire');
  return exclusive(async () => {
    const s = await status(root);
    if (!s.branch) throw new Error('Sei in HEAD staccato: passa a un branch prima di unire.');
    noMerge(s); needClean(s);
    if (src === s.branch) throw new Error('Non puoi unire un branch dentro se stesso.');
    if (!s.locals.some((b) => b.name === src) && !s.remotes.some((b) => b.name === src)) throw new Error('Branch da unire non trovato: ' + src);
    const r = await git(root, ['merge', '--no-edit', src], 120000);
    const output = 'git merge --no-edit ' + src + '\n' + text(r);
    if (r.ok) return { output };
    const after = await status(root);
    if (after.merging) return { conflict: true, files: after.conflicts, output };
    throw new Error(output);
  });
}

async function abortMerge(root) {
  return exclusive(async () => {
    const s = await status(root);
    if (!s.merging) throw new Error('Nessun merge in corso.');
    const r = await git(root, ['merge', '--abort']);
    if (!r.ok) fail(r, 'Annullamento del merge');
    return { output: 'git merge --abort\n' + (text(r) || 'Merge annullato: il branch è tornato com\'era.') };
  });
}

// Pubblica il branch corrente. Mai --force. Senza upstream lo crea su origin.
async function push(root) {
  return exclusive(async () => {
    const s = await status(root);
    if (!s.branch) throw new Error('Sei in HEAD staccato: passa a un branch prima di pubblicare.');
    if (!s.hasRemote) throw new Error('Nessun remote configurato.');
    noMerge(s);
    const args = s.upstream ? ['push'] : ['push', '-u', 'origin', s.branch];
    const r = await git(root, args, 120000);
    const output = 'git ' + args.join(' ') + '\n' + text(r);
    if (!r.ok) {
      const hint = /non-fast-forward|rejected|fetch first/i.test(output) ? '\n\nIl remoto ha commit che non hai: premi "Aggiorna" e poi "Unisci" prima di pubblicare. Non uso mai il force push.' : '';
      throw new Error(output + hint);
    }
    return { output };
  });
}

// Commit dei soli file scelti (quelli già in stage ma non scelti restano in stage, fuori dal commit). Niente --no-verify.
async function commit(root, files, message) {
  const msg = String(message || '').trim();
  if (!msg || msg.length > 500 || msg.includes(String.fromCharCode(0))) throw new Error('Scrivi un messaggio di commit (max 500 caratteri).');
  if (!Array.isArray(files) || !files.length) throw new Error('Scegli almeno un file da includere nel commit.');
  return exclusive(async () => {
    const s = await status(root);
    if (!s.isRepo) throw new Error('La cartella non è un repository git.');
    noMerge(s);
    const known = new Map(s.entries.map((e) => [e.path, e]));
    const picked = [...new Set(files.map(String))];
    for (const f of picked) if (!known.has(f)) throw new Error('File non presente tra le modifiche: ' + f);
    const newly = picked.filter((f) => known.get(f).untracked); // file nuovi che questo commit mette in stage
    const add = await git(root, ['add', '--', ...picked]);
    if (!add.ok) fail(add, 'Aggiunta dei file');
    const r = await git(root, ['commit', '-m', msg, '--', ...picked], 120000);
    const output = 'git commit -m "' + msg.replace(/\s+/g, ' ').slice(0, 80) + '" -- ' + picked.length + ' file\n' + text(r);
    if (!r.ok) {
      // un commit fallito non deve lasciare file nuovi in stage
      if (newly.length) await git(root, ['reset', '-q', '--', ...newly]);
      if (/Author identity unknown|Please tell me who you are|unable to auto-detect/i.test(output)) {
        throw new Error('Git non conosce la tua identità, quindi non può creare il commit.\n\nImpostala una volta da terminale:\n  git config --global user.name "Nome Cognome"\n  git config --global user.email "tua@email"');
      }
      throw new Error(output);
    }
    return { output };
  });
}

module.exports = { commit, status, update, switchTo, create, merge, abortMerge, push };
