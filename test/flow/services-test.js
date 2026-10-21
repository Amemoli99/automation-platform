// Aree come servizi: Jira gira in un processo separato (o, se non parte, resta in-process) e il gateway gli inoltra le richieste.
//   node test/flow/services-test.js <base> on|fallback
'use strict';
const base = process.argv[2];
const mode = process.argv[3] || 'on';
let ok = 0, ko = 0;
const t = (n, c, x) => { if (c) { ok++; console.log('  ok  ', n); } else { ko++; console.log('  KO  ', n, x !== undefined ? '-> ' + JSON.stringify(x).slice(0, 220) : ''); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const h = { 'Content-Type': 'application/json', Origin: base };
const get = async (p) => { const r = await fetch(base + p, { headers: h }); let j = null; try { j = await r.json(); } catch { /* non json */ } return [r.status, j, r.headers.get('x-nacp-service')]; };
const post = async (p, b) => { const r = await fetch(base + p, { method: 'POST', headers: h, body: JSON.stringify(b || {}) }); let j = null; try { j = await r.json(); } catch { /* non json */ } return [r.status, j, r.headers.get('x-nacp-service')]; };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const waitFor = async (fn, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(150); } return null; };

(async () => {
  let s, j, via;
  [s, j] = await get('/api/services');
  if (mode === 'fallback') {
    t('Jira non è tra i servizi avviati (entry mancante)', s === 200 && !('jira' in j), j);
    [s, j, via] = await get('/api/jira/state');
    t('Jira risponde lo stesso, dentro il gateway', s === 200 && j.configured === false && via === null, [s, via]);
    [s, j, via] = await post('/api/jira/search', { jql: 'x' });
    t('e con gli stessi errori di sempre', s === 400 && /non è collegato/.test(j.error), [s, j]);
    console.log('RISULTATO: ' + ok + ' ok, ' + ko + ' ko');
    setTimeout(() => process.exit(ko ? 1 : 0), 250);
    return;
  }
  t('il servizio Jira è pronto', s === 200 && j.jira && j.jira.state === 'ready' && j.jira.pid > 0, j);
  const pid1 = j.jira.pid;
  t('è un processo diverso dal gateway', pid1 !== process.pid && alive(pid1));
  [s, j, via] = await get('/api/jira/state');
  t('GET /api/jira/state risponde il servizio', s === 200 && via === 'jira' && j.configured === false, [s, via, j]);
  [, , via] = await get('/api/version');
  t('le altre rotte restano nel gateway', via === null, via);
  const raw = await fetch(base + '/api/jira/search', { method: 'POST', headers: { Origin: base, 'Content-Type': 'text/plain' }, body: 'x' });
  t('POST senza JSON: 415 dal gateway, prima di toccare il servizio', raw.status === 415, raw.status);
  [s, j, via] = await post('/api/jira/search', { jql: 'x' });
  t('POST inoltrato: gli errori del servizio arrivano al browser', s === 400 && via === 'jira' && /non è collegato/.test(j.error), [s, via, j]);

  console.log('== Demo nel servizio');
  [s] = await post('/api/demo', { on: true });
  t('Demo attivata', s === 200, s);
  [s, j, via] = await get('/api/jira/state');
  t('il servizio mostra i dati simulati', s === 200 && via === 'jira' && j.displayName === 'Utente Demo' && j.queries.length > 0, [via, j && j.displayName]);
  const q = j.queries[0];
  [s, j, via] = await post('/api/jira/search', { queryId: q.id });
  t('la ricerca restituisce i ticket finti dal servizio', s === 200 && via === 'jira' && j.issues.length > 0, [s, via, j && j.error]);
  [s, j] = await post('/api/jira/unlink', {});
  t('"Scollega" in Demo è rifiutato (BLOCKED o servizio)', s === 400 || s === 403, [s, j]);

  console.log('== caduta del servizio durante la Demo');
  [, j] = await get('/api/services');
  const pidDemo = j.jira.pid;
  process.kill(pidDemo);
  const down = await waitFor(async () => { const [, x] = await get('/api/services'); return x.jira.state !== 'ready' || x.jira.pid !== pidDemo; }, 4000);
  t('il gateway si accorge della caduta', !!down);
  const back = await waitFor(async () => { const [, x] = await get('/api/services'); return x.jira.state === 'ready' && x.jira.pid !== pidDemo ? x.jira : null; }, 12000);
  t('il servizio riparte da solo con un nuovo processo', !!back, back);
  const demoAgain = await waitFor(async () => { const [s2, x] = await get('/api/jira/state'); return s2 === 200 && x.displayName === 'Utente Demo'; }, 8000);
  t('e la Demo viene ripristinata nel nuovo processo', !!demoAgain);
  [s] = await post('/api/demo', { on: false });
  t('Demo disattivata', s === 200, s);
  [s, j, via] = await get('/api/jira/state');
  t('Jira torna reale (scollegato) nel servizio', s === 200 && via === 'jira' && j.configured === false && j.displayName !== 'Utente Demo', [via, j]);

  console.log('== chiusura');
  [, j] = await get('/api/services');
  const pid3 = j.jira.pid;
  await post('/api/shutdown', {});
  const gone = await waitFor(() => !alive(pid3), 8000);
  t('alla chiusura dell\'app il servizio si ferma', !!gone, pid3);
  console.log('RISULTATO: ' + ok + ' ok, ' + ko + ' ko');
  setTimeout(() => process.exit(ko ? 1 : 0), 250);
})().catch((e) => { console.log('ERRORE', e.stack || e.message); process.exit(2); });
