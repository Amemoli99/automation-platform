// Report di diagnostica esportabile (Markdown), da allegare a una richiesta di supporto.
// NON contiene: token, credenziali, valori di variabili d'ambiente, query Jira, conversazioni, codice o contenuto dei ticket.
// Contiene: versione/build, strumenti del computer, stato del progetto e dei suoi tool (solo nomi), licenza (senza nome ed email), sessioni (solo stato).
// Come ultima barriera, tutto il testo passa da redact(): percorso personale -> "~" e qualunque cosa somigli a un segreto -> "[redatto]".
const os = require('os');

const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{10,}/g,
  /\bATATT[A-Za-z0-9_=-]{20,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/gi,
];
const KEY_VALUE = /\b([A-Za-z0-9_]*(?:api[_-]?key|token|secret|passw(?:or)?d|credential)[A-Za-z0-9_]*)\s*[:=]\s*(?!\$\{)(\S{6,})/gi;

function redact(text) {
  let t = String(text);
  const home = os.homedir();
  if (home) {
    const esc = home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    t = t.replace(new RegExp(esc.replace(/\\\\/g, '[\\\\/]'), 'gi'), '~').replace(new RegExp(esc.replace(/\\\\/g, '/'), 'gi'), '~');
  }
  for (const re of SECRET_PATTERNS) t = t.replace(re, '[redatto]');
  t = t.replace(KEY_VALUE, (m, k) => k + '=[redatto]');
  return t;
}

const ICON = { ok: '[OK]', warn: '[!]', fail: '[X]' };
const one = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const mark = (s) => ICON[s] || '[-]';

// Ogni sezione è indipendente: se un dato non è disponibile lo si scrive, il report non fallisce.
function section(lines, title, fn) {
  lines.push('', '## ' + title, '');
  try { fn(); } catch (e) { lines.push('_Non disponibile: ' + one(e && e.message).slice(0, 160) + '_'); }
}

function build(d) {
  const L = [];
  const gen = (d.now || new Date()).toISOString();
  L.push('# Report di diagnostica — Nexsoft Automation Cockpit Platform', '', 'Generato il ' + gen + '.', '',
    '> Questo report non contiene token, credenziali, valori di variabili d\'ambiente, query Jira, conversazioni né codice. Riporta solo versioni, stato e nomi.');

  section(L, 'Applicazione', () => {
    const a = d.app || {};
    L.push('- Versione: **' + (a.version || '?') + '**' + (a.edition ? ' (' + a.edition + ')' : ''));
    L.push('- Build: `' + (a.build || '?') + '` (impronta dei file) · ultima modifica ai file: ' + (a.builtAt || '?') + ' · file: ' + (a.files != null ? a.files : '?'));
    L.push('- Modalità: ' + (d.demo ? 'Demo (dati simulati)' : 'normale'));
  });

  section(L, 'Computer', () => {
    L.push('- Sistema: ' + process.platform + ' ' + os.release() + ' (' + os.arch() + ')');
    L.push('- Node.js: ' + process.version);
    L.push('- Processori: ' + os.cpus().length + ' · memoria: ' + Math.round(os.totalmem() / 1048576 / 1024 * 10) / 10 + ' GB');
    L.push('- Fuso orario: ' + Intl.DateTimeFormat().resolvedOptions().timeZone);
    L.push('- ANTHROPIC_API_KEY impostata: ' + (process.env.ANTHROPIC_API_KEY ? 'sì (le sessioni vanno a consumo)' : 'no'));
    L.push('- JAVA_HOME: ' + (process.env.JAVA_HOME || 'non impostata'));
  });

  section(L, 'Strumenti e ambiente', () => {
    for (const r of d.diag || []) {
      L.push('- ' + mark(r.status) + ' **' + one(r.label) + '**' + (r.detail ? ' — ' + one(r.detail) : '') + (r.hint && r.status !== 'ok' ? ' _(' + one(r.hint) + ')_' : ''));
    }
    if (!(d.diag || []).length) L.push('_Nessun dato._');
  });

  section(L, 'Progetto', () => {
    const p = d.project || {};
    if (!p.attached) { L.push('Nessun progetto agganciato.'); return; }
    L.push('- Nome: **' + one(p.name) + '**');
    L.push('- Percorso: `' + one(p.dir) + '`');
    L.push('- Skill da lanciare: ' + (p.skill ? '`/' + p.skill + '`' : 'non scelta') + (p.args ? ' · argomenti: `' + one(p.args) + '`' : ''));
    L.push('- JDK scelto per il progetto: ' + (p.jdk ? '`' + one(p.jdk) + '`' : 'quello del computer'));
    L.push('- Step mostrati nell\'interfaccia: ' + (p.steps != null ? p.steps : '?'));
    L.push('', '**Controlli sul progetto**', '');
    for (const i of p.items || []) L.push('- ' + mark(i.status) + ' ' + one(i.label) + (i.detail ? ' — ' + one(i.detail) : ''));
  });

  section(L, 'Tool del progetto', () => {
    const t = d.tools;
    if (!t) { L.push('_Non letti._'); return; }
    L.push('**Programmi**', '');
    for (const p of t.programs || []) L.push('- ' + mark(p.status) + ' ' + one(p.label) + ': ' + one(p.detail));
    if (!t.project) return;
    L.push('', '**Server MCP** (' + ((t.mcp && t.mcp.servers) || []).length + ')', '');
    for (const s of (t.mcp && t.mcp.servers) || []) {
      L.push('- `' + one(s.name) + '` · ' + one(s.type) + (s.runtime ? ' · ' + one(s.runtime) : '') + ' · ' + (s.enabled === true ? 'abilitato' : s.enabled === false ? 'disabilitato' : 'da approvare') + ' · permessi: ' + one(s.permissions) + (s.envNames && s.envNames.length ? ' · variabili richieste: ' + s.envNames.join(', ') : ''));
    }
    if (t.mcp && t.mcp.error) L.push('- ' + one(t.mcp.error));
    L.push('', '**Skill** (' + (t.skills || []).length + '): ' + ((t.skills || []).map((s) => s.name + (s.origin === 'kit' ? ' [kit]' : '')).join(', ') || '—'));
    L.push('', '**Comandi** (' + (t.commands || []).length + '): ' + ((t.commands || []).map((c) => c.name).join(', ') || '—'));
    L.push('', '**Agent** (' + (t.agents || []).length + '): ' + ((t.agents || []).map((a) => a.name).join(', ') || '—'));
    const ev = {};
    for (const h of t.hooks || []) ev[h.event] = (ev[h.event] || 0) + 1;
    L.push('', '**Hook** (' + (t.hooks || []).length + '): ' + (Object.entries(ev).map(([k, v]) => k + ' ×' + v).join(', ') || '—'));
    L.push('', '**Script** (' + (t.files || []).length + '): ' + ((t.files || []).map((f) => f.path).join(', ') || '—'));
  });

  section(L, 'Licenza', () => {
    const l = d.license;
    if (!l) { L.push('_Non letta._'); return; }
    L.push('- Stato: ' + (l.licensed ? 'valida' : (l.dev ? 'modalità sviluppo (senza licenze)' : 'non valida' + (l.reason ? ' (' + one(l.reason) + ')' : ''))));
    L.push('- Profilo: ' + one(l.roleLabel || l.role) + ' · organizzazione: ' + one(l.org || '—'));
    if (l.expires) L.push('- Scade il ' + String(l.expires).slice(0, 10) + (l.daysLeft != null ? ' (' + l.daysLeft + ' giorni)' : ''));
    if (l.machineCode) L.push('- Codice del PC: `' + one(l.machineCode) + '`');
  });

  section(L, 'Jira', () => {
    const j = d.jira || {};
    L.push('- Collegamento configurato: ' + (j.configured ? 'sì (' + (j.source === 'wcm' ? 'Gestione credenziali di Windows' : 'token cifrato con Windows') + ')' : 'no'));
  });

  section(L, 'Sessioni', () => {
    const s = d.session || {};
    L.push('- Stato corrente: ' + (s.status || 'sconosciuto'));
    for (const r of s.runs || []) L.push('- Esecuzione ' + one(r.id) + ': ' + one(r.status) + (r.ticket ? ' · ' + one(r.ticket) : '') + (r.branch ? ' · branch ' + one(r.branch) : ''));
  });

  return redact(L.join('\n') + '\n');
}

module.exports = { build, redact };
