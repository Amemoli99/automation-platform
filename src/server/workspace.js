// Cambio di progetto e modalità Demo: modificano lo stato e avvisano la sessione con l'evento 'reset' (state.events),
// senza che nessuno debba conoscere session.js. Qui si orchestrano progetti, Jira e Demo: è un punto di collegamento, non un'area.
const fs = require('fs');
const projects = require('./services/projects');
const jira = require('./services/jira');
const demo = require('./services/demo');
const { state, saveState } = require('./state');

function demoEnter() {
  if (state.demo) return;
  if (state.running) throw new Error('Termina la sessione in corso prima di entrare in modalità Demo');
  const d = demo.create({ projects, jira });
  state.demo = { prevRoot: state.root, base: d.base, restore: d.restore };
  state.root = d.dir;
  state.events.emit('reset');
}

function demoLeave() {
  if (!state.demo) return;
  if (state.running) throw new Error('Termina la sessione in corso prima di uscire dalla modalità Demo');
  const d = state.demo; state.demo = null;
  state.root = d.prevRoot;
  d.restore(); demo.cleanup(d.base);
  state.events.emit('reset');
}
process.on('exit', () => { if (state.demo) demo.cleanup(state.demo.base); });

function activate(dir) {
  if (state.running) throw new Error('Termina la sessione in corso prima di cambiare progetto');
  const full = projects.validDir(dir, { mustBeEmptyOrMissing: false });
  if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) throw new Error('Cartella non trovata');
  state.root = full;
  state.recent = [full, ...state.recent.filter((x) => x !== full)].slice(0, 8);
  saveState();
  state.events.emit('reset');
}

module.exports = { demoEnter, demoLeave, activate };
