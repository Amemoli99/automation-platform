// Rete di sicurezza per il refactor del server: chiama le rotte "sicure" (nessun effetto esterno) e confronta stato HTTP e messaggio
// con quelli registrati in routes-golden.json. Per rigenerare il file dopo una modifica voluta: node test/run.js flow --record
//   node test/flow/routes-probe.js <base> <root-del-progetto> [--record]
'use strict';
const fs = require('fs');
const path = require('path');

const base = process.argv[2];
const root = process.argv[3].replace(/\\/g, '/');
const record = process.argv.includes('--record');
const GOLDEN = path.join(__dirname, 'routes-golden.json');
const h = { 'Content-Type': 'application/json', Origin: base };

// [metodo, url, corpo]. Sono escluse le rotte che aprono finestre, lanciano claude, usano la rete o modificano file fuori dal progetto di prova.
const ROUTES = [
  ['GET', '/api/license'], ['GET', '/api/demo'], ['GET', '/api/steps'], ['GET', '/api/project'], ['GET', '/api/repos/sources'],
  ['GET', '/api/jira/state'], ['GET', '/api/jira/verify'], ['GET', '/api/project/inspect'], ['GET', '/api/project/pipeline'],
  ['GET', '/api/claude/login'], ['GET', '/api/config'], ['GET', '/api/mcp/servers'], ['GET', '/api/mcp/panel?server=nessuno'],
  ['GET', '/api/mcp/ask-active?server=nessuno'], ['GET', '/api/mcp/ask-status?id=x'], ['GET', '/api/pipelines/fix-active?kind=agent&name=x'],
  ['GET', '/api/pipelines'], ['GET', '/api/pipelines/steps?skill=implementTest'], ['GET', '/api/pipelines/link-preview?skill=implementTest&agent=test-coder'],
  ['GET', '/api/pipelines/fix-status?id=x'], ['GET', '/api/pipelines/item?kind=agent&name=test-coder'], ['GET', '/api/version'],
  ['GET', '/api/tools/catalog'], ['GET', '/api/tools'], ['GET', '/api/tools/mcp-status'], ['POST', '/api/tools/add', { type: 'zzz', id: 'x' }], ['POST', '/api/tools/add', { type: 'mcp', id: 'Non valido!' }], ['GET', '/api/jdks'], ['GET', '/api/non-esiste'], ['GET', '/non-esiste.html'],
  ['GET', '/'], ['GET', '/mcp.html'], ['GET', '/pipelines.html'], ['GET', '/mcpview.js'],
  ['POST', '/api/license/import', { text: '' }], ['POST', '/api/send', { text: 'x' }], ['POST', '/api/stop', {}], ['POST', '/api/btw', { question: 'ciao' }],
  ['POST', '/api/allow', { rules: [] }], ['POST', '/api/tests/existing', { keys: ['NX-1', 'x'] }], ['POST', '/api/pipeline/preview', { ticket: 'NX-1 prova' }],
  ['POST', '/api/config/permissions', { allow: ['Read'] }], ['POST', '/api/mcp/tools', { server: 'nessuno' }], ['POST', '/api/mcp/mode', { server: 'nessuno', mode: 'x' }],
  ['POST', '/api/mcp/call', { server: 'nessuno', tool: 'x' }], ['POST', '/api/mcp/stop', { server: 'nessuno' }], ['POST', '/api/mcp/panel/delete', { server: 'nessuno' }],
  ['POST', '/api/mcp/ask-cancel', { id: 'x' }], ['POST', '/api/pipelines/save', {}], ['POST', '/api/pipelines/agent', {}], ['POST', '/api/pipelines/skill', {}],
  ['POST', '/api/pipelines/steps', {}], ['POST', '/api/pipelines/fix-cancel', { id: 'x' }], ['POST', '/api/pipelines/link', {}], ['POST', '/api/pipelines/skill-steps', {}],
  ['POST', '/api/jira/search', { jql: 'x' }], ['POST', '/api/jira/issue', { key: 'X-1' }], ['POST', '/api/jira/jql', {}], ['POST', '/api/jira/queries', {}],
  ['POST', '/api/jira/queries/delete', { id: 'x' }], ['POST', '/api/jira/meta', {}], ['POST', '/api/jira/dashboard', {}], ['POST', '/api/jira/source', {}],
  ['POST', '/api/jira/unlink', {}], ['POST', '/api/jira/config/remove', {}], ['POST', '/api/jira/non-esiste', {}],
  ['POST', '/api/repos/sources', { sources: [] }], ['POST', '/api/repos/list', { owner: 'x' }],
  ['POST', '/api/project/pipeline', { skill: 'non-esiste' }], ['POST', '/api/project/plan', {}], ['POST', '/api/project/create', {}],
  ['POST', '/api/project/jdk', { home: 'C:/non/esiste' }], ['POST', '/api/non-esiste', {}],
];

(async () => {
  const got = {};
  for (const [m, u, b] of ROUTES) {
    const r = await fetch(base + u, { method: m, headers: h, body: m === 'POST' ? JSON.stringify(b || {}) : undefined });
    const ct = r.headers.get('content-type') || '';
    let msg = '';
    if (ct.includes('json')) { const j = await r.json().catch(() => ({})); msg = r.status >= 400 ? String(j.error || '').split(root).join('<root>').slice(0, 110) : Object.keys(j).sort().join(','); } else msg = ct.split(';')[0];
    got[m + ' ' + u] = r.status + ' | ' + msg;
  }
  if (record || !fs.existsSync(GOLDEN)) { fs.writeFileSync(GOLDEN, JSON.stringify(got, null, 1)); console.log('  registrate ' + Object.keys(got).length + ' rotte in routes-golden.json'); process.exit(0); }
  const want = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  let ko = 0;
  for (const k of Object.keys(want)) if (got[k] !== want[k]) { ko++; console.log('  KO  ' + k + '\n        atteso: ' + want[k] + '\n        ottenuto: ' + got[k]); }
  for (const k of Object.keys(got)) if (!(k in want)) { ko++; console.log('  KO  rotta non registrata: ' + k); }
  console.log(ko ? 'RISULTATO: ' + ko + ' differenze su ' + Object.keys(want).length + ' rotte' : 'RISULTATO: ' + Object.keys(want).length + ' rotte identiche al registro');
  setTimeout(() => process.exit(ko ? 1 : 0), 250); // uscita differita: chiudere subito con connessioni aperte fa crashare libuv su Windows
})().catch((e) => { console.log('ERRORE', e.message); process.exit(2); });
