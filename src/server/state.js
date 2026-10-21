// Stato dell'applicazione per utente: progetto agganciato, recenti, origini Git, scelte per progetto, modalità Demo.
// Sta fuori dal kit (così non finisce nello zip): %APPDATA%\developerTest-UI\active-project.json
// Lo stato è un oggetto unico (`state`): chi lo usa legge e scrive i campi, e salva con saveState().
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const paths = require('./infra/paths');

const STATE_FILE = process.env.UI_STATE_FILE || path.join(paths.dataDir(), 'active-project.json');
const savedState = (() => { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; } })();
const isDir = (d) => { try { return typeof d === 'string' && path.isAbsolute(d) && fs.statSync(d).isDirectory(); } catch { return false; } };
// Cartella di lavoro: dove vivono di norma i progetti (default per i clone e per i nuovi progetti).
const WORKSPACE = (() => {
  const w = process.env.UI_WORKSPACE || savedState.workspace;
  if (isDir(w)) return w;
  const d = path.join(os.homedir(), 'IdeaProjects');
  return isDir(d) ? d : os.homedir();
})();

const state = {
  // Progetto attivo: la cartella in cui gira `claude` e di cui si leggono permessi e profilo. null = nessun progetto agganciato: va scelto dalla scheda Progetto.
  root: isDir(savedState.root) ? savedState.root : null,
  recent: (Array.isArray(savedState.recent) ? savedState.recent : []).filter(isDir).slice(0, 8), // progetti agganciati di recente
  // Scelta della skill (e dei suoi argomenti) per progetto: { "<percorso>": { skill, args } }
  prefs: savedState.prefs && typeof savedState.prefs === 'object' ? savedState.prefs : {},
  // Repository Maven del framework di test: lo indica l'utente al primo progetto e l'app lo ricorda (UI_FRAMEWORK_REPO per forzarlo).
  frameworkRepo: process.env.UI_FRAMEWORK_REPO || (typeof savedState.frameworkRepo === 'string' ? savedState.frameworkRepo : ''),
  demo: null, // modalità Demo attiva: { prevRoot, base, restore }
  workspace: WORKSPACE,
  running: false, // la sessione di claude è in corso (la imposta session.js)
  events: new EventEmitter(), // 'reset': progetto o modalità Demo cambiati, la sessione riparte da zero (session.js ascolta)
};

const prefsFor = (dir) => (dir && state.prefs[String(dir).toLowerCase()]) || {};
// Si riscrive il file conservando le chiavi che questo modulo non gestisce (es. le origini Git delle versioni precedenti, che l'area scm migra al primo uso):
// altrimenti salvare lo stato prima della migrazione le cancellerebbe.
const saveState = () => {
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) || {}; } catch { /* primo salvataggio */ }
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify({ ...prev, root: state.demo ? state.demo.prevRoot : state.root, recent: state.recent, prefs: state.prefs, frameworkRepo: state.frameworkRepo }));
};
const needRoot = () => {
  if (!state.root) throw new Error('Nessun progetto agganciato: scegline uno dalla scheda Progetto.');
  return state.root;
};

module.exports = { state, isDir, prefsFor, saveState, needRoot };
