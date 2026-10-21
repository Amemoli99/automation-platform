// Git come servizio: progetto, "sessione in corso" e permessi del profilo arrivano dal gateway nel contesto della richiesta.
// Il profilo di prova è Tester: può committare e pubblicare, ma non sul branch principale.
//   node test/flow/git-service-test.js <base> <progetto>
'use strict';
const path = require('path');
const base = process.argv[2];
const root = process.argv[3];
let ok = 0, ko = 0;
const t = (n, c, x) => { if (c) { ok++; console.log('  ok  ', n); } else { ko++; console.log('  KO  ', n, x !== undefined ? '-> ' + JSON.stringify(x).slice(0, 240) : ''); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const h = { 'Content-Type': 'application/json', Origin: base };
const forged = (c) => ({ 'x-nacp-context': Buffer.from(JSON.stringify(c), 'utf8').toString('base64') });
const get = async (p, extra) => { const r = await fetch(base + p, { headers: { ...h, ...(extra || {}) } }); let j = null; try { j = await r.json(); } catch { /* non json */ } return [r.status, j, r.headers.get('x-nacp-service')]; };
const post = async (p, b, extra) => { const r = await fetch(base + p, { method: 'POST', headers: { ...h, ...(extra || {}) }, body: JSON.stringify(b || {}) }); let j = null; try { j = await r.json(); } catch { /* non json */ } return [r.status, j, r.headers.get('x-nacp-service')]; };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const waitFor = async (fn, ms = 12000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(150); } return null; };

(async () => {
  let s, j, via;
  [s, j] = await get('/api/services');
  t('servizio Git pronto', s === 200 && j.git && j.git.state === 'ready', j);
  [s, j] = await get('/api/license');
  t('il profilo di prova è Tester', j.role === 'tester' && j.caps.includes('git.push') && !j.caps.includes('git.protected'), [j.role, j.caps]);

  console.log('== stato e operazioni sul progetto del gateway');
  [s, j, via] = await get('/api/git/status');
  t('GET /api/git/status risponde il servizio', s === 200 && via === 'git' && j.isRepo === true, [s, via, j && j.isRepo]);
  const main = j.branch;
  t('è un repository con un branch', !!main, main);
  const file = (j.entries || []).map((e) => e.path).find((p) => !/^\.(tmp|claude)/.test(p)) || 'pom.xml';
  [s, j, via] = await post('/api/git/commit', { files: [file], message: 'Commit di prova dal servizio Git' });
  t('commit eseguito nel progetto del gateway', s === 200 && via === 'git', [s, j]);
  [s, j, via] = await post('/api/git/create', { name: 'feature/servizio', from: main });
  t('creazione di un branch', s === 200 && j.status.branch === 'feature/servizio', [s, j && j.error]);
  [s, j] = await get('/api/git/status');
  t('lo stato del servizio vede il nuovo branch', j.branch === 'feature/servizio', j.branch);
  [s, j] = await post('/api/git/switch', { name: main });
  t('ritorno al branch principale', s === 200 && j.status.branch === main, [s, j && j.error]);

  console.log('== permessi (il servizio non legge la licenza)');
  [s, j, via] = await post('/api/git/push', {});
  t('push sul branch principale come Tester: 403 dal servizio', s === 403 && via === 'git' && j.code === 'role' && /Tester/.test(j.error) && /branch principale/.test(j.error), [s, via, j]);
  [s, j, via] = await post('/api/git/merge', { source: 'feature/servizio' });
  t('merge dentro il branch principale come Tester: 403', s === 403 && j.code === 'role', [s, j]);
  [s, j] = await post('/api/git/push', {}, forged({ root: 'C:/Windows', caps: ['git.protected', 'git.push', 'git.write'], role: 'admin', roleLabel: 'Administrator', running: false }));
  t('un contesto falso con tutti i permessi viene ignorato', s === 403 && /Tester/.test(j.error), [s, j]);

  console.log('== sessione in corso');
  [s, j] = await post('/api/start', { ticket: 'NX-1 prova git', permissionMode: 'acceptEdits' });
  t('avvio di una sessione (finto claude)', s === 200, [s, j]);
  const waiting = await waitFor(async () => { const [, x] = await get('/api/project'); return x.running === true; }, 6000);
  t('la sessione è in corso', !!waiting);
  [s, j, via] = await post('/api/git/update', {});
  t('le operazioni git sono bloccate mentre la sessione gira (contesto)', s === 400 && via === 'git' && /Termina la sessione/.test(j.error), [s, via, j]);
  [s, j] = await post('/api/git/update', {}, forged({ root, running: false, caps: ['git.write'], role: 'tester', roleLabel: 'Tester' }));
  t('un contesto falso "non in corso" viene ignorato', s === 400 && /Termina la sessione/.test(j.error), [s, j]);
  await post('/api/stop', {});
  const stopped = await waitFor(async () => { const [, x] = await get('/api/project'); return x.running === false; }, 8000);
  t('sessione fermata', !!stopped);

  console.log('== caduta e chiusura');
  [, j] = await get('/api/services');
  const gp = j.git.pid;
  process.kill(gp);
  const back = await waitFor(async () => { const [, x] = await get('/api/services'); return x.git.state === 'ready' && x.git.pid !== gp ? x.git : null; });
  t('il servizio Git riparte da solo', !!back, back);
  [s, j, via] = await get('/api/git/status');
  t('e vede lo stesso progetto', s === 200 && via === 'git' && j.branch === main, [s, via, j && j.branch]);
  [, j] = await get('/api/services');
  const pids = Object.values(j).map((x) => x.pid);
  await post('/api/shutdown', {});
  const gone = await waitFor(() => pids.every((p) => !alive(p)), 8000);
  t('alla chiusura si fermano tutti i servizi', !!gone, pids);
  console.log('RISULTATO: ' + ok + ' ok, ' + ko + ' ko');
  setTimeout(() => process.exit(ko ? 1 : 0), 250);
})().catch((e) => { console.log('ERRORE', e.stack || e.message); process.exit(2); });
