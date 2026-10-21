'use strict';
// Licenze firmate offline e profili utente.
// Una licenza è un file firmato (Ed25519) con organizzazione, utente, profilo, PC e scadenza. La verifica usa la chiave PUBBLICA
// qui sotto; la chiave privata resta solo a chi emette le licenze (tools/license.js) e non va mai nel kit né in git.
// Senza server una licenza non si può revocare prima della scadenza: per questo si usano scadenze brevi.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// Scritta da `node tools/license.js keygen --embed`. null = licenze non configurate (modalità sviluppo: tutto consentito).
const PUBLIC_KEY_PEM = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAMtC+NQbkR7wcWpO47yCmOZOXcSzWVlg2gU/ImwYJjsw=\n-----END PUBLIC KEY-----\n";

// Permessi. Il progetto e Jira sono personali (il repository e il token di chi usa il PC): per questo "project.select" e "jira.connect"
// servono anche a chi non è Administrator. Riservati all'Administrator: configurazione (permessi della pipeline, profilo), creazione di
// nuovi progetti e operazioni git sui branch principali.
const ALL_CAPS = ['view', 'run', 'git.write', 'git.push', 'git.protected', 'project.select', 'project.create', 'jira.connect', 'config.edit', 'ide.open', 'demo'];
const ROLES = {
  admin: { label: 'Administrator', caps: ['*'] },
  tester: { label: 'Tester', caps: ['view', 'run', 'git.write', 'git.push', 'project.select', 'jira.connect', 'ide.open', 'demo'] },
  viewer: { label: 'Viewer', caps: ['view', 'project.select', 'jira.connect', 'ide.open'] },
  demo: { label: 'Demo', caps: ['view', 'demo'] },
};
const MACHINE_RE = /^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/;
const MAX_FILE = 20000;
const DAY = 86400000;

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (s) => Buffer.from(String(s), 'base64url');

/* ---------- codice del PC ---------- */
let machineCache = null;
function machineCode() {
  if (machineCache) return machineCache;
  let raw = '';
  if (process.platform === 'win32') {
    try {
      const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
      const m = /MachineGuid\s+REG_SZ\s+(\S+)/i.exec(out);
      if (m) raw = m[1];
    } catch { /* ripiego sotto */ }
  }
  if (!raw) raw = os.hostname() + '|' + os.userInfo().username;
  const h = crypto.createHash('sha256').update('developerTest-UI|' + raw.toLowerCase()).digest('hex').slice(0, 16).toUpperCase();
  machineCache = h.match(/.{4}/g).join('-');
  return machineCache;
}

/* ---------- firma e verifica ---------- */
function generateKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return { publicPem: publicKey.export({ type: 'spki', format: 'pem' }), privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
}

// Emette il testo del file di licenza. Usato da tools/license.js.
function issue({ privatePem, org, user, email, role, machine, days, now = Date.now() }) {
  const clean = (v, max, label) => { const s = String(v || '').trim(); if (!s || s.length > max || /[\u0000-\u001f]/.test(s)) throw new Error(`${label}: valore mancante o non valido.`); return s; };
  if (!ROLES[role]) throw new Error('Profilo non valido: usa ' + Object.keys(ROLES).join(', ') + '.');
  const m = String(machine || '').trim().toUpperCase();
  if (!MACHINE_RE.test(m)) throw new Error('Codice PC non valido: deve essere nel formato XXXX-XXXX-XXXX-XXXX.');
  const d = Number(days);
  if (!Number.isInteger(d) || d < 1 || d > 1100) throw new Error('Durata non valida: da 1 a 1100 giorni.');
  const payload = {
    v: 1, id: crypto.randomBytes(6).toString('hex'),
    org: clean(org, 80, 'Organizzazione'), user: clean(user, 80, 'Utente'), email: clean(email, 120, 'Email'),
    role, machine: m, issued: new Date(now).toISOString(), expires: new Date(now + d * DAY).toISOString(),
  };
  const body = b64u(JSON.stringify(payload));
  const sig = crypto.sign(null, Buffer.from(body), crypto.createPrivateKey(privatePem));
  return JSON.stringify({ format: 'dtui-license', payload: body, sig: b64u(sig) }, null, 2) + '\n';
}

const fail = (reason, message) => ({ ok: false, reason, message });

// Verifica firma, formato, PC e scadenza. Non legge né scrive file.
function verifyText(text, { pubPem, now = Date.now(), machine = machineCode() } = {}) {
  if (typeof text !== 'string' || !text.trim() || text.length > MAX_FILE) return fail('format', 'Il file non è una licenza valida.');
  let file;
  try { file = JSON.parse(text); } catch { return fail('format', 'Il file non è una licenza valida.'); }
  if (!file || file.format !== 'dtui-license' || typeof file.payload !== 'string' || typeof file.sig !== 'string') return fail('format', 'Il file non è una licenza valida.');
  let okSig = false;
  try { okSig = crypto.verify(null, Buffer.from(file.payload), crypto.createPublicKey(pubPem), unb64u(file.sig)); } catch { okSig = false; }
  if (!okSig) return fail('signature', 'Firma non valida: la licenza non è stata emessa da chi ne ha l\'autorità, oppure è stata modificata.');
  let p;
  try { p = JSON.parse(unb64u(file.payload).toString('utf8')); } catch { return fail('format', 'Il contenuto della licenza è illeggibile.'); }
  if (!p || p.v !== 1 || !ROLES[p.role] || !MACHINE_RE.test(String(p.machine || ''))) return fail('format', 'La licenza ha un formato non riconosciuto.');
  const exp = Date.parse(p.expires), iss = Date.parse(p.issued);
  if (!Number.isFinite(exp) || !Number.isFinite(iss)) return fail('format', 'Le date della licenza non sono valide.');
  if (p.machine !== machine) return fail('machine', 'Questa licenza è stata emessa per un altro PC.');
  if (now < iss - DAY) return fail('notyet', 'La licenza non è ancora valida: controlla data e ora del PC.');
  if (now > exp) return fail('expired', 'La licenza è scaduta il ' + new Date(exp).toLocaleDateString('it-IT') + '.');
  return { ok: true, data: p, expires: exp };
}

/* ---------- stato corrente ---------- */
const { dataDir } = require('../../infra/paths');
const licenseFile = () => path.join(dataDir(), 'license.json');
const seenFile = () => path.join(dataDir(), 'license-seen.json');

// La chiave di prova per i test vale solo con UI_AUTH=off (modalità test, che stampa un avviso all'avvio).
function publicKey() {
  if (process.env.UI_AUTH === 'off' && process.env.UI_LICENSE_PUB_PEM) { try { return fs.readFileSync(process.env.UI_LICENSE_PUB_PEM, 'utf8'); } catch { return null; } }
  return PUBLIC_KEY_PEM;
}

const expandCaps = (role) => (ROLES[role].caps.includes('*') ? ALL_CAPS.slice() : ROLES[role].caps.slice());
function baseState(role, extra) {
  return { role, roleLabel: ROLES[role].label, caps: expandCaps(role), machineCode: machineCode(), licensed: false, dev: false, reason: '', message: '', ...extra };
}

let cache = { at: 0, state: null };
function invalidate() { cache = { at: 0, state: null }; }

function compute(now = Date.now()) {
  const pub = publicKey();
  if (!pub) return baseState('admin', { configured: false, dev: true, message: 'Licenze non configurate (modalità sviluppo): tutte le funzioni sono consentite. Genera le chiavi con "node tools/license.js keygen --embed" prima di distribuire l\'app.' });
  const st = { configured: true };
  let text = '';
  try { text = fs.readFileSync(licenseFile(), 'utf8'); } catch { return baseState('demo', { ...st, reason: 'missing', message: 'Nessuna licenza: sono disponibili solo le funzioni Demo. Importa il file di licenza.' }); }
  // protezione elementare contro l'orologio spostato indietro per allungare una licenza
  let seen = 0;
  try { seen = Number(JSON.parse(fs.readFileSync(seenFile(), 'utf8')).t) || 0; } catch { /* prima verifica */ }
  if (seen && now < seen - DAY) return baseState('demo', { ...st, reason: 'clock', message: 'L\'orologio del PC risulta spostato indietro: ripristina data e ora corrette per usare la licenza.' });
  const v = verifyText(text, { pubPem: pub, now });
  if (!v.ok) return baseState('demo', { ...st, reason: v.reason, message: v.message });
  try { fs.mkdirSync(dataDir(), { recursive: true }); fs.writeFileSync(seenFile(), JSON.stringify({ t: Math.max(seen, now) })); } catch { /* non blocca */ }
  const p = v.data;
  return baseState(p.role, {
    ...st, licensed: true, id: p.id, org: p.org, user: p.user, email: p.email, issued: p.issued, expires: p.expires,
    daysLeft: Math.max(0, Math.ceil((v.expires - now) / DAY)),
  });
}
function current() {
  const now = Date.now();
  if (!cache.state || now - cache.at > 15000) cache = { at: now, state: compute(now) };
  return cache.state;
}

// Salva una licenza dopo averla verificata. Lancia un errore con il motivo se non è valida.
function importText(text) {
  const pub = publicKey();
  if (!pub) throw new Error('Le licenze non sono configurate su questa installazione.');
  const v = verifyText(text, { pubPem: pub });
  if (!v.ok) throw new Error(v.message);
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(licenseFile(), text.trim() + '\n', { mode: 0o600 });
  invalidate();
  return current();
}

// Un permesso è concesso dal profilo; in Demo (simulazione su progetto di prova) si aggiungono i permessi per provare il prodotto.
const DEMO_EXTRA = ['view', 'run', 'git.write'];
function allows(state, cap, inDemo) {
  if (!cap) return true;
  if (cap === 'admin') return state.role === 'admin'; // funzioni senza un permesso dedicato: solo l'Administrator
  if (state.caps.includes(cap)) return true;
  return !!inDemo && DEMO_EXTRA.includes(cap);
}

module.exports = { ROLES, ALL_CAPS, MACHINE_RE, machineCode, generateKeypair, issue, verifyText, current, invalidate, importText, allows, publicKey };
