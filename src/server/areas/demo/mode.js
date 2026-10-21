// Entrata e uscita dalla modalità Demo: sostituiscono temporaneamente il progetto con uno simulato e avvisano la sessione ('reset').
const demo = require('./demo');
const projects = require('../project').projects;
const jira = require('../jira').jira;
const { state } = require('../../state');

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

module.exports = { demoEnter, demoLeave };
