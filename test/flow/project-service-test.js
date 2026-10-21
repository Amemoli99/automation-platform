// Area Project come servizio: i controlli sui file girano nel servizio con il progetto e le preferenze del gateway;
// aggancio, scelta di skill e JDK e creazione (che aggancia) restano del gateway, e il servizio vede subito i cambiamenti.
//   node test/flow/project-service-test.js <base> <progetto> <cartella-dei-progetti>
'use strict';
const fs = require('fs');
const path = require('path');
const [base, root, parent] = process.argv.slice(2);
let ok = 0, ko = 0;
const t = (n, c, x) => { if (c) { ok++; console.log('  ok  ', n); } else { ko++; console.log('  KO  ', n, x !== undefined ? '-> ' + JSON.stringify(x).slice(0, 240) : ''); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const h = { 'Content-Type': 'application/json', Origin: base };
const forged = (c) => ({ 'x-nacp-context': Buffer.from(JSON.stringify(c), 'utf8').toString('base64') });
const get = async (p, extra) => { const r = await fetch(base + p, { headers: { ...h, ...(extra || {}) } }); let j = null; try { j = await r.json(); } catch { /* non json */ } return [r.status, j, r.headers.get('x-nacp-service')]; };
const post = async (p, b, extra) => { const r = await fetch(base + p, { method: 'POST', headers: { ...h, ...(extra || {}) }, body: JSON.stringify(b || {}) }); const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch { j = { raw: txt.slice(0, 200) }; } return [r.status, j, r.headers.get('x-nacp-service')]; };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const waitFor = async (fn, ms = 12000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(150); } return null; };
const same = (a, b) => path.resolve(a || '').toLowerCase() === path.resolve(b).toLowerCase();

(async () => {
  let s, j, via;
  [s, j] = await get('/api/services');
  t('servizio Project pronto', s === 200 && j.project && j.project.state === 'ready', j);
  const pid0 = j.project.pid;

  console.log('== il gateway tiene lo stato, il servizio lavora sui file');
  [s, j, via] = await get('/api/project');
  t('GET /api/project (stato dell\'app) resta nel gateway', s === 200 && via === null && same(j.root, root) && j.attached === true, [s, via, j && j.root]);
  [s, j, via] = await get('/api/project/inspect');
  t('GET /api/project/inspect risponde il servizio sul progetto del gateway', s === 200 && via === 'project' && j.ready === true && Array.isArray(j.items), [s, via, j && j.ready]);
  [s, j, via] = await get('/api/project/pipeline');
  t('la pipeline scelta (default) è letta dal servizio', s === 200 && via === 'project' && j.chosen === 'implementTest', [s, via, j && j.chosen]);
  [s, j, via] = await get('/api/config');
  t('configurazione del progetto dal servizio', s === 200 && via === 'project' && !!j.permissions && !!j.profile, [s, via, j && Object.keys(j)]);
  [s, j, via] = await post('/api/config/permissions', { allow: ['Read', 'Bash(mvn test)'] });
  t('i permessi si salvano nel progetto', s === 200 && via === 'project' && fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8').includes('Bash(mvn test)'), [s, j]);

  console.log('== una preferenza cambiata nel gateway è subito visibile al servizio');
  [s, j, via] = await post('/api/project/pipeline', { skill: 'run-test', args: '{text}' });
  t('la scelta della skill si salva nel gateway (stato dell\'app)', s === 200 && via === null && j.chosen === 'run-test', [s, via, j]);
  [s, j, via] = await get('/api/project/pipeline');
  t('il servizio la vede nella richiesta successiva', s === 200 && via === 'project' && j.chosen === 'run-test', [s, via, j && j.chosen]);
  [s, j, via] = await post('/api/pipeline/preview', { ticket: 'NX-1 prova' });
  t('l\'anteprima del comando usa la skill scelta', s === 200 && via === 'project' && /run-test/.test(j.command), [s, j]);
  [s, j, via] = await post('/api/project/jdk', { home: 'C:/non/esiste' });
  t('un JDK non valido è rifiutato dal gateway', s === 400 && via === null && /Non è un JDK valido/.test(j.error), [s, j]);
  [s, j, via] = await post('/api/tests/existing', { keys: ['NX-1', 'x'] });
  t('test esistenti dal servizio', s === 200 && via === 'project' && typeof j.existing === 'object', [s, j]);
  const fakeCtx = forged({ root, prefs: { skill: 'implementTest' }, allPrefs: {}, demo: false, running: false, caps: ['project.create'], role: 'admin', roleLabel: 'Administrator' });
  [s, j] = await get('/api/project/pipeline', fakeCtx);
  t('un contesto falso con un\'altra skill viene ignorato', s === 200 && j.chosen === 'run-test', [s, j && j.chosen]);

  console.log('== creazione guidata: il servizio crea, il gateway aggancia');
  const dir = path.join(parent, 'nuovo-progetto');
  const plan = { mode: 'new', name: 'Nuovo Progetto', dir, envs: [{ name: 'DEV', url: 'https://dev.example.it' }], username: '', password: '', initialCommit: false, pipeline: { mode: 'default' }, frameworkRepo: 'https://maven.pkg.github.com/org-prova/repo-prova' };
  [s, j, via] = await post('/api/project/plan', plan);
  t('anteprima dei file dal servizio', s === 200 && via === 'project' && j.files.length > 10, [s, via, j && j.error]);
  [s, j, via] = await post('/api/project/create', { ...plan, activate: true });
  t('creazione del progetto', s === 200 && via === null && (j.created || []).length > 10 && fs.existsSync(path.join(dir, 'pom.xml')), [s, j && j.error]);
  [s, j] = await get('/api/project');
  t('il gateway ha agganciato il nuovo progetto', same(j.root, dir) && j.attached === true, j.root);
  t('e ricorda il repository del framework', j.frameworkRepo === 'https://maven.pkg.github.com/org-prova/repo-prova', j.frameworkRepo);
  [s, j, via] = await get('/api/project/inspect');
  t('il servizio ora lavora sul nuovo progetto', s === 200 && via === 'project', [s, via]);
  [s, j] = await post('/api/project/activate', { dir: root });
  t('si torna al progetto di prima', s === 200 && same(j.root, root), [s, j && j.error]);

  console.log('== caduta e chiusura');
  process.kill(pid0);
  const back = await waitFor(async () => { const [, x] = await get('/api/services'); return x.project.state === 'ready' && x.project.pid !== pid0 ? x.project : null; });
  t('il servizio riparte da solo', !!back, back);
  [s, j, via] = await get('/api/project/pipeline');
  t('e vede ancora la scelta della skill (lo stato è nel gateway, non nel servizio)', s === 200 && via === 'project' && j.chosen === 'run-test', [s, via, j && j.chosen]);
  [, j] = await get('/api/services');
  const pids = Object.values(j).map((x) => x.pid);
  await post('/api/shutdown', {});
  const gone = await waitFor(() => pids.every((p) => !alive(p)), 10000);
  t('alla chiusura si fermano tutti i servizi', !!gone, pids);
  console.log('RISULTATO: ' + ok + ' ok, ' + ko + ' ko');
  setTimeout(() => process.exit(ko ? 1 : 0), 250);
})().catch((e) => { console.log('ERRORE', e.stack || e.message); process.exit(2); });
