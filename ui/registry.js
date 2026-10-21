// Ricerca nel registro ufficiale dei server MCP (registry.modelcontextprotocol.io) e preparazione della voce da scrivere in .mcp.json.
// I server del registro sono di TERZE PARTI: il registro verifica chi possiede lo spazio dei nomi, non il codice. Per questo:
//  - non si installa né si esegue nulla qui: si produce solo la voce di configurazione;
//  - ogni campo che finirà in un comando è validato con regole rigide (una riga di comando passa da "cmd /c" su Windows);
//  - i segreti non entrano mai nella voce: solo segnaposto ${NOME} che l'utente imposta nel proprio ambiente;
//  - all'aggiunta la voce si ricostruisce dal registro sul server, mai da dati inviati dal browser.
const HOST = 'https://registry.modelcontextprotocol.io';
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}\/[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/;
const VER_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
const NPM_RE = /^(@[a-z0-9][a-z0-9._~-]{0,100}\/)?[a-z0-9][a-z0-9._~-]{0,100}$/;
const PYPI_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/;
const ENV_RE = /^[A-Z_][A-Z0-9_]{0,63}$/;
const ARG_RE = /^[A-Za-z0-9._:/=@+,-]{1,100}$/; // niente spazi né caratteri speciali di shell
const FLAG_RE = /^--?[A-Za-z][A-Za-z0-9-]{0,40}$/;
const HEADER_RE = /^[A-Za-z0-9-]{1,64}$/;
const MAX_PAGES = 2; // la ricerca del registro è lenta (6-16 s a richiesta): oltre due pagine l'attesa diventa eccessiva
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map();

const clip = (s, n = 300) => String(s == null ? '' : s).replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

// Messaggio che dice la causa vera: prima ogni errore diventava "non raggiungibile", anche i semplici timeout del registro (a volte lento).
function networkError(e, timeoutMs) {
  const code = String(e && e.cause && (e.cause.code || e.cause.message) || '');
  if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) return 'Il registro MCP non ha risposto entro ' + Math.round(timeoutMs / 1000) + ' secondi: è lento o sovraccarico, non è un problema della tua connessione. Riprova tra poco.';
  if (/ENOTFOUND|EAI_AGAIN/.test(code)) return 'Non riesco a risolvere registry.modelcontextprotocol.io (DNS): controlla la connessione.';
  if (/ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|UND_ERR_CONNECT_TIMEOUT/.test(code)) return 'Connessione al registro MCP non riuscita (' + code + '): controlla rete, proxy o firewall.';
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ISSUER/.test(code)) return 'Il certificato del registro non è riconosciuto (' + code + '): probabile proxy aziendale che ispeziona il traffico.';
  if (/redirect/i.test(code + ' ' + String(e && e.message))) return 'Il registro MCP ha risposto con un reindirizzamento inatteso.';
  return 'Errore di rete verso il registro MCP (' + (code || clip(e && e.message, 80)) + ').';
}

async function getJson(pathAndQuery, timeoutMs = 20000) {
  let res;
  try {
    res = await fetch(HOST + pathAndQuery, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error', headers: { accept: 'application/json' } });
  } catch (e) { throw new Error(networkError(e, timeoutMs)); }
  if (!res.ok) throw new Error('Il registro MCP ha risposto con errore ' + res.status + '.');
  const text = await res.text();
  if (text.length > 4 * 1024 * 1024) throw new Error('Risposta del registro troppo grande.');
  try { return JSON.parse(text); } catch { throw new Error('Risposta del registro non valida.'); }
}

const verParts = (v) => String(v).split(/[.+-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : -1));
function cmpVer(a, b) {
  const x = verParts(a), y = verParts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d) return d; }
  return 0;
}

// Segnaposto da un nome: {api_key} -> ${API_KEY}
const toPlaceholder = (name) => '${' + String(name).toUpperCase().replace(/[^A-Z0-9_]/g, '_') + '}';

// Argomenti con valore fisso e sicuro; null = il server richiede argomenti che qui non si possono decidere.
function fixedArgs(list) {
  const out = [];
  for (const a of Array.isArray(list) ? list : []) {
    const required = a && a.isRequired === true;
    const val = typeof (a && a.value) === 'string' ? a.value : (typeof (a && a.default) === 'string' ? a.default : '');
    if (!a || (a.type !== 'positional' && a.type !== 'named')) return null;
    if (a.type === 'positional') {
      if (!val) { if (required) return null; continue; }
      if (!ARG_RE.test(val)) return null;
      out.push(val);
    } else {
      const name = String(a.name || '');
      if (!FLAG_RE.test(name)) return null;
      if (!val) { if (required) out.push(name); continue; }
      if (!ARG_RE.test(val)) return null;
      out.push(name, val);
    }
  }
  return out;
}

function envFrom(list) {
  const env = {}, names = [], optional = [];
  for (const v of Array.isArray(list) ? list : []) {
    const name = String(v && v.name || '');
    if (!ENV_RE.test(name)) return null;
    const required = v.isRequired === true || v.isSecret === true;
    const info = { name, required, secret: v.isSecret === true, description: clip(v.description, 160) };
    if (required) { env[name] = '${' + name + '}'; names.push(info); } else optional.push(info);
  }
  return { env, names, optional };
}

function headersFrom(list, key) {
  const headers = {}, names = [];
  for (const h of Array.isArray(list) ? list : []) {
    const name = String(h && h.name || '');
    if (!HEADER_RE.test(name)) return null;
    let value;
    if (typeof h.value === 'string' && h.value && !h.isSecret || (typeof h.value === 'string' && /\{[A-Za-z][A-Za-z0-9_]{0,63}\}/.test(h.value))) {
      if (/\{[^}]*\}/.test(h.value)) {
        const bad = h.value.replace(/\{([A-Za-z][A-Za-z0-9_]{0,63})\}/g, '').match(/[{}]/);
        if (bad) return null;
        value = h.value.replace(/\{([A-Za-z][A-Za-z0-9_]{0,63})\}/g, (_, n) => toPlaceholder(n));
        if (/[\u0000-\u001f"]/.test(value) || value.length > 200) return null;
        for (const m of value.matchAll(/\$\{([A-Z0-9_]+)\}/g)) names.push({ name: m[1], required: true, secret: h.isSecret === true, description: 'Header ' + name });
      } else {
        if (/[\u0000-\u001f"]/.test(h.value) || h.value.length > 200) return null;
        value = h.value;
      }
    } else if (h.isRequired === true || h.isSecret === true) {
      const v = toPlaceholder('MCP_' + key + '_' + name).slice(2, -1);
      value = '${' + v + '}';
      names.push({ name: v, required: true, secret: true, description: 'Header ' + name + (h.description ? ': ' + clip(h.description, 120) : '') });
    } else continue;
    headers[name] = value;
  }
  return { headers, names };
}

// Nome della voce in .mcp.json, dall'ultimo segmento del nome del registro.
const keyFor = (name) => String(name).split('/').pop().toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 60) || 'server';

// Elenco deterministico delle opzioni di un server (stesso ordine all'elenco e all'aggiunta): prima i pacchetti, poi i remoti.
function buildOptions(s) {
  const key = keyFor(s.name);
  const opts = [];
  for (const p of Array.isArray(s.packages) ? s.packages : []) {
    const type = String(p && p.registryType || '');
    const kind = type === 'npm' ? 'npm' : type === 'pypi' ? 'pypi' : '';
    const label = kind || type || 'pacchetto';
    const unsupported = (why) => opts.push({ kind: kind || 'altro', label, ok: false, why });
    if (!kind) { unsupported('tipo di pacchetto non gestito qui (' + clip(type, 20) + ')'); continue; }
    if (!p.transport || p.transport.type !== 'stdio') { unsupported('trasporto non gestito'); continue; }
    const id = String(p.identifier || ''), ver = String(p.version || s.version || '');
    if (!(kind === 'npm' ? NPM_RE : PYPI_RE).test(id) || !VER_RE.test(ver)) { unsupported('identificatore o versione non validi'); continue; }
    const args = fixedArgs(p.packageArguments);
    if (!args) { unsupported('richiede argomenti da scegliere'); continue; }
    const env = envFrom(p.environmentVariables);
    if (!env) { unsupported('variabili d\'ambiente con nomi non gestiti'); continue; }
    const server = kind === 'npm' ? { command: 'npx', args: ['-y', id + '@' + ver, ...args] } : { command: 'uvx', args: [id + '==' + ver, ...args] };
    if (Object.keys(env.env).length) server.env = env.env;
    opts.push({ kind, label, ok: true, key, server, envNames: env.names, optionalEnv: env.optional, summary: 'Si scarica ed esegue sul tuo PC: ' + server.command + ' ' + server.args.join(' ') });
  }
  for (const r of Array.isArray(s.remotes) ? s.remotes : []) {
    const t = String(r && r.type || '');
    const type = t === 'streamable-http' ? 'http' : t === 'sse' ? 'sse' : '';
    let url = null;
    try { url = new URL(String(r && r.url || '')); } catch { /* url non valido */ }
    const label = 'remoto' + (url ? ' ' + url.hostname + (url.pathname.length > 1 ? url.pathname.replace(/\/$/, '') : '') : '');
    const unsupported = (why) => opts.push({ kind: 'remote', label, ok: false, why });
    if (!type) { unsupported('trasporto non gestito (' + clip(t, 20) + ')'); continue; }
    if (!url || url.protocol !== 'https:' || /[{}\s"]/.test(String(r.url))) { unsupported('indirizzo non valido o con parametri da scegliere'); continue; }
    const h = headersFrom(r.headers, key);
    if (!h) { unsupported('header non gestiti'); continue; }
    const server = { type, url: url.href };
    if (Object.keys(h.headers).length) server.headers = h.headers;
    opts.push({ kind: 'remote', label, ok: true, key, server, envNames: h.names, optionalEnv: [], summary: 'Si collega a ' + url.href + ': le tue richieste e i dati passano da quel servizio esterno.' });
  }
  return opts;
}

function describe(entry) {
  const s = entry.server || {};
  const meta = (entry._meta && entry._meta['io.modelcontextprotocol.registry/official']) || {};
  const repo = s.repository && /^https:\/\/[\w./-]{1,200}$/.test(String(s.repository.url || '')) ? s.repository.url : '';
  const opts = buildOptions(s);
  return {
    name: s.name, version: s.version, description: clip(s.description), status: meta.status || 'active', repo, publisher: String(s.name).split('/')[0],
    options: opts.map((o) => ({ kind: o.kind, label: o.label, ok: o.ok, why: o.why || '', summary: o.summary || '', envNames: o.envNames || [], optionalEnv: o.optionalEnv || [], preview: o.ok ? JSON.stringify({ [o.key]: o.server }, null, 2) : '' })),
  };
}

// Cerca nel registro: per ogni server tiene l'ultima versione attiva (il flag isLatest non è affidabile: il server Atlassian ufficiale non ce l'ha).
async function search(q) {
  q = String(q || '').trim();
  if (q.length < 2 || q.length > 60 || /[\u0000-\u001f]/.test(q)) throw new Error('Scrivi da 2 a 60 caratteri.');
  const hit = cache.get(q.toLowerCase());
  if (hit && Date.now() - hit.t < CACHE_MS) return hit.data;
  const best = new Map();
  let cursor = '';
  let truncated = false;
  for (let i = 0; i < MAX_PAGES; i++) {
    const j = await getJson('/v0/servers?search=' + encodeURIComponent(q) + '&limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''), 60000);
    for (const e of Array.isArray(j.servers) ? j.servers : []) {
      const s = e && e.server;
      if (!s || !NAME_RE.test(String(s.name)) || !VER_RE.test(String(s.version))) continue;
      const st = (e._meta && e._meta['io.modelcontextprotocol.registry/official'] || {}).status || 'active';
      if (st === 'deleted') continue;
      const cur = best.get(s.name);
      if (!cur || cmpVer(s.version, cur.server.version) > 0) best.set(s.name, e);
    }
    cursor = j.metadata && j.metadata.nextCursor || '';
    if (!cursor) break;
    if (i === MAX_PAGES - 1) truncated = true;
  }
  const lq = q.toLowerCase();
  const last = (n) => n.split('/').pop().toLowerCase();
  const rank = (n) => (last(n) === lq ? 0 : last(n).includes(lq) ? 1 : n.toLowerCase().includes(lq) ? 2 : 3); // prima i nomi che coincidono con la ricerca
  const all = [...best.values()].sort((a, b) => rank(a.server.name) - rank(b.server.name) || a.server.name.localeCompare(b.server.name));
  const data = { query: q, total: all.length, truncated, results: all.slice(0, 40).map(describe) };
  cache.set(q.toLowerCase(), { t: Date.now(), data });
  return data;
}

// Ricostruisce la voce da scrivere: legge il server dal registro per nome e versione e rifà tutte le validazioni.
async function build(name, version, optionIndex) {
  name = String(name || ''); version = String(version || '');
  if (!NAME_RE.test(name) || !VER_RE.test(version)) throw new Error('Server o versione non validi.');
  const j = await getJson('/v0/servers/' + encodeURIComponent(name) + '/versions/' + encodeURIComponent(version));
  const s = j && j.server;
  if (!s || s.name !== name || String(s.version) !== version) throw new Error('Il registro non conosce questa versione del server.');
  const st = (j._meta && j._meta['io.modelcontextprotocol.registry/official'] || {}).status;
  if (st === 'deleted') throw new Error('Questo server è stato rimosso dal registro.');
  const opts = buildOptions(s);
  const o = opts[Number(optionIndex)];
  if (!o) throw new Error('Opzione non trovata.');
  if (!o.ok) throw new Error('Questa opzione non è gestita: ' + o.why + '.');
  return { key: o.key, server: o.server, envNames: o.envNames.map((x) => x.name), summary: o.summary };
}

module.exports = { search, build, keyFor, buildOptions, fixedArgs, cmpVer };
