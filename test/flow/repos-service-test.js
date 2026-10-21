// Repos come servizio: le origini Git sono dell'area (sources.json), il clone lo fa il servizio e l'aggancio del progetto il gateway.
//   node test/flow/repos-service-test.js <base> <cartella-dati> <cartella-dei-progetti>
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const [base, data, parent] = process.argv.slice(2);
let ok = 0, ko = 0;
const t = (n, c, x) => { if (c) { ok++; console.log('  ok  ', n); } else { ko++; console.log('  KO  ', n, x !== undefined ? '-> ' + JSON.stringify(x).slice(0, 240) : ''); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const h = { 'Content-Type': 'application/json', Origin: base };
const get = async (p) => { const r = await fetch(base + p, { headers: h }); let j = null; try { j = await r.json(); } catch { /* non json */ } return [r.status, j, r.headers.get('x-nacp-service')]; };
const post = async (p, b) => { const r = await fetch(base + p, { method: 'POST', headers: h, body: JSON.stringify(b || {}) }); let j = null; try { j = await r.json(); } catch { /* non json */ } return [r.status, j, r.headers.get('x-nacp-service')]; };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const waitFor = async (fn, ms = 12000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(150); } return null; };
const same = (a, b) => path.resolve(a || '').toLowerCase() === path.resolve(b).toLowerCase();

(async () => {
  let s, j, via;
  [s, j] = await get('/api/services');
  t('servizio Repos pronto', s === 200 && j.repos && j.repos.state === 'ready', j);
  const pid0 = j.repos.pid;

  console.log('== origini salvate (migrate dal vecchio stato) e collegate');
  [s, j, via] = await get('/api/repos/sources');
  t('le 2 origini del vecchio stato sono lette dal servizio', s === 200 && via === 'repos' && j.savedList.length === 2 && j.sources.length === 0, [s, via, j]);
  const gh = j.savedList.find((x) => x.provider === 'github');
  [s, j, via] = await post('/api/repos/sources', { sources: j.savedList.map((x) => ({ provider: x.provider, host: x.host, owner: x.owner })), link: [gh.key] });
  t('collegamento di un\'origine', s === 200 && via === 'repos' && j.sources.length === 1 && j.sources[0].key === gh.key, [s, j]);
  t('le origini ora stanno in sources.json (non più nello stato dell\'app)', fs.existsSync(path.join(data, 'sources.json')) && JSON.parse(fs.readFileSync(path.join(data, 'sources.json'), 'utf8')).length === 2);
  [s, j, via] = await post('/api/repos/list', { source: { provider: 'gitlab', host: 'gitlab.esempio.it', owner: 'gruppo-esempio' } });
  t('un\'origine non collegata è rifiutata con il messaggio di sempre', s === 400 && via === 'repos' && /Origine non configurata/.test(j.error), [s, j]);

  console.log('== clone e aggancio del progetto (copia locale già presente: nessuna rete)');
  const dest = path.join(parent, 'esempio-repo');
  fs.mkdirSync(dest, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: dest });
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/' + gh.owner + '/esempio-repo.git'], { cwd: dest });
  [s, j, via] = await post('/api/repos/clone', { source: { provider: gh.provider, host: gh.host, owner: gh.owner }, repo: 'esempio-repo', parent });
  t('il clone riconosce la copia locale', s === 200 && j.cloned === false && same(j.dir, dest), [s, j]);
  t('e il gateway aggancia il progetto', !!j.project && j.project.attached === true && same(j.project.root, dest), j && j.project);
  [s, j] = await get('/api/project');
  t('lo stato dell\'app ora punta alla copia clonata', same(j.root, dest), j.root);
  [s, j, via] = await post('/api/repos/clone', { source: { provider: 'gitlab', host: 'gitlab.esempio.it', owner: 'gruppo-esempio' }, repo: 'x', parent });
  t('clone da un\'origine non collegata: rifiutato (messaggio del servizio)', s === 400 && /Origine non configurata/.test(j.error), [s, j]);
  const st = JSON.parse(fs.readFileSync(path.join(data, 'active-project.json'), 'utf8'));
  t('lo stato dell\'app punta al progetto clonato e conserva le origini vecchie (non si perdono)', same(st.root, dest) && Array.isArray(st.sources), Object.keys(st));

  console.log('== caduta e chiusura');
  process.kill(pid0);
  const back = await waitFor(async () => { const [, x] = await get('/api/services'); return x.repos.state === 'ready' && x.repos.pid !== pid0 ? x.repos : null; });
  t('il servizio riparte da solo', !!back, back);
  [s, j, via] = await get('/api/repos/sources');
  t('le origini salvate restano, i collegamenti si azzerano (come a ogni avvio)', s === 200 && via === 'repos' && j.savedList.length === 2 && j.sources.length === 0, [s, j]);
  [, j] = await get('/api/services');
  const pids = Object.values(j).map((x) => x.pid);
  await post('/api/shutdown', {});
  const gone = await waitFor(() => pids.every((p) => !alive(p)), 10000);
  t('alla chiusura si fermano tutti i servizi', !!gone, pids);
  console.log('RISULTATO: ' + ok + ' ok, ' + ko + ' ko');
  setTimeout(() => process.exit(ko ? 1 : 0), 250);
})().catch((e) => { console.log('ERRORE', e.stack || e.message); process.exit(2); });
