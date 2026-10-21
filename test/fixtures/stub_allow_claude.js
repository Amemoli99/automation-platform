// Finto claude per i permessi e le domande a margine.
//  - sessione normale: risponde al primo messaggio con un comando negato (permission_denials) e resta in attesa;
//  - riavviato con --resume (permesso concesso): registra gli argomenti, risponde senza negazioni e termina;
//  - con --fork-session (Ask Claude): risponde con un JSON di una riga e termina.
const fs = require('fs');
const args = process.argv.slice(2);
const log = (o) => { try { fs.appendFileSync(process.env.STUB_LOG, JSON.stringify(o) + '\n'); } catch { /* nessun log */ } };
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
let buf = '';
process.stdin.on('data', (d) => {
  buf += d;
  if (args.includes('--fork-session')) return; // la domanda arriva con stdin.end()
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    log({ args, input: JSON.parse(line).message.content.slice(0, 80) });
    out({ type: 'system', subtype: 'init', session_id: 'sess1' });
    if (args.includes('--resume')) {
      out({ type: 'result', is_error: false, total_cost_usd: 0, permission_denials: [], session_id: 'sess1' });
      setTimeout(() => process.exit(0), 300);
    } else {
      out({ type: 'result', is_error: false, total_cost_usd: 0, permission_denials: [{ tool_name: 'Bash', tool_input: { command: 'mvn test' } }], session_id: 'sess1' });
    }
  }
});
process.stdin.on('end', () => {
  if (!args.includes('--fork-session')) return;
  log({ args, question: buf.slice(-40) });
  out({ result: 'Risposta di prova', is_error: false });
  process.exit(0);
});
