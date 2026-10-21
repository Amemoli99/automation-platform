// Credenziali dei server MCP (variabili come JIRA_API_TOKEN): salvate cifrate con Windows DPAPI (solo l'utente Windows corrente può leggerle)
// in un file FUORI dal repository (%APPDATA%\developerTest-UI\mcp-env.json), chiave = progetto + server + nome variabile.
// Nel .mcp.json restano solo i segnaposto ${VAR}; i valori arrivano a `claude` e al client MCP del Cockpit come variabili d'ambiente.
// I valori non vengono mai restituiti al browser (solo "impostata / non impostata") né scritti nei log.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ENTROPY = 'developerTest-UI/mcp-env';
const VAR_RE = /^[A-Za-z_][A-Za-z0-9_]{1,63}$/;
const SERVER_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const dataDir = () => process.env.UI_DATA_DIR || path.join(process.env.APPDATA || os.homedir(), 'developerTest-UI');
const storeFile = () => path.join(dataDir(), 'mcp-env.json');
const key = (root) => path.resolve(root).toLowerCase();

function readStore() {
  try { const j = JSON.parse(fs.readFileSync(storeFile(), 'utf8')); return j && typeof j === 'object' && !Array.isArray(j) ? j : {}; } catch { return {}; }
}
function writeStore(s) {
  fs.mkdirSync(dataDir(), { recursive: true });
  const tmp = storeFile() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, storeFile());
}

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
const PS = (op) => "Add-Type -AssemblyName System.Security; $s=[Console]::In.ReadToEnd().Trim(); $b=[Convert]::FromBase64String($s); $e=[Text.Encoding]::UTF8.GetBytes('" + ENTROPY + "'); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::" + op + "($b,$e,'CurrentUser'))";
const protect = (secret) => powershell(PS('Protect'), Buffer.from(secret, 'utf8').toString('base64'));
const unprotect = async (b64) => Buffer.from(await powershell(PS('Unprotect'), b64), 'base64').toString('utf8');

const cache = new Map(); // progetto -> { SERVER: { VAR: valore } } (in memoria, mai su disco in chiaro)

function checkServer(server) { if (!SERVER_RE.test(String(server || ''))) throw new Error('Nome del server non valido.'); return String(server); }

// Quali variabili sono impostate (solo sì/no).
function status(root, server) {
  checkServer(server);
  const s = readStore()[key(root)];
  const mine = s && s[server] ? s[server] : {};
  return Object.fromEntries(Object.keys(mine).map((k) => [k, true]));
}
async function set(root, server, values) {
  checkServer(server);
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('Valori non validi.');
  const store = readStore();
  const k = key(root);
  store[k] = store[k] || {};
  store[k][server] = store[k][server] || {};
  const c = cache.get(k) || {};
  c[server] = c[server] || {};
  for (const [name, raw] of Object.entries(values)) {
    if (!VAR_RE.test(name)) throw new Error('Nome di variabile non valido: ' + name);
    const v = String(raw == null ? '' : raw);
    if (v.length > 4000 || /[\u0000-\u001f]/.test(v)) throw new Error('Valore non valido per ' + name + ' (massimo 4000 caratteri, una sola riga).');
    if (!v) { delete store[k][server][name]; delete c[server][name]; continue; } // vuoto = rimuove
    store[k][server][name] = await protect(v);
    c[server][name] = v;
  }
  if (!Object.keys(store[k][server]).length) delete store[k][server];
  if (!Object.keys(store[k]).length) delete store[k];
  cache.set(k, c);
  writeStore(store);
  return status(root, server);
}
// Decifra tutte le variabili del progetto in memoria (chiamare prima di avviare processi).
async function warm(root) {
  if (!root) return;
  const k = key(root);
  const s = readStore()[k];
  if (!s) { cache.delete(k); return; }
  const out = {};
  for (const [server, vars] of Object.entries(s)) {
    out[server] = {};
    for (const [name, enc] of Object.entries(vars)) { try { out[server][name] = await unprotect(enc); } catch { /* altro utente/PC: la variabile risulta non leggibile */ } }
  }
  cache.set(k, out);
}
// Variabili d'ambiente da aggiungere ai processi (tutte quelle del progetto): sincrono, usa la cache.
function cached(root) {
  if (!root) return {};
  const c = cache.get(key(root));
  const env = {};
  if (c) for (const vars of Object.values(c)) Object.assign(env, vars);
  return env;
}
function forServer(root, server) {
  const c = cache.get(key(root));
  return c && c[server] ? { ...c[server] } : {};
}

module.exports = { status, set, warm, cached, forServer, VAR_RE, SERVER_RE };
