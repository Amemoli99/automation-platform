// Cambio del progetto agganciato: aggiorna lo stato e avvisa la sessione con l'evento 'reset' (state.events), senza conoscere session.
const fs = require('fs');
const projects = require('./projects');
const { state, saveState } = require('../../state');

function activate(dir) {
  if (state.running) throw new Error('Termina la sessione in corso prima di cambiare progetto');
  const full = projects.validDir(dir, { mustBeEmptyOrMissing: false });
  if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) throw new Error('Cartella non trovata');
  state.root = full;
  state.recent = [full, ...state.recent.filter((x) => x !== full)].slice(0, 8);
  saveState();
  state.events.emit('reset');
}

// Sgancia il progetto corrente (resta tra i recenti): la sessione riparte da zero.
function detach() {
  if (state.running) throw new Error('Termina la sessione in corso prima di sganciare il progetto');
  if (!state.root) return;
  state.recent = [state.root, ...state.recent.filter((x) => x !== state.root)].slice(0, 8);
  state.root = null;
  saveState();
  state.events.emit('reset');
}

module.exports = { activate, detach };
