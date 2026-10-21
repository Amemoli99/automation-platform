// MCP come servizio: il progetto arriva dal gateway, le credenziali si cifrano e si decifrano nel servizio, i server MCP sono suoi figli.
//   node test/flow/mcp-service-test.js <base>
'use strict';
const { execFileSync } = require('child_process');
const base = process.argv[2];
let ok = 0, ko = 0;
const t = (n, c, x) => { if (c) { ok++; console.log('  ok  ', n); } else { ko++; console.log('  KO  ', n, x !== undefined ? '-> ' + JSON.stringify(x).slice(0, 240) : ''); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const h = { 'Content-Type': 'application/json', Origin: base };
const forged = (c) => ({ 'x-nacp-context': Buffer.from(JSON.stringify(c), 'utf8').toString('base64') });
const get = async (p, extra) => { const r = await fetch(base + p, { headers: { ...h, ...(extra || {}) } }); let j = null; try { j = await r.json(); } catch { /* non json */ } return [r.status, j, r.headers.get('x-nacp-service')]; };
const post = async (p, b, extra) => { const r = await fetch(base + p, { method: 'POST', headers: { ...h, ...(extra || {}) }, body: JSON.stringify(b || {}) }); let j = null; try { j = await r.json(); } catch { /* non json */ } return [r.status, j, r.headers.get('x-nacp-service')]; };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const waitFor = async (fn, ms = 12000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(150); } return null; };
// processi node che eseguono il finto server MCP (figli del servizio)
const fakeMcp = () => { try { return execFileSync('powershell', ['-NoProfile', '-Command', "(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'fake_mcp' }).ProcessId"], { encoding: 'utf8' }).split(/\s+/).filter(Boolean).map(Number); } catch { return []; } };

(async () => {
  let s, j, via;
  [s, j] = await get('/api/services');
  t('servizio MCP pronto', s === 200 && j.mcp && j.mcp.state === 'ready', j);
  const mcpPid = j.mcp.pid;

  console.log('== progetto e credenziali');
  [s, j, via] = await get('/api/mcp/servers');
  const fake = (j.servers || []).find((x) => x.name === 'fake');
  t('elenco dei server MCP del progetto del gateway', s === 200 && via === 'mcp' && !!fake, [s, via, j && j.servers && j.servers.map((x) => x.name)]);
  [s, j, via] = await post('/api/mcp/env', { server: 'fake', values: { FAKE_TOKEN: 'segreto-svc-12345' } });
  t('credenziale salvata (cifrata) dal servizio', s === 200 && via === 'mcp' && j.vars.FAKE_TOKEN === true, [s, j]);
  [s, j, via] = await post('/api/mcp/tools', { server: 'fake' });
  t('i tool vengono letti dal server MCP avviato dal servizio', s === 200 && via === 'mcp' && j.tools.length === 4, [s, j && (j.error || j.tools.length)]);
  [s, j, via] = await post('/api/mcp/call', { server: 'fake', tool: 'confluence_search', args: { query: 'qa' } });
  const tokenLen = !j.isError && j.content ? JSON.parse(j.content[0].text).tokenLen : null;
  t('la credenziale arriva al server MCP (17 caratteri)', s === 200 && tokenLen === 17, [s, tokenLen]);
  [s, j, via] = await post('/api/mcp/call', { server: 'fake', tool: 'confluence_create_page', args: { title: 'x' } });
  t('una scrittura senza conferma è bloccata (409)', s === 409 && j.needsConfirm === true && via === 'mcp', [s, j]);

  console.log('== schede (bozza con Claude finto dentro il servizio)');
  [s, j, via] = await post('/api/mcp/panel/draft', { server: 'fake' });
  t('bozza di una scheda', s === 200 && via === 'mcp' && j.descriptor && j.descriptor.source === 'claude', [s, j && j.error]);
  [s, j] = await post('/api/mcp/panel/save', { server: 'fake', descriptor: j.descriptor });
  t('scheda salvata', s === 200, [s, j && j.error]);
  [s, j] = await get('/api/mcp/panel?server=fake');
  t('e riletta', s === 200 && j.descriptor && j.descriptor.server === 'fake', [s, j]);
  [s] = await post('/api/mcp/panel/delete', { server: 'fake' });
  t('e rimossa', s === 200, s);

  console.log('== domanda a Claude (le credenziali si scaldano nel servizio)');
  [s, j, via] = await post('/api/mcp/ask', { server: 'fake', request: 'cerca qualcosa su qa' });
  t('la richiesta parte e restituisce un identificativo', s === 200 && via === 'mcp' && !!j.id, [s, j]);
  const fin = await waitFor(async () => { const [, x] = await get('/api/mcp/ask-status?id=' + (j && j.id)); return x && x.state !== 'running' ? x : null; }, 15000);
  t('il lavoro si conclude nel servizio (stato interrogabile)', !!fin, fin);

  console.log('== il browser non può falsificare il contesto');
  [s, j, via] = await get('/api/mcp/servers', forged({ root: 'C:/Windows', prefs: {}, demo: false }));
  t('con un contesto falso il progetto resta quello vero', s === 200 && (j.servers || []).some((x) => x.name === 'fake'), [s, j && j.servers && j.servers.length]);

  console.log('== caduta e chiusura');
  const children = fakeMcp();
  t('il server MCP è un processo figlio attivo', children.length >= 1, children);
  process.kill(mcpPid);
  const back = await waitFor(async () => { const [, x] = await get('/api/services'); return x.mcp.state === 'ready' && x.mcp.pid !== mcpPid ? x.mcp : null; });
  t('il servizio riparte da solo', !!back, back);
  [s, j, via] = await post('/api/mcp/call', { server: 'fake', tool: 'confluence_search', args: { query: 'qa' } });
  const len2 = !j.isError && j.content ? JSON.parse(j.content[0].text).tokenLen : null;
  t('dopo il riavvio le credenziali si decifrano di nuovo (17 caratteri)', s === 200 && len2 === 17, [s, len2, j && j.error]);
  [, j] = await get('/api/services');
  const pids = Object.values(j).map((x) => x.pid);
  await post('/api/shutdown', {});
  const gone = await waitFor(() => pids.every((p) => !alive(p)), 10000);
  t('alla chiusura si fermano tutti i servizi', !!gone, pids);
  const orphans = await waitFor(() => fakeMcp().length === 0, 8000);
  t('e nessun server MCP resta orfano', !!orphans, fakeMcp());
  console.log('RISULTATO: ' + ok + ' ok, ' + ko + ' ko');
  setTimeout(() => process.exit(ko ? 1 : 0), 250);
})().catch((e) => { console.log('ERRORE', e.stack || e.message); process.exit(2); });
