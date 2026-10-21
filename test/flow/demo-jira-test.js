// Verifica: in Demo Jira funziona (dati finti) anche senza connessione salvata; fuori dalla Demo resta scollegato.
const base = process.argv[2];
const h = { 'Content-Type': 'application/json', Origin: base };
const get = async (p) => { const r = await fetch(base + p, { headers: h }); let j = {}; try { j = await r.json(); } catch { /* non json */ } return [r.status, j]; };
const post = async (p, b) => { const r = await fetch(base + p, { method: 'POST', headers: h, body: JSON.stringify(b || {}) }); let j = {}; try { j = await r.json(); } catch { /* non json */ } return [r.status, j]; };
let ko = 0;
const t = (n, c, x) => { if (!c) ko++; console.log(c ? '  ok  ' : '  KO  ', n, c ? '' : '-> ' + JSON.stringify(x).slice(0, 200)); };
(async () => {
  let s, j;
  [s, j] = await get('/api/jira/state'); t('fuori Demo: scollegato, nessuna query', j.configured === false && (j.queries || []).length === 0, j);
  [s, j] = await post('/api/jira/search', { jql: 'project = DEMO' }); t('fuori Demo: ricerca bloccata', s === 400 && /non è collegato/.test(j.error || ''), [s, j]);
  [s, j] = await post('/api/demo', { on: true }); t('Demo attivata', s === 200, [s, j]);
  await new Promise((r) => setTimeout(r, 1000));
  [s, j] = await get('/api/jira/state'); t('in Demo: Jira risulta collegato con le query simulate', j.configured === true && j.queries.length > 0, j);
  [s, j] = await get('/api/jira/verify'); t('in Demo: verifica ok', j.ok === true, j);
  const q = (await get('/api/jira/state'))[1].queries[0];
  [s, j] = await post('/api/jira/search', { queryId: q.id }); t('in Demo: la Dashboard riceve i ticket finti (query "' + q.name + '")', s === 200 && Array.isArray(j.issues) && j.issues.length > 0, [s, j.error]);
  [s, j] = await post('/api/jira/issue', { key: (j.issues || [{}])[0].key }); t('in Demo: dettaglio ticket', s === 200 && !!j.summary, [s, j.error]);
  [s, j] = await post('/api/jira/link', {}); t('in Demo: "Riconnetti" non dà errore', s === 200, [s, j.error]);
  [s, j] = await post('/api/jira/unlink', {}); t('in Demo: "Scollega" dice che non è disponibile', s === 400 && /Demo/.test(j.error || ''), [s, j.error]);
  [s, j] = await post('/api/demo', { on: false }); t('Demo disattivata', s === 200, [s, j]);
  [s, j] = await get('/api/jira/state'); t('dopo la Demo: di nuovo scollegato', j.configured === false, j);
  [s, j] = await post('/api/jira/search', { jql: 'project = DEMO' }); t('dopo la Demo: ricerca di nuovo bloccata', s === 400, [s, j]);
  console.log(ko ? 'ESITO: ' + ko + ' ko' : 'ESITO: tutto ok');
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.log('ERRORE', e.message); process.exit(2); });
