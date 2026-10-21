// Gestione dei processi figli: terminare un processo con tutti i suoi discendenti.
'use strict';
const { spawn } = require('child_process');

// Su Windows `claude` e gli strumenti partono con shell:true: per fermarli davvero serve taskkill /T (l'intero albero).
function killTree(p) {
  if (!p) return;
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true });
    else p.kill('SIGTERM');
  } catch { /* già terminato */ }
}

module.exports = { killTree };
