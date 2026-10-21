'use strict';
// Simulatore di `claude -p` (stream-json) per la modalità Demo. Non tocca file né rete: emette solo eventi.
// Turno 1: profilo → branch → ticket → analisi → domanda. Turno 2 (dopo la risposta): esplorazione → codice → compilazione → controllo → test.
const rl = require('readline').createInterface({ input: process.stdin });
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const text = (t) => out({ type: 'assistant', message: { content: [{ type: 'text', text: t }] } });
let n = 0;
const tool = (name, input) => { const id = 'd' + (++n); out({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } }); return id; };
const done = (id, outText) => out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: outText || '', is_error: false }] } });
// velocità: 1 = ritmo base; di default la demo va a metà (0.5) per dare il tempo di seguire. DEMO_SPEED=1 per il ritmo base, 2 per il doppio.
const K = 1 / (Number(process.env.DEMO_SPEED) || 0.5);
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.round(ms * K)));
const result = (extra) => out({ type: 'result', total_cost_usd: 0, is_error: false, permission_denials: [], session_id: 'demo', ...extra });


// Messaggi parziali come quelli della vera CLI (--include-partial-messages): testo e parametri delle azioni arrivano a pezzetti.
const sse = (event) => out({ type: 'stream_event', event, session_id: 'demo', parent_tool_use_id: null });
async function streamText(t) {
  sse({ type: 'message_start', message: {} });
  sse({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
  for (let p = 0; p < t.length; p += 14) { sse({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t.slice(p, p + 14) } }); await sleep(28); }
  sse({ type: 'content_block_stop', index: 0 });
}
async function say(t) { await streamText(t); text(t); }
async function toolS(name, input) {
  const id = 'd' + (++n);
  sse({ type: 'message_start', message: {} });
  sse({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id, name, input: {} } });
  const j = JSON.stringify(input);
  for (let p = 0; p < j.length; p += 12) { sse({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: j.slice(p, p + 12) } }); await sleep(16); }
  sse({ type: 'content_block_stop', index: 0 });
  out({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
  return id;
}

// un'azione = chiamata + pausa + chiusura
async function act(name, input, ms = 600, outText = '') { const id = await toolS(name, input); await sleep(ms); done(id, outText); }
// uno step = agente con le sue azioni
async function step(agent, description, fn) { const id = await toolS('Agent', { subagent_type: agent, description }); await sleep(500); await fn(); done(id); await sleep(300); }

let key = 'DEMO-101', title = 'Ticket di esempio', turn = 0, busy = false;
const cls = () => key.replace('-', '_');

async function turn1() {
  await say('**Modalità Demo** — questa è una simulazione: nessun file, ticket o repository reale viene toccato.\n\nLeggo il profilo del progetto e preparo il lavoro su **' + key + '**.');
  await act('Read', { file_path: 'Demo Portal/.claude/project-profile.md' }, 800);

  await step('test-git-branch', 'Prepara il branch di lavoro', async () => {
    await act('Bash', { command: 'git status --short' }, 700, ' M src/test/java/demo/PrenotazioniActions.java\n?? .tmp/');
    await act('Bash', { command: 'git checkout -b feature/' + key }, 900, "Switched to a new branch 'feature/" + key + "'");
  });

  await step('test-ticket-fetcher', 'Recupera il ticket da Jira', async () => {
    await act('Bash', { command: 'Invoke-RestMethod https://demo.atlassian.net/rest/api/3/issue/' + key }, 1200, 'key     : ' + key + '\nsummary : ' + title + '\nstatus  : To Do\ntype    : Test');
  });
  await say('Ticket recuperato: **' + key + ' — ' + title + '**. Passo all\'analisi dello scenario.');

  await step('test-analyzer', 'Analizza il ticket e cerca i pezzi già pronti', async () => {
    for (const f of ['PortalTest.java', 'LoginActions.java', 'PrenotazioniPage.java', 'PrenotazioniActions.java', 'DEMO_103.java']) await act('Read', { file_path: 'src/test/java/demo/' + f }, 650);
    await act('Grep', { pattern: 'Brontolo|creaPrenotazione', path: 'src/test' }, 700);
    await act('Glob', { pattern: 'src/test/**/*Actions.java' }, 500);
  });

  await say([
    '## Scenario verificato',
    '',
    'Ho confrontato lo scenario di **' + key + '** con i test già presenti nel progetto:',
    '',
    '| Elemento | Esito | Nota |',
    '|---|---|---|',
    '| Login | Riuso | `LoginActions.login()` già disponibile |',
    '| Apertura dell\'elenco | Riuso | `PrenotazioniPage` |',
    '| Passo specifico del ticket | **Da scrivere** | serve un nuovo metodo nelle Actions |',
    '',
    '### Cosa farò',
    '',
    '1. Esplorare l\'applicazione per trovare i selettori reali',
    '2. Scrivere il test `' + cls() + '` e il metodo mancante',
    '3. Compilare, controllare il test e lanciarlo',
    '',
    '> Il test usa l\'applicazione in modo reale: **posso procedere con l\'esplorazione?** Rispondi "sì" (o scrivi cosa cambiare).',
  ].join('\n'));
  result();
}

async function turn2() {
  await say('Procedo con l\'esplorazione dell\'applicazione.');
  await step('test-explorer', 'Esplora l\'applicazione dal vivo', async () => {
    await act('mcp__playwright__browser_navigate', { url: 'https://portal.demo.example' }, 900);
    await act('mcp__playwright__browser_snapshot', {}, 700);
    await act('mcp__playwright__browser_type', { text: 'utente.demo' }, 600);
    await act('mcp__playwright__browser_click', { element: 'Accedi' }, 700);
    await act('mcp__playwright__browser_wait_for', { time: 1 }, 600);
    await act('mcp__playwright__browser_click', { element: 'Prenotazioni' }, 700);
    await act('mcp__playwright__browser_snapshot', {}, 700);
    await act('mcp__playwright__browser_take_screenshot', {}, 600);
  });
  await say('Ho raccolto i selettori e i tempi di attesa reali. Scrivo il test.');

  await step('test-coder', 'Scrive pagina, azioni e test', async () => {
    await act('Read', { file_path: 'src/test/java/demo/PrenotazioniActions.java' }, 600);
    await act('Edit', { file_path: 'src/test/java/demo/PrenotazioniActions.java', old_string: '    // TODO: passo specifico', new_string: '    public void passoDelTicket() {\n        click(PrenotazioniPage.PULSANTE_CREA);\n        waitVisible(PrenotazioniPage.FORM_PRENOTAZIONE);\n    }' }, 900, 'The file src/test/java/demo/PrenotazioniActions.java has been updated.');
    await act('Write', { file_path: 'src/test/java/demo/' + cls() + '.java', content: 'package demo;\n\npublic class ' + cls() + ' extends PortalTest {\n\n    @Test\n    public void ' + cls().toLowerCase() + '() {\n        LoginActions.login();\n        PrenotazioniActions.apriElenco();\n        PrenotazioniActions.passoDelTicket();\n        assertVisible(PrenotazioniPage.NOTIFICA_OK);\n    }\n}\n' }, 1000, 'File created successfully at: src/test/java/demo/' + cls() + '.java');
    await act('Edit', { file_path: 'TestSuites/Portal.xml' }, 700);
  });

  await step('test-compile-checker', 'Compila il progetto', async () => {
    await act('Bash', { command: 'mvn -q test-compile' }, 2200, '');
  });

  await step('test-validator', 'Controlla il test rispetto al ticket', async () => {
    await act('Read', { file_path: 'src/test/java/demo/' + cls() + '.java' }, 800);
    await act('Grep', { pattern: 'assert', path: 'src/test/java/demo' }, 600);
  });

  const sk = await toolS('Skill', { skill: 'run-test' }); await sleep(400);
  await act('Bash', { command: 'mvn test -Dtest=' + cls() }, 3200, '[INFO] Running demo.' + cls() + '\n[INFO] Tests run: 1, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: 38.2 s\n[INFO] BUILD SUCCESS');
  done(sk);

  await say([
    '## Esito',
    '',
    '| Fase | Risultato |',
    '|---|---|',
    '| Compilazione | ✅ riuscita |',
    '| Controllo del test | ✅ coerente con il ticket |',
    '| Esecuzione | ✅ **1 test superato** in 38 s |',
    '',
    'Il test `' + cls() + '` è pronto. *(Demo: nessun file è stato realmente creato.)*',
  ].join('\n'));
  result();
}

rl.on('line', async (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (busy) return;
  busy = true;
  try {
    if (turn === 0) {
      const msg = String((m.message && m.message.content) || '');
      const k = msg.match(/\b[A-Z][A-Z0-9_]{1,19}-\d+\b/); if (k) key = k[0];
      const t = msg.split('\n')[0].match(/[—–-]\s+(.+)$/); if (t) title = t[1].trim().slice(0, 120);
      turn = 1; await turn1();
    } else if (turn === 1) { turn = 2; await turn2(); }
    else { text('La demo è conclusa: avvia una nuova esecuzione per rivederla.'); result(); }
  } finally { busy = false; }
});
