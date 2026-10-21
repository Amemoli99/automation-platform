// Sessione come servizio: claude, gli eventi in diretta (SSE) e i permessi vivono nel servizio; il gateway tiene lo stato dell'app e sa se una sessione è in corso.
//   node test/flow/session-service-test.js <base> <progetto>
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');
const [base, root] = process.argv.slice(2);
let ok = 0, ko = 0;
const t = (n, c, x) => { if (c) { ok++; console.log('  ok  ', n); } else { ko++; console.log('  KO  ', n, x !== undefined ? '-> ' + JSON.stringify(x).slice(0, 240) : ''); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const h = { 'Content-Type': 'application/json', Origin: base };
const forged = (c) => ({ 'x-nacp-context': Buffer.from(JSON.stringify(c), 'utf8').toString('base64') });
const get = async (p, extra) => { const r = await fetch(base + p, { headers: { ...h, ...(extra || {}) } }); let j = null; try { j = await r.json(); } catch { /* non json */ } return [r.status, j, r.headers.get('x-nacp-service')]; };
const post = async (p, b, extra) => { const r = await fetch(base + p, { method: 'POST', headers: { ...h, ...(extra || {}) }, body: JSON.stringify(b || {}) }); const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch { j = { raw: txt.slice(0, 200) }; } return [r.status, j, r.headers.get('x-nacp-service')]; };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const waitFor = async (fn, ms = 12000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(120); } return null; };
const stubs = () => { try { return execFileSync('powershell', ['-NoProfile', '-Command', "(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'stub_allow_claude' }).ProcessId"], { encoding: 'utf8' }).split(/\s+/).filter(Boolean).map(Number); } catch { return []; } };
const running = async () => (await get('/api/project'))[1].running;
// legge gli eventi che il server rimanda a chi si collega, per un po'
async function events(ms, extra) {
  const r = await fetch(base + '/api/events', { headers: { ...h, ...(extra || {}) } });
  const via = r.headers.get('x-nacp-service');
  const rd = r.body.getReader(); let buf = ''; const t0 = Date.now();
  while (Date.now() - t0 < ms) { const c = await Promise.race([rd.read(), new Promise((res) => setTimeout(() => res({ value: null }), 250))]); if (c.done) break; if (c.value) buf += Buffer.from(c.value).toString('utf8'); }
  try { rd.cancel(); } catch { /* chiusura */ }
  return { via, list: buf.split('\n\n').map((b) => b.replace(/^data: /, '')).filter(Boolean).map((x) => { try { return JSON.parse(x); } catch { return null; } }).filter(Boolean) };
}

(async () => {
  let s, j, via;
  [s, j] = await get('/api/services');
  t('servizio Session pronto', s === 200 && j.session && j.session.state === 'ready', j);
  const pid0 = j.session.pid;

  console.log('== eventi e passi attraverso il gateway');
  let ev = await events(800);
  t('il flusso SSE è servito dal servizio e inizia con lo stato', ev.via === 'session' && ev.list[0] && ev.list[0].type === 'status' && ev.list[0].data.status === 'idle', [ev.via, ev.list[0]]);
  [s, j, via] = await get('/api/steps');
  t('i passi della pipeline vengono dal servizio', s === 200 && via === 'session' && Array.isArray(j) && j.length >= 8, [s, via]);

  console.log('== sessione in corso: il gateway lo sa');
  t('prima dell\'avvio il gateway non vede sessioni', (await running()) === false);
  const fakeCtx = forged({ root: 'C:/Windows', prefs: {}, allPrefs: {}, demo: false, running: false, caps: [], role: 'admin', roleLabel: 'x' });
  [s, j, via] = await post('/api/start', { ticket: 'NX-5 prova sessione', permissionMode: 'acceptEdits' }, fakeCtx);
  t('avvio con un contesto falso: vale il progetto vero del gateway', s === 200 && via === 'session', [s, via, j]);
  const run1 = await waitFor(async () => (await running()) === true, 5000);
  t('il gateway vede "sessione in corso" (messaggio dal servizio)', !!run1);
  ev = await events(1500);
  t('gli eventi della sessione arrivano dal servizio (risultato con la regola negata)', ev.list.some((e) => e.type === 'result' && e.data.denials.length === 1), ev.list.map((e) => e.type));
  [s, j, via] = await post('/api/git/update', {});
  t('git è bloccato mentre la sessione gira', s === 400 && /Termina la sessione/.test(j.error), [s, j]);
  [s, j, via] = await post('/api/project/activate', { dir: root });
  t('anche il cambio di progetto è bloccato', s === 400 && /Termina la sessione/.test(j.error), [s, j]);
  [s, j, via] = await post('/api/send', { text: 'ciao' });
  t('un messaggio alla sessione passa dal servizio', s === 200 && via === 'session', [s, j]);

  console.log('== permessi e domande a margine nel servizio');
  [s, j] = await post('/api/allow', { rules: ['Bash(rm -rf /)'] });
  t('una regola non proposta non si concede', s === 400 && /Nessuna regola valida/.test(j.error), [s, j]);
  [s, j, via] = await post('/api/btw', { question: 'a che punto sei?' });
  t('domanda a margine con la copia della sessione', s === 200 && j.answer === 'Risposta di prova', [s, j]);

  console.log('== stop e reset');
  [s, j, via] = await post('/api/stop', {});
  t('stop dal servizio', s === 200 && via === 'session', [s, j]);
  const stopped = await waitFor(async () => (await running()) === false, 8000);
  t('il gateway vede la sessione finita', !!stopped);
  const gone = await waitFor(() => stubs().length === 0, 6000);
  t('e nessun processo claude resta in giro', !!gone, stubs());
  [s, j] = await post('/api/project/activate', { dir: root });
  t('ora il cambio di progetto è consentito', s === 200, [s, j]);
  await sleep(500);
  ev = await events(700);
  t('il cambio di progetto azzera gli eventi della sessione nel servizio (reset)', ev.list.length >= 1 && ev.list.every((e) => e.type === 'status') && ev.list[0].data.status === 'idle', ev.list.map((e) => e.type));

  console.log('== caduta del servizio durante una sessione');
  [s, j] = await post('/api/start', { ticket: 'NX-6 seconda', permissionMode: 'acceptEdits' });
  t('nuova sessione', s === 200, [s, j]);
  await waitFor(async () => (await running()) === true, 5000);
  const before = stubs();
  t('claude è in esecuzione', before.length >= 1, before);
  [, j] = await get('/api/services');
  process.kill(j.session.pid);
  const back = await waitFor(async () => { const [, x] = await get('/api/services'); return x.session.state === 'ready' && x.session.pid !== j.session.pid ? x.session : null; });
  t('il servizio riparte da solo', !!back, back);
  t('il gateway non crede più che ci sia una sessione in corso', (await running()) === false);
  const orphan = await waitFor(() => stubs().length === 0, 8000);
  t('e il claude della sessione caduta non resta orfano', !!orphan, stubs());
  [s, j, via] = await post('/api/start', { ticket: 'NX-7 dopo la caduta', permissionMode: 'acceptEdits' });
  t('si può avviare una nuova sessione', s === 200 && via === 'session', [s, j]);
  await waitFor(async () => (await running()) === true, 5000);

  console.log('== chiusura con una sessione in corso');
  [, j] = await get('/api/services');
  const pids = Object.values(j).map((x) => x.pid);
  await post('/api/shutdown', {});
  const all = await waitFor(() => pids.every((p) => !alive(p)), 10000);
  t('alla chiusura si fermano tutti i servizi', !!all, pids);
  const none = await waitFor(() => stubs().length === 0, 8000);
  t('e anche claude', !!none, stubs());
  console.log('RISULTATO: ' + ok + ' ok, ' + ko + ' ko');
  setTimeout(() => process.exit(ko ? 1 : 0), 250);
})().catch((e) => { console.log('ERRORE', e.stack || e.message); process.exit(2); });
