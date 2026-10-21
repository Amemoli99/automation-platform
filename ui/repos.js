// Repository Git per la UI: elenco dei progetti di un'origine (GitHub: organizzazione/utente; GitLab: gruppo/utente
// su un server a scelta) e clone in locale.
// Le credenziali sono quelle già salvate da Git (Git Credential Manager): vengono lette solo in memoria per la
// chiamata API, mai salvate, mai inviate al browser, mai scritte nei log. Il clone usa sempre un URL costruito
// dal server con provider, host, gruppo e repository validati: nessun URL arbitrario.
const fs = require('fs');
const path = require('path');
const tls = require('tls');
const { spawn, execFile } = require('child_process');
const projects = require('./projects');

// Aziende con una CA interna: Node di default non usa l'archivio certificati di Windows. Se disponibile (Node 24+), lo si aggiunge.
try {
  if (typeof tls.getCACertificates === 'function' && typeof tls.setDefaultCACertificates === 'function') {
    tls.setDefaultCACertificates([...tls.getCACertificates('default'), ...tls.getCACertificates('system')]);
  }
} catch { /* resta l'elenco predefinito */ }

const GITHUB_API = (process.env.UI_GITHUB_API || 'https://api.github.com').replace(/\/+$/, '');
const gitlabApi = (host) => (process.env.UI_GITLAB_API ? process.env.UI_GITLAB_API.replace(/\/+$/, '') : `https://${host}/api/v4`);
const PROVIDERS = ['github', 'gitlab'];
const PROVIDER_NAME = { github: 'GitHub', gitlab: 'GitLab' };
const GH_OWNER_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const SEG_RE = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,100}$/;
const HOST_RE = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::\d{1,5})?$/;
const MAX_PAGES = 5;
const CACHE_MS = 60 * 1000;
const cache = new Map(); // chiave origine -> { at, repos }

/* ---------- origini (provider + host + proprietario/gruppo) ---------- */
function checkPath(p, label, maxSegments) {
  const s = String(p || '').trim().replace(/^\/+|\/+$/g, '');
  const segs = s.split('/');
  if (!s || segs.length > maxSegments || !segs.every((x) => SEG_RE.test(x))) throw new Error(`${label}: nome non valido (lettere, numeri, . _ - ${maxSegments > 1 ? 'e / per i sottogruppi' : ''}).`.replace(' )', ')'));
  return s;
}

// Normalizza e valida un'origine. GitHub ha host fisso; GitLab richiede il server (es. gitlab.mia-azienda.it).
function normalizeSource(src) {
  const s = src || {};
  const provider = String(s.provider || 'github').toLowerCase();
  if (!PROVIDERS.includes(provider)) throw new Error('Provider non supportato: scegli GitHub o GitLab.');
  if (provider === 'github') {
    const owner = String(s.owner || '').trim();
    if (!GH_OWNER_RE.test(owner)) throw new Error('Nome del proprietario GitHub non valido (lettere, numeri e -).');
    return { provider, host: 'github.com', owner };
  }
  const host = String(s.host || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (!HOST_RE.test(host)) throw new Error('Indirizzo del server GitLab non valido (es. gitlab.mia-azienda.it, senza https://).');
  return { provider, host, owner: checkPath(s.owner, 'Gruppo GitLab', 10) };
}
const sourceKey = (s) => `${s.provider}|${s.host.toLowerCase()}|${s.owner.toLowerCase()}`;
const sourceLabel = (s) => (s.provider === 'github' ? `GitHub · ${s.owner}` : `GitLab · ${s.host}/${s.owner}`);
const describeSource = (s) => ({ ...s, key: sourceKey(s), label: sourceLabel(s) });

const cloneUrl = (src, repoPath) => `https://${src.host}/${src.owner}/${repoPath}.git`;
const lastSeg = (p) => String(p).split('/').pop();

/* ---------- credenziali già salvate da Git ---------- */
function parseCredential(out) {
  const kv = {};
  for (const line of String(out).split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0) kv[line.slice(0, i)] = line.slice(i + 1);
  }
  return kv.password ? { username: kv.username || '', password: kv.password } : null;
}

function credential(host, timeoutMs = 120000) {
  return new Promise((resolve) => {
    let out = '';
    const p = spawn('git', ['credential', 'fill'], { windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, stdio: ['pipe', 'pipe', 'ignore'] });
    const timer = setTimeout(() => { try { p.kill(); } catch { /* già chiuso */ } }, timeoutMs);
    p.stdout.on('data', (d) => { out += d; });
    p.on('error', () => { clearTimeout(timer); resolve(null); });
    p.on('close', () => { clearTimeout(timer); resolve(parseCredential(out)); });
    p.stdin.on('error', () => { /* il processo può chiudersi prima */ });
    p.stdin.end(`protocol=https\nhost=${host}\n\n`);
  });
}

/* ---------- chiamate API ---------- */
const TLS_CODES = /UNABLE_TO_VERIFY|SELF_SIGNED|CERT_|DEPTH_ZERO|UNABLE_TO_GET_ISSUER/;

async function getPage(url, token, provider) {
  let res;
  const headers = provider === 'github'
    ? { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'nexsoft-automation-cockpit' }
    : { Authorization: 'Bearer ' + token, Accept: 'application/json', 'User-Agent': 'nexsoft-automation-cockpit' };
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
  } catch (e) {
    const code = String((e.cause && e.cause.code) || e.code || '');
    if (TLS_CODES.test(code)) throw new Error('Il certificato del server non è riconosciuto (' + code + '). Se è una CA aziendale, installala nell\'archivio certificati di Windows e riavvia la UI.');
    throw new Error(PROVIDER_NAME[provider] + ' non raggiungibile (rete, VPN o proxy): ' + (code || e.message));
  }
  if (res.ok) return res.json();
  const name = PROVIDER_NAME[provider];
  if (res.status === 401) throw new Error(`Credenziali ${name} non valide o scadute. Rifai il login con Git (ad esempio un git fetch su un repository di quel server)${provider === 'gitlab' ? ' oppure usa un token personale con permesso read_api' : ''} e riprova.`);
  if (res.status === 403) {
    if (res.headers.get('x-ratelimit-remaining') === '0') throw new Error(`Limite di richieste ${name} raggiunto: riprova tra qualche minuto.`);
    throw new Error(provider === 'github'
      ? 'Accesso negato da GitHub. Se l\'organizzazione usa il Single Sign-On, autorizza le credenziali di Git per l\'organizzazione.'
      : 'Accesso negato da GitLab: le credenziali salvate da Git potrebbero non avere il permesso di lettura API (serve read_api).');
  }
  if (res.status === 404) { const e = new Error('NOT_FOUND'); e.notFound = true; throw e; }
  throw new Error(`${name} ha risposto con errore ${res.status}.`);
}

async function fetchAll(base, token, provider) {
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const items = await getPage(`${base}${base.includes('?') ? '&' : '?'}per_page=100&page=${page}`, token, provider);
    if (!Array.isArray(items)) break;
    all.push(...items);
    if (items.length < 100) break;
  }
  return all;
}

const mapGithub = (r) => ({
  name: r.name, path: r.name, description: r.description || '',
  visibility: r.private ? 'private' : 'public', archived: !!r.archived, pushedAt: r.pushed_at || null, defaultBranch: r.default_branch || 'main',
});

// Percorso del progetto relativo al gruppo scelto (con sottogruppi); se non è sotto il gruppo (condiviso) si ignora.
function mapGitlab(r, ns) {
  const full = String(r.path_with_namespace || '');
  const prefix = ns.toLowerCase() + '/';
  if (!full.toLowerCase().startsWith(prefix)) return null;
  const rel = full.slice(prefix.length);
  return {
    name: lastSeg(rel), path: rel, description: r.description || '',
    visibility: r.visibility || 'private', archived: !!r.archived, pushedAt: r.last_activity_at || null, defaultBranch: r.default_branch || 'main',
  };
}

async function listRepos(source, { refresh } = {}) {
  const src = normalizeSource(source);
  const key = sourceKey(src);
  const hit = cache.get(key);
  if (hit && !refresh && Date.now() - hit.at < CACHE_MS) return hit.repos;
  const cred = await credential(src.host);
  if (!cred) throw new Error(`Nessuna credenziale trovata in Git per ${src.host}. Esegui una volta un'operazione che richiede il login su quel server (per esempio git fetch in un tuo progetto) e riprova.`);
  let repos;
  if (src.provider === 'github') {
    let items;
    try {
      items = await fetchAll(`${GITHUB_API}/orgs/${src.owner}/repos?type=all&sort=pushed`, cred.password, 'github');
    } catch (e) {
      if (!e.notFound) throw e;
      try { items = await fetchAll(`${GITHUB_API}/users/${src.owner}/repos?type=owner&sort=pushed`, cred.password, 'github'); } catch (e2) {
        throw e2.notFound ? new Error(`Il proprietario "${src.owner}" non esiste su GitHub (o non è visibile con le tue credenziali).`) : e2;
      }
    }
    repos = items.map(mapGithub);
  } else {
    const base = gitlabApi(src.host);
    const enc = encodeURIComponent(src.owner);
    let items;
    try {
      items = await fetchAll(`${base}/groups/${enc}/projects?include_subgroups=true&order_by=last_activity_at&sort=desc`, cred.password, 'gitlab');
    } catch (e) {
      if (!e.notFound) throw e;
      try { items = await fetchAll(`${base}/users/${enc}/projects?order_by=last_activity_at&sort=desc`, cred.password, 'gitlab'); } catch (e2) {
        throw e2.notFound ? new Error(`Il gruppo "${src.owner}" non esiste su ${src.host} (o non è visibile con le tue credenziali).`) : e2;
      }
    }
    repos = items.map((r) => mapGitlab(r, src.owner)).filter(Boolean);
  }
  repos.sort((a, b) => String(b.pushedAt).localeCompare(String(a.pushedAt)));
  cache.set(key, { at: Date.now(), repos });
  return repos;
}

/* ---------- copie locali e clone ---------- */
const run = (args, cwd, timeout) => new Promise((resolve) => execFile('git', args, {
  cwd, timeout, windowsHide: true, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
}, (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || '').trim(), err: String(stderr || '').trim(), timedOut: !!(err && err.killed) })));

const normUrl = (u) => String(u || '').trim().replace(/\.git$/i, '').replace(/^ssh:\/\/git@([^/]+)\//i, 'https://$1/').replace(/^git@([^:]+):/i, 'https://$1/').replace(/^https?:\/\/[^@/]+@/i, 'https://').toLowerCase();

// Segna quali repo hanno già una copia locale in `parent` (sottocartella con il nome del repository, con .git).
function markLocal(repos, parent) {
  let base = null;
  try { base = parent ? projects.validDir(parent, { mustBeEmptyOrMissing: false }) : null; } catch { /* parent non valido: nessuna copia locale */ }
  return repos.map((r) => ({ ...r, local: !!base && fs.existsSync(path.join(base, r.name, '.git')) }));
}

async function cloneRepo({ source, repo, parent }) {
  const src = normalizeSource(source);
  const rp = checkPath(repo, 'Repository', src.provider === 'github' ? 1 : 10);
  const base = projects.validDir(parent, { mustBeEmptyOrMissing: false });
  if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) throw new Error('La cartella in cui clonare non esiste: ' + base);
  const folder = lastSeg(rp);
  const dest = path.join(base, folder);
  const url = cloneUrl(src, rp);
  if (fs.existsSync(dest)) {
    const origin = await run(['config', '--get', 'remote.origin.url'], dest, 15000);
    if (fs.existsSync(path.join(dest, '.git')) && origin.ok && normUrl(origin.out) === normUrl(url)) return { dir: dest, cloned: false, output: 'Copia locale già presente: ' + dest };
    throw new Error('Esiste già una cartella "' + folder + '" in ' + base + ' che non è una copia di ' + src.owner + '/' + rp + '. Scegli un\'altra cartella.');
  }
  const c = await run(['clone', '--', url, dest], base, 15 * 60 * 1000);
  if (!c.ok) {
    try { if (fs.existsSync(dest) && !fs.readdirSync(dest).length) fs.rmdirSync(dest); } catch { /* resta com'è */ }
    throw new Error(c.timedOut ? 'Clone interrotto: tempo scaduto (repository grande o rete lenta).' : (c.err || c.out || 'Clone non riuscito.').split('\n').slice(-6).join('\n'));
  }
  return { dir: dest, cloned: true, output: (c.err || c.out || '').split('\n').slice(-4).join('\n') };
}

/* ---------- origini dedotte dai remoti già presenti ---------- */
// https://host/a/b/c.git | ssh://git@host/a/b/c.git | git@host:a/b/c.git  ->  { host, segments: [a, b, c] }
function parseRemote(url) {
  const m = String(url || '').trim().match(/^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/(?:[^@/]+@)?|[^@\s]+@)([^/:\s]+)(?::\d+)?[/:](.+?)(?:\.git)?\/?$/i);
  return m ? { host: m[1].toLowerCase(), segments: m[2].split('/').filter(Boolean) } : null;
}

function sourceFromRemote(url) {
  const r = parseRemote(url);
  if (!r || r.segments.length < 2) return null;
  try {
    if (r.host === 'github.com') return normalizeSource({ provider: 'github', owner: r.segments[0] });
    if (/(^|\.)gitlab\./i.test(r.host) || /^gitlab\./i.test(r.host)) return normalizeSource({ provider: 'gitlab', host: r.host, owner: r.segments.slice(0, -1).join('/') });
  } catch { /* nome non valido: si ignora */ }
  return null;
}

async function discoverSources(roots) {
  const found = new Map();
  for (const root of roots) {
    const r = await run(['config', '--get', 'remote.origin.url'], root, 15000);
    const s = r.ok ? sourceFromRemote(r.out) : null;
    if (s && !found.has(sourceKey(s))) found.set(sourceKey(s), s);
  }
  return [...found.values()];
}

// Una sottocartella della cartella di lavoro = un progetto.
async function discoverSourcesInWorkspace(workspace) {
  let dirs = [];
  try { dirs = fs.readdirSync(workspace, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => path.join(workspace, e.name)).slice(0, 60); } catch { return []; }
  return discoverSources(dirs.filter((d) => fs.existsSync(path.join(d, '.git'))));
}

module.exports = {
  PROVIDERS, normalizeSource, sourceKey, describeSource, cloneUrl, parseCredential, parseRemote, sourceFromRemote,
  listRepos, markLocal, cloneRepo, discoverSources, discoverSourcesInWorkspace,
};
