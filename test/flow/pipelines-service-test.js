// Area Pipelines come servizio: l'editor di skill e agent lavora sul progetto passato dal gateway e scrive i file nel progetto.
//   node test/flow/pipelines-service-test.js <base> <progetto>
'use strict';
const fs = require('fs');
const path = require('path');
const base = process.argv[2];
const root = process.argv[3];
let ok = 0, ko = 0;
const t = (n, c, x) => { if (c) { ok++; console.log('  ok  ', n); } else { ko++; console.log('  KO  ', n, x !== undefined ? '-> ' + JSON.stringify(x).slice(0, 220) : ''); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const h = { 'Content-Type': 'application/json', Origin: base };
const get = async (p, extra) => { const r = await fetch(base + p, { headers: { ...h, ...(extra || {}) } }); let j = null; try { j = await r.json(); } catch { /* non json */ } return [r.status, j, r.headers.get('x-nacp-service')]; };
const post = async (p, b, extra) => { const r = await fetch(base + p, { method: 'POST', headers: { ...h, ...(extra || {}) }, body: JSON.stringify(b || {}) }); let j = null; try { j = await r.json(); } catch { /* non json */ } return [r.status, j, r.headers.get('x-nacp-service')]; };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const waitFor = async (fn, ms = 12000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(150); } return null; };

(async () => {
  let s, j, via;
  [s, j] = await get('/api/services');
  t('servizio Pipelines pronto', s === 200 && j.pipelines && j.pipelines.state === 'ready', j);
  const pid = j.pipelines.pid;

  console.log('== elenco e lettura');
  [s, j, via] = await get('/api/pipelines');
  t('GET /api/pipelines risponde il servizio con il progetto del gateway', s === 200 && via === 'pipelines' && j.project === path.basename(root) && j.skills.length >= 1 && j.agents.length >= 1, [s, via, j && j.project]);
  const nAgents = j.agents.length;
  [s, j, via] = await get('/api/pipelines/item?kind=agent&name=test-coder');
  t('lettura di un agent del progetto', s === 200 && via === 'pipelines', [s, j && j.error]);

  console.log('== scrittura nel progetto');
  const draft = { name: 'agent-servizio', description: 'Agent creato dal test del servizio Pipelines.', tools: ['Read'], model: 'sonnet', body: 'Fai.' };
  [s, j, via] = await post('/api/pipelines/agent', draft);
  t('creazione di un agent dal servizio', s === 200 && via === 'pipelines', [s, via, j]);
  t('il file è stato scritto nel progetto del gateway', fs.existsSync(path.join(root, '.claude', 'agents', 'agent-servizio.md')));
  [s, j] = await get('/api/pipelines');
  t('l\'elenco contiene il nuovo agent', j.agents.length === nAgents + 1 && j.agents.some((a) => a.name === 'agent-servizio'), j.agents.length);
  [s, j, via] = await post('/api/pipelines/agent', draft);
  t('un duplicato è rifiutato con il messaggio del servizio', s === 400 && via === 'pipelines', [s, j]);
  [s, j, via] = await post('/api/pipelines/skill', { name: 'skill-servizio', description: 'Skill creata dal test del servizio Pipelines.', body: '# skill-servizio\n\n## Step 1\nFai.\n' });
  t('creazione di una skill', s === 200 && fs.existsSync(path.join(root, '.claude', 'skills', 'skill-servizio', 'SKILL.md')), [s, j]);
  [s, j, via] = await get('/api/pipelines/link-preview?skill=skill-servizio&agent=agent-servizio');
  t('anteprima del collegamento skill-agent', s === 200 && /agent-servizio/.test(j.text), [s, j && j.error]);
  [s, j, via] = await post('/api/pipelines/draft', { description: 'Un agent che rivede i ticket Jira e segnala le lacune.' });
  t('bozza di un agent con Claude (finto) dal servizio', s === 200 && via === 'pipelines' && !!j.name, [s, via, j]);

  console.log('== il browser non può falsificare il contesto');
  const forged = Buffer.from(JSON.stringify({ root: 'C:/Windows', prefs: {}, demo: false }), 'utf8').toString('base64');
  [s, j, via] = await get('/api/pipelines', { 'x-nacp-context': forged });
  t('con un contesto falso il progetto resta quello vero', s === 200 && j.project === path.basename(root), [s, j && j.project]);

  console.log('== errori e caduta');
  [s, j, via] = await get('/api/pipelines/fix-status?id=non-esiste');
  t('un lavoro sconosciuto dà l\'errore del servizio', s === 400 && via === 'pipelines' && /non trovato/i.test(j.error), [s, j]);
  process.kill(pid);
  const back = await waitFor(async () => { const [, x] = await get('/api/services'); return x.pipelines.state === 'ready' && x.pipelines.pid !== pid ? x.pipelines : null; });
  t('il servizio riparte da solo', !!back, back);
  [s, j, via] = await get('/api/pipelines');
  t('e dopo il riavvio l\'elenco è lo stesso (i file stanno nel progetto, non nel servizio)', s === 200 && via === 'pipelines' && j.agents.some((a) => a.name === 'agent-servizio'), [s, via]);
  [, j] = await get('/api/services');
  const pids = Object.values(j).map((x) => x.pid);
  await post('/api/shutdown', {});
  const gone = await waitFor(() => pids.every((p) => !alive(p)), 8000);
  t('alla chiusura si fermano tutti i servizi', !!gone, pids);
  console.log('RISULTATO: ' + ok + ' ok, ' + ko + ' ko');
  setTimeout(() => process.exit(ko ? 1 : 0), 250);
})().catch((e) => { console.log('ERRORE', e.stack || e.message); process.exit(2); });
