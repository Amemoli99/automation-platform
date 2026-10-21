// Testi mostrati "in diretta" nella scheda Esecuzione (cosa scrive Claude, parametri delle azioni, output dei comandi): prima di uscire dal server
// passano da qui, che toglie i codici colore e maschera i segreti. Zero dipendenze.
'use strict';

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g;
const PATTERNS = [
  /ghp_[A-Za-z0-9]{20,}/g, /github_pat_[A-Za-z0-9_]{20,}/g, /gh[ousr]_[A-Za-z0-9]{20,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g, /AKIA[0-9A-Z]{16}/g, /\bsk-[A-Za-z0-9_-]{20,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{16,}/gi,
  /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // JWT
];
// chiave = valore, dove il nome della chiave suggerisce un segreto (PASSWORD=..., api_key: ..., token=...)
const ASSIGN = /\b([A-Za-z0-9_.-]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API[_-]?KEY|CREDENTIAL)[A-Za-z0-9_.-]*)(\s*[:=]\s*)(["']?)([^\s"']{4,})\3/gi;
// Durante la scrittura in diretta il testo è ancora incompleto: la CODA (ciò che sta arrivando) non si mostra se potrebbe essere l'inizio di un segreto.
const PREFIX_TAIL = /(ghp_|github_pat_|gh[ousr]_|xox[baprs]-|AKIA|\bsk-|eyJ)[A-Za-z0-9_.-]*$/;
const BEARER_TAIL = /\b(Bearer|Basic)(\s+)[A-Za-z0-9._~+/=-]*$/i;
const ASSIGN_TAIL = /\b([A-Za-z0-9_.-]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API[_-]?KEY|CREDENTIAL)[A-Za-z0-9_.-]*)(\s*[:=]\s*)(["']?)[^\s"']*$/i;
// Se la fine del testo è l'inizio di un valore segreto noto (la password che si sta scrivendo), la si nasconde.
function maskKnownTail(s, values) {
  for (const v of values) {
    if (!v || v.length < 6) continue;
    for (let k = Math.min(v.length - 1, 60); k >= 3; k--) if (s.endsWith(v.slice(0, k))) return s.slice(0, s.length - k) + '***';
  }
  return s;
}

// opts.values: valori segreti noti da mascherare alla lettera (variabili d'ambiente, .env); opts.live: testo ancora in scrittura.
function redact(text, opts = {}) {
  let s = String(text == null ? '' : text).replace(ANSI, '');
  for (const v of opts.values || []) if (v && v.length >= 6) s = s.split(v).join('***');
  for (const re of PATTERNS) s = s.replace(re, '***');
  s = s.replace(ASSIGN, (m, k, sep) => k + sep + '***');
  if (opts.live) {
    s = maskKnownTail(s, opts.values || []);
    s = s.replace(PREFIX_TAIL, (m, p) => p + '…').replace(BEARER_TAIL, (m, k, sp) => k + sp + '***').replace(ASSIGN_TAIL, (m, k, sep) => k + sep + '***');
  }
  return s;
}

/* ---------- parametri delle azioni mentre il JSON è ancora incompleto ---------- */
const ESC = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
const unescapeJson = (s) => s.replace(/\\(?:u([0-9a-fA-F]{4})|(["\\/bfnrt]))/g, (m, u, c) => (u ? String.fromCharCode(parseInt(u, 16)) : ESC[c]));
// Stringhe di primo livello "chiave": "valore" anche se il valore non è ancora chiuso (si prende ciò che c'è finora).
function scanStrings(raw) {
  const out = {};
  const re = /"([A-Za-z_]\w*)"\s*:\s*"((?:[^"\\]|\\[\s\S])*)/g;
  let m;
  while ((m = re.exec(raw))) if (!(m[1] in out)) out[m[1]] = unescapeJson(m[2].replace(/\\$/, ''));
  return out;
}
const lines = (s, p) => String(s).split('\n').map((l) => p + l).join('\n');

// Titolo e corpo da mostrare per un'azione, secondo il tool. Mai segreti: il chiamante passa tutto da redact().
function describeTool(name, raw) {
  const f = scanStrings(raw);
  const pick = (...ks) => { for (const k of ks) if (f[k]) return f[k]; return ''; };
  if (name === 'Bash') return { title: pick('command'), body: pick('description') ? '# ' + pick('description') : '' };
  if (name === 'Write') return { title: pick('file_path'), body: pick('content') };
  if (name === 'Edit') return { title: pick('file_path'), body: [f.old_string ? lines(f.old_string, '- ') : '', f.new_string ? lines(f.new_string, '+ ') : ''].filter(Boolean).join('\n') };
  const title = pick('file_path', 'pattern', 'command', 'skill', 'subagent_type', 'url', 'element', 'query', 'description', 'text');
  if (title) return { title, body: pick('prompt', 'args') };
  return { title: '', body: raw.length > 600 ? raw.slice(0, 600) + '…' : raw }; // altri tool: parametri così come arrivano
}

module.exports = { redact, scanStrings, describeTool };
