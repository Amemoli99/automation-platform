// Jira Cloud per la UI: connessione (email + API token), lettura di una dashboard di progetto, tipi e stati per
// progetto, costruzione e salvataggio di query JQL, ricerca e dettaglio dei ticket.
// Il token è cifrato con Windows DPAPI (solo l'utente Windows corrente può leggerlo) in un file FUORI dal repository
// (%APPDATA%\developerTest-UI\jira.json). Non viene mai restituito al browser né scritto nei log. Le chiamate vanno solo
// verso siti *.atlassian.net: le credenziali non possono essere inviate a un host arbitrario.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const SITE_RE = /^[a-z0-9][a-z0-9-]{0,62}\.atlassian\.net$/i;
const KEY_RE = /^[A-Z][A-Z0-9_]{1,19}$/;
const ISSUE_RE = /^[A-Z][A-Z0-9_]{1,19}-\d+$/;
const FIELDS = ['summary', 'status', 'issuetype', 'priority', 'assignee', 'updated', 'created'];
const MAX_QUERIES = 50;

/* ---------- archivio locale ---------- */
const { dataDir } = require('../../infra/paths');
const storeFile = () => path.join(dataDir(), 'jira.json');

function readStore() {
  try {
    const j = JSON.parse(fs.readFileSync(storeFile(), 'utf8'));
    return { config: j.config || null, queries: Array.isArray(j.queries) ? j.queries : [] };
  } catch { return { config: null, queries: [] }; }
}
function writeStore(st) {
  fs.mkdirSync(dataDir(), { recursive: true });
  const f = storeFile();
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(st, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, f);
}

/* ---------- cifratura DPAPI (via PowerShell, segreto solo su stdin) ---------- */
const ENTROPY = 'developerTest-UI/jira';
function powershell(script, stdin) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') return reject(new Error('La cifratura delle credenziali (DPAPI) è disponibile solo su Windows.'));
    const p = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { try { p.kill(); } catch { /* già chiuso */ } }, 30000);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve(out.trim()) : reject(new Error('Cifratura Windows non riuscita' + (err ? ': ' + err.trim().split('\n')[0] : '.'))); });
    p.stdin.on('error', () => { /* il processo può chiudersi prima */ });
    p.stdin.end(stdin);
  });
}
const protect = (secret) => powershell(
  "Add-Type -AssemblyName System.Security; $s=[Console]::In.ReadToEnd().Trim(); $b=[Convert]::FromBase64String($s); $e=[Text.Encoding]::UTF8.GetBytes('" + ENTROPY + "'); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b,$e,'CurrentUser'))",
  Buffer.from(secret, 'utf8').toString('base64'));
const unprotect = async (b64) => Buffer.from(await powershell(
  "Add-Type -AssemblyName System.Security; $s=[Console]::In.ReadToEnd().Trim(); $b=[Convert]::FromBase64String($s); $e=[Text.Encoding]::UTF8.GetBytes('" + ENTROPY + "'); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect($b,$e,'CurrentUser'))",
  b64), 'base64').toString('utf8');

/* ---------- Gestione credenziali di Windows (sola lettura, solo voci che riguardano Atlassian/Jira) ---------- */
// Lo script è costante (nessun dato dentro): i parametri passano da variabili d'ambiente. Elenca solo le voci il cui nome
// corrisponde al modello (default "atlassian|jira"): le altre credenziali dell'utente non escono mai da PowerShell.
const WCM_SCRIPT = `$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
public static class Wcm {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct CRED { public uint Flags; public uint Type; public string TargetName; public string Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist; public uint AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CredEnumerateW(string filter, uint flags, out uint count, out IntPtr creds);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CredReadW(string target, uint type, uint flags, out IntPtr cred);
  [DllImport("advapi32.dll")] static extern void CredFree(IntPtr buf);
  static string B64(string s) { return Convert.ToBase64String(Encoding.UTF8.GetBytes(s ?? "")); }
  public static string List(string pattern) {
    uint count; IntPtr creds;
    if (!CredEnumerateW(null, 0, out count, out creds)) return "";
    var lines = new List<string>();
    try {
      for (int i = 0; i < count; i++) {
        IntPtr p = Marshal.ReadIntPtr(creds, i * IntPtr.Size);
        CRED c = (CRED)Marshal.PtrToStructure(p, typeof(CRED));
        if (c.Type == 1 && c.TargetName != null && Regex.IsMatch(c.TargetName, pattern, RegexOptions.IgnoreCase)) lines.Add(B64(c.TargetName) + " " + B64(c.UserName));
      }
    } finally { CredFree(creds); }
    return string.Join("\\n", lines);
  }
  public static string Read(string target, string pattern) {
    if (!Regex.IsMatch(target, pattern, RegexOptions.IgnoreCase)) throw new Exception("not allowed");
    IntPtr p;
    if (!CredReadW(target, 1, 0, out p)) throw new Exception("not found");
    try {
      CRED c = (CRED)Marshal.PtrToStructure(p, typeof(CRED));
      byte[] blob = new byte[c.CredentialBlobSize];
      if (c.CredentialBlobSize > 0) Marshal.Copy(c.CredentialBlob, blob, 0, blob.Length);
      bool utf16 = blob.Length >= 2 && blob.Length % 2 == 0 && blob[1] == 0;
      string s = utf16 ? Encoding.Unicode.GetString(blob) : Encoding.UTF8.GetString(blob);
      return B64(s);
    } finally { CredFree(p); }
  }
}
'@
if ($env:UI_WCM_ACTION -eq 'list') { [Wcm]::List($env:UI_WCM_PATTERN) } else { [Wcm]::Read($env:UI_WCM_TARGET, $env:UI_WCM_PATTERN) }
`;
const wcmPattern = () => process.env.UI_WCM_PATTERN || 'atlassian|jira';
function runWcm(action, extraEnv) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') return reject(new Error('Gestione credenziali di Windows non disponibile su questo sistema.'));
    let script;
    try {
      fs.mkdirSync(dataDir(), { recursive: true });
      script = path.join(dataDir(), 'wcm.ps1');
      if (!fs.existsSync(script) || fs.readFileSync(script, 'utf8') !== WCM_SCRIPT) fs.writeFileSync(script, WCM_SCRIPT);
    } catch (e) { return reject(e); }
    const p = spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true, env: { ...process.env, UI_WCM_ACTION: action, UI_WCM_PATTERN: wcmPattern(), ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { try { p.kill(); } catch { /* già chiuso */ } }, 30000);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve(out.trim()) : reject(new Error('Lettura di Gestione credenziali non riuscita' + (err ? ': ' + err.trim().split('\n')[0] : '.'))); });
  });
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const b64 = (s) => Buffer.from(s, 'base64').toString('utf8');

// Voci di Gestione credenziali che sembrano di Atlassian/Jira: solo nome, utente e sito dedotto (mai la password).
async function discoverWindowsCredentials() {
  let raw = '';
  try { raw = await runWcm('list'); } catch (e) { console.error('[jira] lettura di Gestione credenziali non riuscita:', e.message); return []; } // non blocca la UI, ma l'errore resta visibile nella console
  return raw.split(/\r?\n/).filter(Boolean).map((line) => {
    const [t, u] = line.trim().split(' ');
    const target = b64(t || ''), user = b64(u || '');
    const host = (target.match(/([a-z0-9][a-z0-9-]*\.atlassian\.net)/i) || [])[1];
    return { target, user, emailLike: EMAIL_RE.test(user), host: host ? host.toLowerCase() : null, baseUrl: host ? 'https://' + host.toLowerCase() : null };
  });
}
const wcmCache = new Map(); // target -> token (solo memoria)
async function readWindowsCredential(target, fresh) {
  if (!fresh && wcmCache.has(target)) return wcmCache.get(target);
  let token;
  try { token = b64(await runWcm('read', { UI_WCM_TARGET: target })); } catch { wcmCache.delete(target); throw new Error('La credenziale "' + target + '" non è più in Gestione credenziali di Windows (o non è leggibile).'); }
  wcmCache.set(target, token);
  return token;
}

let tokenCache = null; // { enc, token }: il token in chiaro vive solo in memoria
async function getToken(st, fresh) {
  if (st.config && st.config.source === 'wcm') return readWindowsCredential(st.config.target, fresh);
  if (!st.config || !st.config.tokenEnc) throw new Error('Jira non configurato: inserisci URL, email e API token.');
  if (tokenCache && tokenCache.enc === st.config.tokenEnc) return tokenCache.token;
  let token;
  try { token = await unprotect(st.config.tokenEnc); } catch { throw new Error('Non riesco a decifrare il token salvato (altro utente o altro PC?). Reinseriscilo nella sezione Connessione.'); }
  tokenCache = { enc: st.config.tokenEnc, token };
  return token;
}

/* ---------- URL ---------- */
function parseJiraUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { throw new Error('URL non valido: incolla l\'indirizzo del tuo Jira, ad esempio https://nome.atlassian.net'); }
  if (u.protocol !== 'https:' || !SITE_RE.test(u.hostname)) throw new Error('Serve l\'indirizzo di un sito Jira Cloud: https://<nome>.atlassian.net/…');
  const d = (u.pathname.match(/\/dashboards\/(\d+)/) || [])[1] || u.searchParams.get('selectPageId');
  const b = (u.pathname.match(/\/boards\/(\d+)/) || [])[1] || u.searchParams.get('rapidView');
  const p = (u.pathname.match(/\/projects\/([A-Za-z][A-Za-z0-9_]{1,19})(?:\/|$)/) || [])[1];
  return {
    origin: u.origin,
    dashboardId: d && /^\d+$/.test(d) ? d : null,
    boardId: b && /^\d+$/.test(b) ? b : null,
    projectKey: p && KEY_RE.test(p.toUpperCase()) ? p.toUpperCase() : null,
  };
}

// Le chiamate vanno sempre al sito collegato: un indirizzo di un altro sito darebbe risultati sbagliati.
function assertSameSite(origin) {
  const st = readStore();
  if (st.config && st.config.baseUrl && st.config.baseUrl.toLowerCase() !== String(origin).toLowerCase()) {
    throw new Error('L\'indirizzo appartiene a ' + origin + ', ma sei collegato a ' + st.config.baseUrl + '. Collega prima il sito giusto nella sezione Connessione.');
  }
}

/* ---------- chiamate API ---------- */
function apiError(status, body) {
  if (status === 401) return new Error('Email o API token non validi (o token scaduto).');
  if (status === 403) return new Error('Accesso negato da Jira: il tuo utente non ha il permesso per questa risorsa.');
  if (status === 429) return new Error('Troppe richieste a Jira: riprova tra qualche istante.');
  if (status === 400) {
    const m = [...(body && body.errorMessages || []), ...Object.values(body && body.errors || {})].filter(Boolean).join(' ');
    return new Error(m || 'Richiesta non valida per Jira.');
  }
  return new Error('Jira ha risposto con errore ' + status + '.');
}

async function request(conn, method, apiPath, body) {
  const origin = process.env.UI_JIRA_API ? process.env.UI_JIRA_API.replace(/\/+$/, '') : conn.origin;
  let res;
  try {
    res = await fetch(origin + apiPath, {
      method,
      headers: { Authorization: 'Basic ' + Buffer.from(conn.email + ':' + conn.token).toString('base64'), Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
  } catch (e) {
    throw new Error('Jira non raggiungibile (rete, VPN o proxy): ' + ((e.cause && e.cause.code) || e.message));
  }
  let json = null;
  try { json = await res.json(); } catch { /* corpo vuoto o non JSON */ }
  if (res.ok) return json;
  const err = apiError(res.status, json);
  err.status = res.status;
  throw err;
}
async function api(method, apiPath, body) {
  const st = readStore();
  const token = await getToken(st);
  return request({ origin: st.config.baseUrl, email: st.config.email, token }, method, apiPath, body);
}

/* ---------- configurazione ---------- */
// L'app parte SEMPRE scollegata da Jira: la connessione salvata (token cifrato) resta sul computer e si riattiva con un clic ("Riconnetti"),
// oppure se ne crea una nuova. Il flag vive solo in memoria, quindi a ogni avvio si riparte da zero.
let linked = false;
const hasSaved = (st) => !!(st.config && (st.config.tokenEnc || st.config.source === 'wcm'));
function requireLinked() { if (!linked) throw new Error('Jira non è collegato: premi "Riconnetti" nella scheda Jira (o collega un nuovo account).'); }
function link() { if (!hasSaved(readStore())) throw new Error('Non c\'è nessuna connessione Jira salvata.'); linked = true; return publicState(); }
function unlink() { linked = false; tokenCache = null; wcmCache.clear(); return publicState(); }

function publicState() {
  const st = readStore();
  const has = hasSaved(st);
  return {
    configured: has && linked,
    linked,
    saved: has ? { baseUrl: st.config.baseUrl, email: st.config.email, displayName: st.config.displayName || '', source: st.config.source === 'wcm' ? 'windows' : 'local' } : null,
    source: st.config ? (st.config.source === 'wcm' ? 'windows' : 'local') : '',
    target: st.config && st.config.source === 'wcm' ? st.config.target : '',
    baseUrl: st.config ? st.config.baseUrl : '',
    email: st.config ? st.config.email : '',
    displayName: st.config ? st.config.displayName || '' : '',
    queries: has && linked ? st.queries : [],
  };
}

async function saveConfig({ baseUrl, email, token }) {
  const { origin } = parseJiraUrl(baseUrl);
  const mail = String(email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) throw new Error('Email non valida.');
  const st = readStore();
  let tok = String(token || '').trim();
  if (!tok) {
    if (!st.config || !st.config.tokenEnc) throw new Error('Inserisci l\'API token di Atlassian.'); // con una credenziale di Windows in uso serve un token proprio per passare alla modalità manuale
    tok = await getToken(st); // modifica di URL/email senza reinserire il token
  }
  if (tok.length > 4000 || /[\r\n]/.test(tok)) throw new Error('API token non valido.');
  const me = await request({ origin, email: mail, token: tok }, 'GET', '/rest/api/3/myself');
  st.config = { baseUrl: origin, email: mail, tokenEnc: await protect(tok), displayName: (me && me.displayName) || mail };
  writeStore(st);
  tokenCache = { enc: st.config.tokenEnc, token: tok };
  linked = true;
  return publicState();
}

function removeConfig() {
  const st = readStore();
  st.config = null; tokenCache = null; wcmCache.clear(); linked = false;
  writeStore(st);
  return publicState();
}

// Verifica che quanto già configurato funzioni ancora (token valido, sito raggiungibile, token decifrabile).
// reason: "auth" (credenziali non più valide) | "decrypt" (token non leggibile da questo utente/PC) | "network".
async function verifyConnection() {
  if (!linked) return { configured: false, ok: false, linked: false };
  const st = readStore();
  if (!(st.config && (st.config.tokenEnc || st.config.source === 'wcm'))) return { configured: false, ok: false };
  let token;
  try { token = await getToken(st, true); } catch (e) { return { configured: true, ok: false, reason: st.config.source === 'wcm' ? 'missing' : 'decrypt', message: e.message }; }
  try {
    const me = await request({ origin: st.config.baseUrl, email: st.config.email, token }, 'GET', '/rest/api/3/myself');
    const name = (me && me.displayName) || st.config.email;
    if (name !== st.config.displayName) { st.config.displayName = name; writeStore(st); }
    return { configured: true, ok: true, displayName: name, baseUrl: st.config.baseUrl };
  } catch (e) {
    return { configured: true, ok: false, reason: e.status === 401 || e.status === 403 ? 'auth' : 'network', message: e.message };
  }
}

/* ---------- uso di una credenziale già presente in Windows ---------- */
async function useWindowsCredential({ target, baseUrl, email }) {
  const cands = await discoverWindowsCredentials();
  const c = cands.find((x) => x.target === String(target || ''));
  if (!c) throw new Error('Credenziale non trovata in Gestione credenziali di Windows.');
  const origin = parseJiraUrl(baseUrl || c.baseUrl || '').origin;
  const mail = String(email || (c.emailLike ? c.user : '')).trim();
  if (!EMAIL_RE.test(mail)) throw new Error('Serve l\'email Atlassian: l\'utente della credenziale ("' + c.user + '") non è un indirizzo email.');
  const token = await readWindowsCredential(c.target, true);
  let me;
  try { me = await request({ origin, email: mail, token }, 'GET', '/rest/api/3/myself'); } catch (e) {
    if (e.status === 401) throw new Error('La credenziale di Windows "' + c.target + '" non funziona come API token Jira (potrebbe essere una password o un token scaduto).');
    throw e;
  }
  const st = readStore();
  st.config = { baseUrl: origin, email: mail, source: 'wcm', target: c.target, displayName: (me && me.displayName) || mail };
  writeStore(st);
  linked = true;
  return publicState();
}

// Se non c'è nulla di configurato: cerca in Windows. Una sola voce chiara (sito + email) e funzionante -> la usa da sola.
async function autoConnect() {
  if (publicState().configured) return { used: false, state: publicState(), candidates: [] };
  const candidates = await discoverWindowsCredentials();
  const usable = candidates.filter((c) => c.baseUrl && c.emailLike);
  if (usable.length === 1) {
    try { return { used: true, target: usable[0].target, state: await useWindowsCredential({ target: usable[0].target }), candidates }; } catch (e) { return { used: false, candidates, error: e.message }; }
  }
  return { used: false, candidates };
}

/* ---------- dashboard ---------- */
const digits = (v) => (typeof v === 'number' || typeof v === 'string') && /^\d+$/.test(String(v)) ? String(v) : null;

// Cerca nelle proprietà di un gadget: filtri, progetti e JQL (la forma esatta cambia da gadget a gadget).
function scanProps(value, out, depth = 0) {
  if (depth > 6 || value == null) return;
  if (Array.isArray(value)) { value.forEach((v) => scanProps(v, out, depth + 1)); return; }
  if (typeof value === 'string') {
    const m = value.match(/^(filter|project)-(\d+)$/i);
    if (m) (m[1].toLowerCase() === 'filter' ? out.filterIds : out.projectIds).add(m[2]);
    return;
  }
  if (typeof value !== 'object') return;
  for (const [k, v] of Object.entries(value)) {
    if (/^filterId$|^filter$/i.test(k) && digits(v)) out.filterIds.add(digits(v));
    else if (/^projectId$/i.test(k) && digits(v)) out.projectIds.add(digits(v));
    else if (/^(jql|query)$/i.test(k) && typeof v === 'string') out.jqls.add(v);
    else if (/^(projectKey|project)$/i.test(k) && typeof v === 'string' && KEY_RE.test(v.toUpperCase())) out.projectKeys.add(v.toUpperCase());
    else scanProps(v, out, depth + 1);
  }
}

function projectKeysFromJql(jql) {
  const keys = new Set();
  const re = /\bproject\s*(?:=|==|in)\s*(\([^)]*\)|"[^"]*"|[A-Za-z0-9_]+)/gi;
  let m;
  while ((m = re.exec(String(jql || '')))) {
    for (const part of m[1].replace(/^\(|\)$/g, '').split(',')) {
      const k = part.trim().replace(/^"|"$/g, '').toUpperCase();
      if (KEY_RE.test(k)) keys.add(k);
    }
  }
  return [...keys];
}

async function analyzeDashboard(url) {
  const { dashboardId, origin } = parseJiraUrl(url);
  assertSameSite(origin);
  if (!dashboardId) throw new Error('Nell\'indirizzo non trovo il numero della dashboard (es. https://nome.atlassian.net/jira/dashboards/10001).');
  const notes = [];
  let dash;
  try { dash = await api('GET', '/rest/api/3/dashboard/' + dashboardId); } catch (e) {
    throw e.status === 404 ? new Error('Dashboard non trovata, oppure il tuo utente non può vederla.') : e;
  }
  const found = { filterIds: new Set(), projectIds: new Set(), jqls: new Set(), projectKeys: new Set() };
  let gadgets = [];
  try { gadgets = ((await api('GET', '/rest/api/3/dashboard/' + dashboardId + '/gadget')) || {}).gadgets || []; } catch { notes.push('Non riesco a leggere i gadget di questa dashboard.'); }
  for (const g of gadgets.slice(0, 30)) {
    try {
      const keys = (((await api('GET', `/rest/api/3/dashboard/${dashboardId}/items/${g.id}/properties`)) || {}).keys || []).slice(0, 6);
      for (const k of keys) {
        const p = await api('GET', `/rest/api/3/dashboard/${dashboardId}/items/${g.id}/properties/${encodeURIComponent(k.key)}`);
        scanProps(p && p.value, found);
      }
    } catch { /* gadget senza proprietà leggibili */ }
  }
  const filters = [];
  for (const id of [...found.filterIds].slice(0, 20)) {
    try { const f = await api('GET', '/rest/api/3/filter/' + id); filters.push({ id, name: f.name, jql: f.jql || '' }); found.jqls.add(f.jql || ''); } catch { /* filtro non visibile */ }
  }
  for (const id of [...found.projectIds].slice(0, 20)) {
    try { const p = await api('GET', '/rest/api/3/project/' + id); if (p && p.key) found.projectKeys.add(String(p.key).toUpperCase()); } catch { /* progetto non visibile */ }
  }
  for (const j of found.jqls) projectKeysFromJql(j).forEach((k) => found.projectKeys.add(k));
  const projects = [];
  for (const key of [...found.projectKeys].slice(0, 20)) {
    let name = '';
    try { name = ((await api('GET', '/rest/api/3/project/' + encodeURIComponent(key))) || {}).name || ''; } catch { continue; } // chiave non valida o non visibile: scartata
    projects.push({ key, name });
  }
  if (!projects.length) notes.push('Dai gadget non riesco a ricavare il progetto: inseriscine la chiave a mano (es. ABC).');
  return { dashboard: { id: dashboardId, name: dash.name || ('Dashboard ' + dashboardId), description: dash.description || '' }, projects, filters, notes };
}

/* ---------- board (Agile API) ---------- */
// La board non è leggibile con l'API Agile: per Jira 404 significa "non esiste OPPURE non la vedi" (board privata, permessi,
// Jira Software non abilitato per l'utente). Se l'indirizzo contiene il progetto si prosegue da quello, altrimenti si spiega.
async function boardFallback(boardId, projectKey, status) {
  const st = readStore();
  const who = st.config ? st.config.email + ' su ' + st.config.baseUrl : 'questo sito';
  const why = status === 403 ? 'accesso negato' : 'Jira risponde 404';
  if (projectKey) {
    try {
      const p = await api('GET', '/rest/api/3/project/' + encodeURIComponent(projectKey));
      return {
        board: { id: boardId, name: 'Board ' + boardId, type: '', projectKey },
        filter: null, projects: [{ key: projectKey, name: (p && p.name) || '' }], columns: [], scrum: false,
        notes: ['La board ' + boardId + ' non è leggibile con l\'API di Jira (' + why + ' per ' + who + '): uso il progetto ' + projectKey + '. Succede se la board è privata di un altro utente, se non hai accesso a Jira Software o se l\'indirizzo non è di questa board. Tipi e stati si scelgono comunque dal progetto; filtro e sprint della board non sono disponibili.'],
      };
    } catch { /* anche il progetto non è visibile: errore dettagliato qui sotto */ }
  }
  throw new Error('Jira non trova la board ' + boardId + (projectKey ? ' né il progetto ' + projectKey : '') + ' per ' + who + ' (' + why + '). Controlla di essere collegato al sito giusto e con l\'utente che vede quella board: apri lo stesso indirizzo nel browser con quell\'utente.');
}

// Legge una board Scrum/Kanban: nome, tipo, filtro che ne definisce i ticket, progetti coinvolti e colonne con i loro stati.
async function analyzeBoard(url) {
  const { boardId, projectKey, origin } = parseJiraUrl(url);
  assertSameSite(origin);
  if (!boardId) throw new Error('Nell\'indirizzo non trovo il numero della board (es. https://nome.atlassian.net/jira/software/projects/ABC/boards/12).');
  const notes = [];
  let board;
  try { board = await api('GET', '/rest/agile/1.0/board/' + boardId); } catch (e) {
    if (e.status !== 404 && e.status !== 403) throw e;
    return boardFallback(boardId, projectKey, e.status);
  }
  let cfg = {};
  try { cfg = (await api('GET', '/rest/agile/1.0/board/' + boardId + '/configuration')) || {}; } catch { notes.push('Non riesco a leggere la configurazione della board: filtro e colonne non sono disponibili.'); }
  let filter = null;
  const filterId = cfg.filter && digits(cfg.filter.id);
  if (filterId) {
    try { const f = await api('GET', '/rest/api/3/filter/' + filterId); filter = { id: filterId, name: f.name || '', jql: f.jql || '' }; } catch { notes.push('Il filtro della board non è leggibile dal tuo utente: userò il progetto.'); }
  }
  if (cfg.subQuery && cfg.subQuery.query) notes.push('La board ha anche un filtro rapido di base (' + cfg.subQuery.query + '): non è incluso nella query.');
  const keys = new Set();
  if (board.location && board.location.projectKey && KEY_RE.test(String(board.location.projectKey).toUpperCase())) keys.add(String(board.location.projectKey).toUpperCase());
  if (projectKey) keys.add(projectKey);
  if (filter) projectKeysFromJql(filter.jql).forEach((k) => keys.add(k));
  const projects = [];
  for (const key of [...keys].slice(0, 20)) {
    try { const p = await api('GET', '/rest/api/3/project/' + encodeURIComponent(key)); projects.push({ key, name: (p && p.name) || '' }); } catch { /* chiave non valida o non visibile */ }
  }
  // colonne -> nomi degli stati (gli id arrivano dalla configurazione)
  const names = new Map();
  const columns = [];
  for (const col of ((cfg.columnConfig && cfg.columnConfig.columns) || []).slice(0, 20)) {
    const sts = [];
    for (const s of (col.statuses || []).slice(0, 30)) {
      const id = digits(s.id);
      if (!id) continue;
      if (!names.has(id)) { try { names.set(id, ((await api('GET', '/rest/api/3/status/' + id)) || {}).name || ''); } catch { names.set(id, ''); } }
      if (names.get(id)) sts.push(names.get(id));
    }
    columns.push({ name: col.name || '', statuses: sts });
  }
  if (!projects.length) notes.push('Dalla board non riesco a ricavare il progetto: inseriscine la chiave a mano (es. ABC).');
  return {
    board: { id: boardId, name: board.name || cfg.name || ('Board ' + boardId), type: board.type || cfg.type || '', projectKey: (board.location && board.location.projectKey) || projectKey || '' },
    filter, projects, columns, scrum: String(board.type || cfg.type).toLowerCase() === 'scrum', notes,
  };
}

// Dall'indirizzo si capisce da solo se è una board o una dashboard.
async function analyzeSource(url) {
  const p = parseJiraUrl(url);
  if (p.boardId) return { kind: 'board', ...(await analyzeBoard(url)) };
  if (p.dashboardId) return { kind: 'dashboard', ...(await analyzeDashboard(url)) };
  throw new Error('Nell\'indirizzo non trovo né una board né una dashboard. Apri la board in Jira e copia l\'indirizzo dalla barra del browser (es. …/jira/software/projects/ABC/boards/12).');
}

/* ---------- progetti: tipi di ticket e stati ---------- */
async function projectMeta(keys) {
  const list = [...new Set((Array.isArray(keys) ? keys : []).map((k) => String(k).trim().toUpperCase()))];
  if (!list.length || list.length > 10) throw new Error('Scegli da 1 a 10 progetti.');
  for (const k of list) if (!KEY_RE.test(k)) throw new Error('Chiave di progetto non valida: ' + k);
  const types = new Map(); // nome tipo -> { subtask, statuses:Set }
  const statuses = new Map(); // nome stato -> Set(tipi)
  const projects = [];
  for (const key of list) {
    let rows;
    try { rows = await api('GET', `/rest/api/3/project/${encodeURIComponent(key)}/statuses`); } catch (e) {
      throw e.status === 404 ? new Error('Progetto "' + key + '" non trovato (o non visibile al tuo utente).') : e;
    }
    projects.push(key);
    for (const t of rows || []) {
      if (!types.has(t.name)) types.set(t.name, { subtask: !!t.subtask, statuses: new Set() });
      for (const s of t.statuses || []) {
        types.get(t.name).statuses.add(s.name);
        if (!statuses.has(s.name)) statuses.set(s.name, new Set());
        statuses.get(s.name).add(t.name);
      }
    }
  }
  return {
    projects,
    types: [...types].map(([name, v]) => ({ name, subtask: v.subtask, statuses: [...v.statuses] })).sort((a, b) => a.name.localeCompare(b.name)),
    statuses: [...statuses].map(([name, ts]) => ({ name, types: [...ts] })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/* ---------- JQL ---------- */
const q = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
function buildJql({ projects, types, statuses, filterId, sprint }) {
  const clean = (a) => (Array.isArray(a) ? [...new Set(a.map((x) => String(x).trim()).filter(Boolean))] : []);
  const ps = clean(projects).map((k) => k.toUpperCase()), ts = clean(types), ss = clean(statuses);
  for (const k of ps) if (!KEY_RE.test(k)) throw new Error('Chiave di progetto non valida: ' + k);
  for (const x of [...ts, ...ss]) if (x.length > 100 || /[\u0000-\u001f]/.test(x)) throw new Error('Valore non valido: ' + x.slice(0, 40));
  const fid = filterId == null || filterId === '' ? '' : String(filterId);
  if (fid && !/^\d+$/.test(fid)) throw new Error('Filtro della board non valido.');
  const sp = sprint == null ? '' : String(sprint);
  if (!['', 'active', 'backlog'].includes(sp)) throw new Error('Sprint non valido.');
  const parts = [];
  if (fid) parts.push('filter = ' + fid); // i ticket della board = il filtro che la definisce
  else if (ps.length === 1) parts.push('project = ' + ps[0]); else if (ps.length > 1) parts.push('project in (' + ps.join(', ') + ')');
  if (sp === 'active') parts.push('sprint in openSprints()'); else if (sp === 'backlog') parts.push('sprint is EMPTY');
  if (ts.length) parts.push('issuetype in (' + ts.map(q).join(', ') + ')');
  if (ss.length) parts.push('status in (' + ss.map(q).join(', ') + ')');
  if (!parts.length) throw new Error('Scegli almeno un progetto, un tipo o uno stato.');
  return parts.join(' AND ') + ' ORDER BY updated DESC';
}

/* ---------- ricerca e dettaglio ---------- */
const mapIssue = (i, origin) => ({
  key: i.key,
  summary: (i.fields && i.fields.summary) || '',
  type: (i.fields && i.fields.issuetype && i.fields.issuetype.name) || '',
  status: (i.fields && i.fields.status && i.fields.status.name) || '',
  statusCategory: (i.fields && i.fields.status && i.fields.status.statusCategory && i.fields.status.statusCategory.key) || '',
  priority: (i.fields && i.fields.priority && i.fields.priority.name) || '',
  assignee: (i.fields && i.fields.assignee && i.fields.assignee.displayName) || '',
  updated: (i.fields && i.fields.updated) || '',
  url: origin + '/browse/' + i.key,
});

function checkJql(jql) {
  const s = String(jql || '').trim();
  if (!s || s.length > 4000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s)) throw new Error('JQL vuota o non valida.');
  return s;
}

// nextPage: token opaco (nextPageToken della nuova API oppure "s:<startAt>" per la vecchia). Il vecchio endpoint è un ripiego.
async function search({ jql, nextPage, max }) {
  const query = checkJql(jql);
  const st = readStore();
  const origin = st.config ? st.config.baseUrl : '';
  const maxResults = Math.min(Math.max(Number(max) || 50, 1), 100);
  const legacy = typeof nextPage === 'string' && nextPage.startsWith('s:');
  let r;
  if (!legacy) {
    try {
      r = await api('POST', '/rest/api/3/search/jql', { jql: query, maxResults, fields: FIELDS, ...(nextPage ? { nextPageToken: nextPage } : {}) });
      return { issues: (r.issues || []).map((i) => mapIssue(i, origin)), nextPage: r.nextPageToken || null, jql: query };
    } catch (e) {
      if (e.status !== 404 && e.status !== 410) throw e; // endpoint non disponibile: ripiego sul vecchio
    }
  }
  const startAt = legacy ? Number(nextPage.slice(2)) || 0 : 0;
  r = await api('POST', '/rest/api/3/search', { jql: query, maxResults, startAt, fields: FIELDS });
  const got = (r.issues || []).length;
  return { issues: (r.issues || []).map((i) => mapIssue(i, origin)), nextPage: startAt + got < (r.total || 0) && got ? 's:' + (startAt + got) : null, total: r.total, jql: query };
}

// Atlassian Document Format -> testo semplice (per leggere la descrizione e passarla alla pipeline).
function adfToText(node) {
  const NL = '\n';
  const inline = (n) => {
    if (!n) return '';
    if (n.type === 'text') {
      let t = n.text || '';
      for (const m of n.marks || []) {
        if (m.type === 'code') t = '`' + t + '`';
        else if (m.type === 'strong') t = '**' + t + '**';
        else if (m.type === 'em') t = '*' + t + '*';
        else if (m.type === 'link' && m.attrs && m.attrs.href && m.attrs.href !== t) t = t + ' (' + m.attrs.href + ')';
      }
      return t;
    }
    if (n.type === 'hardBreak') return NL;
    if (n.type === 'mention') return (n.attrs && n.attrs.text) || '@utente';
    if (n.type === 'emoji') return (n.attrs && (n.attrs.text || n.attrs.shortName)) || '';
    if (n.type === 'inlineCard') return (n.attrs && n.attrs.url) || '';
    if (n.type === 'status') return '[' + ((n.attrs && n.attrs.text) || '') + ']';
    if (n.type === 'date' && n.attrs && n.attrs.timestamp) return new Date(Number(n.attrs.timestamp)).toISOString().slice(0, 10);
    if (n.type === 'media' || n.type === 'mediaInline') return '[allegato: ' + ((n.attrs && (n.attrs.alt || n.attrs.id)) || 'file') + ']';
    return (n.content || []).map(inline).join('');
  };
  const block = (n, indent) => {
    if (!n) return '';
    const kids = n.content || [];
    switch (n.type) {
      case 'doc': return kids.map((k) => block(k, '')).filter((x) => x !== '').join(NL + NL);
      case 'paragraph': return indent + kids.map(inline).join('');
      case 'heading': return '#'.repeat((n.attrs && n.attrs.level) || 1) + ' ' + kids.map(inline).join('');
      case 'bulletList': return kids.map((li) => item(li, indent, '- ')).join(NL);
      case 'orderedList': return kids.map((li, i) => item(li, indent, (((n.attrs && n.attrs.order) || 1) + i) + '. ')).join(NL);
      case 'codeBlock': return '```' + NL + kids.map(inline).join('') + NL + '```';
      case 'blockquote': return kids.map((k) => block(k, '')).join(NL).split(NL).map((l) => '> ' + l).join(NL);
      case 'rule': return '---';
      case 'panel': return kids.map((k) => block(k, '')).join(NL);
      case 'table': return kids.map((row) => (row.content || []).map((c) => (c.content || []).map((k) => block(k, '')).join(' ').replace(/\s+/g, ' ').trim()).join(' | ')).join(NL);
      case 'mediaSingle': case 'mediaGroup': return kids.map(inline).join(' ');
      default: return indent + kids.map(inline).join('');
    }
  };
  const item = (li, indent, bullet) => {
    const [first, ...rest] = li.content || [];
    const head = indent + bullet + (first ? block(first, '') : '');
    const tail = rest.map((k) => (/List$/.test(k.type) ? block(k, indent + '  ') : indent + '  ' + block(k, '')));
    return [head, ...tail].join(NL);
  };
  return block(node && node.type === 'doc' ? node : { type: 'doc', content: node ? [node] : [] }, '').trim();
}

async function issueDetail(key) {
  const k = String(key || '').trim().toUpperCase();
  if (!ISSUE_RE.test(k)) throw new Error('Chiave ticket non valida: ' + String(key).slice(0, 30));
  const st = readStore();
  const i = await api('GET', '/rest/api/3/issue/' + encodeURIComponent(k) + '?fields=summary,description,status,issuetype,priority,assignee,reporter,labels,components,created,updated,attachment');
  const f = i.fields || {};
  const desc = f.description;
  return {
    ...mapIssue(i, st.config.baseUrl),
    description: typeof desc === 'string' ? desc : adfToText(desc),
    reporter: (f.reporter && f.reporter.displayName) || '',
    labels: f.labels || [],
    components: (f.components || []).map((c) => c.name),
    created: f.created || '',
    attachments: (f.attachment || []).map((a) => ({ name: a.filename, size: a.size })),
  };
}

/* ---------- query salvate ---------- */
function saveQuery({ name, jql, projects, types, statuses, dashboardUrl, filterId, sprint, boardName }) {
  const n = String(name || '').trim();
  if (!n || n.length > 80 || /[\u0000-\u001f]/.test(n)) throw new Error('Dai un nome alla query (max 80 caratteri).');
  const query = checkJql(jql);
  const st = readStore();
  if (st.queries.length >= MAX_QUERIES) throw new Error('Troppe query salvate (massimo ' + MAX_QUERIES + '): eliminane qualcuna.');
  const clean = (a) => (Array.isArray(a) ? a.map(String).slice(0, 100) : []);
  const entry = { id: crypto.randomBytes(6).toString('hex'), name: n, jql: query, projects: clean(projects), types: clean(types), statuses: clean(statuses), dashboardUrl: String(dashboardUrl || '').slice(0, 300), filterId: /^\d+$/.test(String(filterId || '')) ? String(filterId) : '', sprint: ['active', 'backlog'].includes(sprint) ? sprint : '', boardName: String(boardName || '').slice(0, 120), createdAt: new Date().toISOString() };
  st.queries.push(entry);
  writeStore(st);
  return entry;
}
function deleteQuery(id) {
  const st = readStore();
  const before = st.queries.length;
  st.queries = st.queries.filter((x) => x.id !== String(id));
  if (st.queries.length === before) throw new Error('Query non trovata.');
  writeStore(st);
  return st.queries;
}
function getQuery(id) {
  const x = readStore().queries.find((q2) => q2.id === String(id));
  if (!x) throw new Error('Query non trovata.');
  return x;
}

module.exports = {
  link, unlink, requireLinked, publicState, saveConfig, removeConfig, verifyConnection, discoverWindowsCredentials, useWindowsCredential, autoConnect, analyzeDashboard, analyzeBoard, analyzeSource, projectMeta, buildJql, search, issueDetail,
  saveQuery, deleteQuery, getQuery,
  // esposti per i test
  parseJiraUrl, scanProps, projectKeysFromJql, adfToText, protect, unprotect, storeFile,
};
