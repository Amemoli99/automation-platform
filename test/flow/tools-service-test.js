// Area Tools come servizio: il progetto, le preferenze e la Demo arrivano dal gateway nel contesto della richiesta, mai dal browser.
//   node test/flow/tools-service-test.js <base> <progetto>
'use strict';
const base = process.argv[2];
let ok = 0, ko = 0;
const t = (n, c, x) => { if (c) { ok++; console.log('  ok  ', n); } else { ko++; console.log('  KO  ', n, x !== undefined ? '-> ' + JSON.stringify(x).slice(0, 220) : ''); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const h = { 'Content-Type': 'application/json', Origin: base };
const get = async (p, extra) => { const r = await fetch(base + p, { headers: { ...h, ...(extra || {}) } }); let j = null; try { j = await r.json(); } catch { /* non json */ } return [r.status, j, r.headers.get('x-nacp-service')]; };
const post = async (p, b) => { const r = await fetch(base + p, { method: 'POST', headers: h, body: JSON.stringify(b || {}) }); let j = null; try { j = await r.json(); } catch { /* non json */ } return [r.status, j, r.headers.get('x-nacp-service')]; };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const waitFor = async (fn, ms = 12000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(150); } return null; };

(async () => {
  let s, j, via;
  [s, j] = await get('/api/services');
  t('servizi Jira e Tools pronti', s === 200 && j.jira && j.jira.state === 'ready' && j.tools && j.tools.state === 'ready', j);
  const toolsPid = j.tools.pid;

  console.log('== contesto: progetto agganciato');
  [s, j, via] = await get('/api/tools');
  t('GET /api/tools risponde il servizio', s === 200 && via === 'tools', [s, via]);
  t('vede il progetto agganciato dal gateway (project: true)', j.project === true && !!j.mcp && Array.isArray(j.skills || []), Object.keys(j));
  const withProject = JSON.stringify(Object.keys(j).sort());
  [s, j, via] = await get('/api/tools/catalog');
  t('catalogo dal servizio, con le sue risorse (server MCP noti e skill/agent del kit non vuoti)', s === 200 && via === 'tools' && Array.isArray(j.mcp) && j.mcp.length > 0 && Array.isArray(j.kit) && j.kit.length > 0, [s, via, j && Object.keys(j), j && j.mcp && j.mcp.length, j && j.kit && j.kit.length]);
  [s, j, via] = await get('/api/tools/mcp-status');
  t('stato dei server MCP dal servizio', s === 200 && via === 'tools' && Array.isArray(j.items), [s, via]);

  console.log('== il browser non può falsificare il contesto');
  const forged = Buffer.from(JSON.stringify({ root: null, prefs: {}, demo: true }), 'utf8').toString('base64');
  [s, j, via] = await get('/api/tools', { 'x-nacp-context': forged });
  t('un contesto scritto dal browser viene ignorato (il progetto resta quello vero)', s === 200 && j.project === true && JSON.stringify(Object.keys(j).sort()) === withProject, [s, j && j.project]);
  const r = await fetch(base + '/api/tools/add', { method: 'POST', headers: { ...h, 'x-nacp-context': forged }, body: JSON.stringify({ type: 'zzz', id: 'x' }) });
  const jj = await r.json();
  t('né la Demo falsa né il progetto assente: l\'errore è quello del tipo non valido', r.status === 400 && /Tipo non valido/.test(jj.error), [r.status, jj]);

  console.log('== errori con il contesto vero');
  [s, j, via] = await post('/api/tools/add', { type: 'mcp', id: 'Non valido!' });
  t('identificativo non valido: messaggio del servizio', s === 400 && via === 'tools' && /Identificativo non valido/.test(j.error), [s, j]);
  [s] = await post('/api/demo', { on: true });
  t('Demo attivata', s === 200, s);
  [s, j, via] = await post('/api/tools/add', { type: 'skill', id: 'run-test' });
  t('in Demo il servizio rifiuta l\'aggiunta (contesto demo)', (s === 400 || s === 403) && /Demo/.test(j.error), [s, via, j]);
  [s, j, via] = await get('/api/tools');
  t('in Demo vede il progetto simulato', s === 200 && via === 'tools' && j.project === true, [s, via]);
  [s] = await post('/api/demo', { on: false });
  t('Demo disattivata', s === 200, s);

  console.log('== diagnostica e caduta');
  const rep = await fetch(base + '/api/diagnostics/export', { headers: h });
  const md = await rep.text();
  t('il report di diagnostica include gli strumenti letti dal servizio', rep.status === 200 && /Strumenti|strumenti|Programmi|programmi/.test(md), [rep.status, md.length]);
  process.kill(toolsPid);
  const back = await waitFor(async () => { const [, x] = await get('/api/services'); return x.tools.state === 'ready' && x.tools.pid !== toolsPid ? x.tools : null; });
  t('il servizio Tools riparte da solo', !!back, back);
  [s, j, via] = await get('/api/tools');
  t('e dopo il riavvio vede ancora il progetto', s === 200 && via === 'tools' && j.project === true, [s, via]);
  [, j] = await get('/api/services');
  const tp = j.tools.pid; const jp = j.jira.pid;
  await post('/api/shutdown', {});
  const gone = await waitFor(() => !alive(tp) && !alive(jp), 8000);
  t('alla chiusura si fermano entrambi i servizi', !!gone, { tp, jp });
  console.log('RISULTATO: ' + ok + ' ok, ' + ko + ' ko');
  setTimeout(() => process.exit(ko ? 1 : 0), 250);
})().catch((e) => { console.log('ERRORE', e.stack || e.message); process.exit(2); });
