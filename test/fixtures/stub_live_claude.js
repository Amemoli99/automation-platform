// finto claude per la prova della diretta: messaggi parziali con un token spezzato, comando con segreti e risultato con segreti e codici colore
const TOKEN = 'ghp_' + 'abcdefghijklmnopqrstuvwxyz0123456789';
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const sse = (event, parent) => out({ type: 'stream_event', event, session_id: 's1', parent_tool_use_id: parent || null });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
process.stdin.once('data', async () => {
  out({ type: 'system', subtype: 'init', session_id: 's1' });
  // 1) testo con token spezzato su piu pezzi e con un valore del .env
  const parts = ['Uso il token ', TOKEN.slice(0, 8), TOKEN.slice(8, 20), TOKEN.slice(20), ' e la password Segr3to', 'DiProva99 per accedere.'];
  sse({ type: 'message_start', message: {} });
  sse({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
  for (const p of parts) { sse({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: p } }); await sleep(180); }
  sse({ type: 'content_block_stop', index: 0 });
  out({ type: 'assistant', message: { content: [{ type: 'text', text: parts.join('') }] } });
  // 2) azione Bash con segreti nel comando, parametri a pezzetti
  const cmd = 'curl -H "Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345" https://api.esempio.it --user admin:Segr3toDiProva99';
  const json = JSON.stringify({ command: cmd, description: 'Chiama il servizio' });
  sse({ type: 'message_start', message: {} });
  sse({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu1', name: 'Bash', input: {} } });
  for (let i = 0; i < json.length; i += 9) { sse({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: json.slice(i, i + 9) } }); await sleep(60); }
  sse({ type: 'content_block_stop', index: 0 });
  out({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: cmd, description: 'Chiama il servizio' } }] } });
  await sleep(300);
  // 3) risultato con codici colore, segreti e righe lunghe
  const big = Array.from({ length: 400 }, (_, i) => 'riga ' + i + ' ' + 'x'.repeat(40)).join('\n');
  out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: [{ type: 'text', text: '\u001b[32mOK\u001b[0m APP_PASSWORD=Segr3toDiProva99 token=' + TOKEN + '\n' + big + '\nAPP_PASSWORD=Segr3toDiProva99 fine' }], is_error: false }] } });
  // 4) un Write con codice
  const wj = JSON.stringify({ file_path: 'src/A.java', content: 'class A {\n  String k = "x";\n}\n' });
  sse({ type: 'message_start', message: {} });
  sse({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu2', name: 'Write', input: {} } });
  for (let i = 0; i < wj.length; i += 10) { sse({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: wj.slice(i, i + 10) } }); await sleep(40); }
  sse({ type: 'content_block_stop', index: 0 });
  out({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu2', name: 'Write', input: JSON.parse(wj) }] } });
  out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu2', content: 'File created successfully', is_error: false }] } });
  out({ type: 'result', total_cost_usd: 0, is_error: false, permission_denials: [], session_id: 's1' });
  setTimeout(() => process.exit(0), 300);
});
