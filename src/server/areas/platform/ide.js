// Apertura di file del progetto in IntelliJ IDEA.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// IntelliJ IDEA: UI_IDEA_BIN, poi le installazioni più comuni su Windows (la più recente per prima).
let ideaBin;
function findIdea() {
  if (ideaBin !== undefined) return ideaBin;
  const cands = [];
  if (process.env.UI_IDEA_BIN) cands.push(process.env.UI_IDEA_BIN);
  const sub = (dir, re) => { try { return fs.readdirSync(dir).filter((n) => re.test(n)).sort().reverse().map((n) => path.join(dir, n)); } catch { return []; } };
  for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean)) {
    for (const d of sub(path.join(base, 'JetBrains'), /^IntelliJ IDEA/i)) cands.push(path.join(d, 'bin', 'idea64.exe'));
  }
  if (process.env.LOCALAPPDATA) {
    for (const d of sub(path.join(process.env.LOCALAPPDATA, 'Programs'), /^IntelliJ IDEA/i)) cands.push(path.join(d, 'bin', 'idea64.exe'));
    const tb = path.join(process.env.LOCALAPPDATA, 'JetBrains', 'Toolbox', 'apps');
    for (const app of sub(tb, /^(IDEA|intellij)/i)) for (const ch of sub(app, /^ch-/)) for (const v of sub(ch, /^\d/)) cands.push(path.join(v, 'bin', 'idea64.exe'));
  }
  ideaBin = cands.find((c) => { try { return fs.statSync(c).isFile(); } catch { return false; } }) || null;
  return ideaBin;
}
// Apre un file (o una cartella) del progetto in IntelliJ, alla riga indicata. Nessuna shell: argomenti passati come array.
function openInIde(root, rel, line) {
  const bin = findIdea();
  if (!bin) throw new Error('IntelliJ IDEA non trovato. Installalo oppure imposta la variabile UI_IDEA_BIN con il percorso di idea64.exe e riavvia la UI.');
  const full = path.resolve(root, String(rel || ''));
  const back = path.relative(root, full);
  if (back.startsWith('..') || path.isAbsolute(back)) throw new Error('Il file non è dentro il progetto.');
  if (!fs.existsSync(full)) throw new Error('Il file non esiste (ancora) nel progetto: ' + (back || String(rel)).replace(/\\/g, '/'));
  const n = Number(line);
  const args = [root, ...(Number.isInteger(n) && n > 0 && n < 10000000 ? ['--line', String(n)] : []), full];
  const p = spawn(bin, args, { detached: true, stdio: 'ignore' });
  p.on('error', () => { ideaBin = undefined; });
  p.unref();
  return { ok: true, ide: path.basename(path.dirname(path.dirname(bin))) };
}

module.exports = { openInIde };
