// Unico punto da cui l'app lancia la CLI `claude` (UI_CLAUDE_BIN permette ai test di sostituirla con un finto).
'use strict';
const { spawn } = require('child_process');

const claudeBin = () => process.env.UI_CLAUDE_BIN || 'claude';

// shell:true serve su Windows per risolvere claude.cmd; gli args sono costanti, il testo dell'utente va via stdin.
// Le opzioni (cwd, env, stdio, windowsHide) restano a chi chiama, perché ogni uso ha esigenze proprie.
function spawnClaude(args, opts = {}) {
  return spawn(claudeBin(), args, { shell: true, ...opts });
}

module.exports = { claudeBin, spawnClaude };
