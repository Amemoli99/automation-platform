// Configurazione della UI: permessi (.claude/settings.json), profilo progetto, diagnostica ambiente.
// Zero dipendenze. Nessun comando usa input utente: gli argomenti dei processi sono costanti.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { exec } = require('child_process');
const jdks = require('./jdks');
const { claudeBin, spawnClaude } = require('../infra/claude');
const { killTree } = require('../infra/proc');

const settingsFile = (root) => path.join(root, '.claude', 'settings.json');
const localFile = (root) => path.join(root, '.claude', 'settings.local.json');
const profileFile = (root) => path.join(root, '.claude', 'project-profile.md');

// Regole che implementTest usa davvero (compilazione, run, git, Explorer via Playwright MCP).
const PRESET = [
  'Bash(mvn -q test-compile)',
  'Bash(mvn test:*)',
  'Bash(git status:*)',
  'Bash(git diff:*)',
  'Bash(git branch:*)',
  'Bash(git checkout:*)',
  'mcp__playwright',
];

const RULE_RE = /^[A-Za-z][\w-]*(__\*)?(\([^\r\n]{1,300}\))?$/; // il trattino serve ai server MCP (mcp__oracle-readonly__...); ammesso anche mcp__server__*
const TOO_BROAD = /^(Bash|\*)$|^Bash\(\s*(\*|:\*|\*:\*)?\s*\)$/;
const MAX_RULES = 100;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return e.code === 'ENOENT' ? {} : { __error: e.message };
  }
}

const allowOf = (obj) => {
  const a = obj && obj.permissions && obj.permissions.allow;
  return Array.isArray(a) ? a.filter((x) => typeof x === 'string') : [];
};

function writeAtomic(file, text) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function readProfile(root) {
  let text;
  try {
    text = fs.readFileSync(profileFile(root), 'utf8');
  } catch {
    return { exists: false, entries: [] };
  }
  let section = '';
  const entries = [];
  for (const line of text.split(/\r?\n/)) {
    let m;
    if ((m = line.match(/^##\s+(.*)/))) { section = m[1]; continue; }
    if ((m = line.match(/^- `(\w+)`: `([^`]*)`/))) entries.push({ key: m[1], value: m[2], section, tbd: m[2].startsWith('TBD') });
  }
  return { exists: true, entries };
}

function readConfig(root) {
  const shared = readJson(settingsFile(root));
  const local = readJson(localFile(root));
  return {
    preset: PRESET,
    permissions: {
      file: '.claude/settings.json',
      exists: fs.existsSync(settingsFile(root)),
      error: shared.__error || null,
      allow: allowOf(shared),
      local: allowOf(local), // sola lettura: regole personali già attive
      localError: local.__error || null,
    },
    profile: readProfile(root),
  };
}

function savePermissions(root, rules) {
  if (!Array.isArray(rules)) throw new Error('Elenco regole non valido');
  const clean = [...new Set(rules.map((r) => String(r).trim()).filter(Boolean))];
  if (clean.length > MAX_RULES) throw new Error(`Massimo ${MAX_RULES} regole`);
  for (const r of clean) {
    if (!RULE_RE.test(r)) throw new Error(`Regola non valida: ${r}`);
    if (TOO_BROAD.test(r)) throw new Error(`Regola troppo ampia (consente tutto): ${r}`);
  }
  const file = settingsFile(root);
  const cur = readJson(file);
  if (cur.__error) throw new Error('settings.json non è JSON valido, correggilo a mano: ' + cur.__error);
  cur.permissions = { ...(cur.permissions || {}), allow: clean };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeAtomic(file, JSON.stringify(cur, null, 2) + '\n');
  return clean;
}

function saveProfileValue(root, key, value) {
  if (!/^\w+$/.test(String(key))) throw new Error('Chiave non valida');
  const v = String(value == null ? '' : value).trim();
  if (!v || v.length > 200 || /[`\r\n]/.test(v)) throw new Error('Valore non valido (1-200 caratteri, niente backtick né a capo)');
  const file = profileFile(root);
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { throw new Error('project-profile.md non trovato'); }
  const re = new RegExp('^(- `' + key + '`: `)[^`]*(`)', 'm');
  if (!re.test(text)) throw new Error('Voce non trovata nel profilo: ' + key);
  writeAtomic(file, text.replace(re, (_, a, b) => a + v + b));
  return v;
}

/* ---------- diagnostica ---------- */
function run(cmd, args, timeout = 15000, cwd = undefined, env = undefined) {
  return new Promise((resolve) => {
    // exec (shell) su Windows per risolvere i .cmd (claude, mvn); comando e args sono costanti
    exec([cmd, ...args].join(' '), { timeout, windowsHide: true, encoding: 'utf8', cwd, env }, (err, stdout, stderr) =>
      resolve({ ok: !err, out: String(stdout || '').trim(), err: String(stderr || '').trim() }));
  });
}

function covers(rules, cmd) {
  return rules.some((r) => {
    const m = r.match(/^Bash\(([\s\S]*)\)$/);
    if (!m) return false;
    const p = m[1];
    if (p.endsWith(':*')) { const base = p.slice(0, -2); return cmd === base || cmd.startsWith(base + ' '); }
    return p === cmd;
  });
}

const chk = (id, label, status, detail, hint) => ({ id, label, status, detail, hint: hint || '' });

// opts.noProject: nessun progetto agganciato (es. wizard): si controllano solo gli strumenti del computer, non i file del progetto.
async function diagnostics(root, opts = {}) {
  const cfg = readConfig(root);
  const rules = [...cfg.permissions.allow, ...cfg.permissions.local];
  const first = (s) => String(s).split(/\r?\n/)[0].slice(0, 120);
  const jenv = jdks.envFor(opts.jdk); // JDK scelto per il progetto (altrimenti quello del computer)
  const chosen = !!opts.jdk && jenv.JAVA_HOME !== process.env.JAVA_HOME;

  const [claudeV, claudeAuth, mvn, java, git] = await Promise.all([
    run('claude', ['--version']),
    run('claude', ['auth', 'status']),
    run('mvn', ['-v'], 15000, undefined, jenv),
    run('java', ['-version'], 15000, undefined, jenv),
    run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], 15000, root), // nella cartella del progetto, non in quella del server
  ]);

  const out = [];
  const major = Number(process.versions.node.split('.')[0]);
  out.push(chk('node', 'Node.js', major >= 18 ? 'ok' : 'warn', 'v' + process.versions.node, major >= 18 ? '' : 'Consigliato Node 18 o superiore.'));

  out.push(claudeV.ok
    ? chk('claude', 'Claude CLI', 'ok', first(claudeV.out))
    : chk('claude', 'Claude CLI', 'fail', 'Non trovato nel PATH', 'Installa Claude Code e riapri la UI.'));

  if (!claudeAuth.ok) {
    out.push(chk('auth', 'Login Claude', 'fail', 'Stato non leggibile', 'La sessione è scaduta o assente: usa "Accedi a Claude".'));
  } else {
    let a = {};
    try { a = JSON.parse(claudeAuth.out); } catch { /* output non JSON */ }
    if (!a.loggedIn) out.push(chk('auth', 'Login Claude', 'fail', 'Non autenticato', 'Usa "Accedi a Claude".'));
    else if (process.env.ANTHROPIC_API_KEY) out.push(chk('auth', 'Login Claude', 'warn', 'ANTHROPIC_API_KEY impostata', 'Con una API key le sessioni vanno a consumo, non sul piano. Rimuovila se non è voluto.'));
    else out.push(chk('auth', 'Login Claude', 'ok', [a.authMethod, a.subscriptionType].filter(Boolean).join(' · ') || 'autenticato'));
  }

  out.push(mvn.ok
    ? chk('mvn', 'Maven', 'ok', first(mvn.out))
    : chk('mvn', 'Maven', 'fail', 'Non trovato nel PATH', 'Installa Maven e aggiungilo al PATH: senza non si compila né si esegue il test.'));

  const jv = (java.err || java.out).match(/version "([^"]+)"/);
  if (!java.ok && !jv) out.push(chk('java', 'Java', 'fail', 'Non trovato nel PATH', 'Il progetto richiede Java 11.'));
  else {
    const ver = jv ? jv[1] : first(java.err || java.out);
    out.push(chk('java', 'Java', /^(11|1\.11)\b/.test(ver) ? 'ok' : 'warn', ver + (chosen ? ' (scelto per il progetto)' : ''), /^(11|1\.11)\b/.test(ver) ? '' : 'Il profilo indica Java 11.' + (opts.noProject ? '' : ' Puoi scegliere un altro JDK nella scheda Progetto.')));
  }

  const m2 = path.join(os.homedir(), '.m2', 'settings.xml');
  out.push(fs.existsSync(m2)
    ? chk('m2', 'Maven settings.xml', 'ok', '~/.m2/settings.xml presente')
    : chk('m2', 'Maven settings.xml', 'warn', '~/.m2/settings.xml mancante', 'Serve per scaricare commonAletheia (artifact automation-common) da GitHub Packages.'));

  if (opts.noProject) {
    const gv = await run('git', ['--version']);
    out.push(gv.ok ? chk('git', 'Git', 'ok', first(gv.out)) : chk('git', 'Git', 'fail', 'Non trovato nel PATH', 'Installa Git per Windows e riapri la UI.'));
    return out;
  }
  out.push(git.ok
    ? chk('git', 'Git', 'ok', 'branch ' + first(git.out))
    : chk('git', 'Git', 'warn', 'Repository non leggibile', 'Lo step Branch potrebbe fallire.'));

  const mcp = readJson(path.join(root, '.mcp.json'));
  const hasPw = !!(mcp.mcpServers && mcp.mcpServers.playwright);
  out.push(hasPw
    ? chk('mcp', 'Playwright MCP', 'ok', 'server "playwright" in .mcp.json')
    : chk('mcp', 'Playwright MCP', 'fail', 'Server non configurato in .mcp.json', 'Lo step Explorer naviga con Playwright MCP.'));
  if (hasPw && !rules.some((r) => r === 'mcp__playwright' || r.startsWith('mcp__playwright__'))) {
    out.push(chk('mcp-perm', 'Permesso Playwright', 'warn', 'Nessuna regola mcp__playwright', "In modalità non interattiva l'Explorer verrebbe negato. Applica il preset nei permessi."));
  }

  const needs = [['Compilazione', 'mvn -q test-compile'], ['Esecuzione test', 'mvn test -DsuiteFile=Suite.xml -DEnv=27']];
  const missing = needs.filter(([, c]) => !covers(rules, c)).map(([n]) => n);
  out.push(missing.length
    ? chk('perm', 'Permessi Bash', 'warn', 'Non coperti: ' + missing.join(', '), 'La pipeline si fermerebbe con "permesso negato". Applica il preset.')
    : chk('perm', 'Permessi Bash', 'ok', 'mvn compile/test coperti (stima sulle regole)'));

  const tbd = cfg.profile.entries.filter((e) => e.tbd);
  out.push(!cfg.profile.exists
    ? chk('profile', 'Profilo progetto', 'fail', 'project-profile.md mancante', 'La pipeline legge tutto da qui.')
    : tbd.length
      ? chk('profile', 'Profilo progetto', 'warn', tbd.length + (tbd.length === 1 ? ' voce da compilare' : ' voci da compilare'), 'Compilale nella sezione Profilo: ' + tbd.slice(0, 5).map((e) => e.key).join(', ') + (tbd.length > 5 ? '…' : ''))
      : chk('profile', 'Profilo progetto', 'ok', 'Nessuna voce da compilare'));

  return out;
}

/* ---------- login Claude dalla UI ---------- */
// `claude auth login` apre il browser da solo; qui si tiene traccia del processo e si legge l'esito con `claude auth status`.
const loginJob = { child: null, state: 'idle', url: '', error: '' };
function loginState() { return { state: loginJob.state, url: loginJob.url, error: loginJob.error }; }
async function authStatus() {
  const r = await run(claudeBin(), ['auth', 'status']);
  let a = {};
  try { a = JSON.parse(r.out); } catch { /* output non JSON */ }
  return { loggedIn: !!a.loggedIn, email: a.email || '', authMethod: a.authMethod || '', subscriptionType: a.subscriptionType || '' };
}
function startLogin() {
  if (loginJob.state === 'running') return loginState();
  Object.assign(loginJob, { state: 'running', url: '', error: '' });
  const { spawn } = require('child_process');
  // shell:true per risolvere claude.cmd su Windows; gli argomenti sono costanti
  const p = spawnClaude(['auth', 'login', '--claudeai'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  loginJob.child = p;
  const sniff = (d) => { const m = String(d).match(/https?:\/\/\S+/); if (m && !loginJob.url) loginJob.url = m[0]; };
  p.stdout.on('data', sniff); p.stderr.on('data', sniff);
  const timer = setTimeout(() => stopLogin('Tempo scaduto: il login non è stato completato entro 5 minuti.'), 5 * 60 * 1000);
  p.on('error', (e) => { clearTimeout(timer); Object.assign(loginJob, { child: null, state: 'failed', error: e.message }); });
  p.on('exit', (code) => {
    clearTimeout(timer);
    if (loginJob.child !== p) return; // già annullato
    loginJob.child = null;
    if (code === 0) loginJob.state = 'done';
    else Object.assign(loginJob, { state: 'failed', error: 'Il login non è andato a buon fine (codice ' + code + ').' });
  });
  return loginState();
}
function stopLogin(reason) {
  const p = loginJob.child;
  loginJob.child = null;
  killTree(p);
  Object.assign(loginJob, { state: reason ? 'failed' : 'idle', error: reason || '' });
  return loginState();
}

module.exports = { loginState, authStatus, startLogin, stopLogin, PRESET, covers, readProfile, readConfig, savePermissions, saveProfileValue, diagnostics };
