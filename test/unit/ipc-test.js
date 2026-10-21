// Infrastruttura dei servizi: pipe con nome, token, supervisore (avvio, riavvio, fermata), inoltro dal gateway e assenza di porte di rete.
//   node test/unit/ipc-test.js
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const ipc = require('../../src/server/infra/ipc');
const { createSupervisor } = require('../../src/server/supervisor');

const ECHO = path.join(__dirname, '..', 'fixtures', 'echo-service.js');
let ok = 0, ko = 0;
const t = (n, c, x) => { if (c) { ok++; console.log('  ok  ', n); } else { ko++; console.log('  KO  ', n, x !== undefined ? '-> ' + JSON.stringify(x).slice(0, 220) : ''); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const json = (r) => JSON.parse(r.body.toString('utf8'));
const waitFor = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(100); } return null; };

// porte TCP in ascolto di un processo (Windows: netstat; altrove si salta)
function listeningPorts(pid) {
  if (process.platform !== 'win32') return null;
  const out = execFileSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8' });
  return out.split(/\r?\n/).filter((l) => /LISTENING/.test(l) && new RegExp('\\s' + pid + '\\s*$').test(l));
}

(async () => {
  console.log('== avvio e pipe');
  const events = [];
  const sup = createSupervisor({ services: { echo: { script: ECHO } }, restart: { max: 2, windowMs: 30000, backoffMs: [100, 200] }, onEvent: (e) => events.push(e) });
  await sup.start();
  const st = sup.status().echo;
  t('il servizio è pronto', st.state === 'ready' && st.pid > 0, st);
  t('la pipe ha un nome casuale e non è una porta di rete', process.platform === 'win32' ? /^\\\\\.\\pipe\\nacp-[0-9a-f]{16}-echo$/.test(st.pipe) : st.pipe.endsWith('-echo.sock'), st.pipe);
  const ports = listeningPorts(st.pid);
  t('il servizio non ascolta su nessuna porta TCP', ports === null || ports.length === 0, ports);

  console.log('== token e rotte');
  let r = await sup.call('echo', { url: '/api/echo/ping' });
  t('chiamata con il token giusto', r.status === 200 && json(r).pong === true, [r.status]);
  r = await ipc.request({ pipe: sup.pipeOf('echo'), token: 'sbagliato', url: '/api/echo/ping' });
  t('token sbagliato: 401', r.status === 401, r.status);
  r = await ipc.request({ pipe: sup.pipeOf('echo'), token: '', url: '/api/echo/ping' });
  t('token mancante: 401', r.status === 401, r.status);
  r = await sup.call('echo', { method: 'POST', url: '/api/echo/say', body: { a: 1, nome: 'è' } });
  t('POST con corpo JSON e caratteri accentati', r.status === 200 && json(r).echo.nome === 'è', json(r));
  r = await sup.call('echo', { url: '/api/echo/non-esiste' });
  t('rotta sconosciuta: 404', r.status === 404, r.status);
  r = await sup.call('echo', { method: 'POST', url: '/api/echo/denied', body: {} });
  t('errore di permesso del servizio: 403 con code role', r.status === 403 && json(r).code === 'role', [r.status, json(r)]);
  r = await sup.call('echo', { method: 'POST', url: '/api/echo/boom', body: {} });
  t('errore generico del servizio: 400 con messaggio', r.status === 400 && /errore del servizio/.test(json(r).error), [r.status, json(r)]);
  r = await sup.call('echo', { url: '/_nacp/health' });
  t('health check', r.status === 200 && json(r).service === 'echo', json(r));
  const big = 'x'.repeat(5 * 1024 * 1024);
  r = await sup.call('echo', { method: 'POST', url: '/api/echo/say', body: { big }, timeoutMs: 20000 });
  t('corpo grande (5 MB) andata e ritorno', r.status === 200 && json(r).echo.big.length === big.length, r.status);
  const many = await Promise.all(Array.from({ length: 30 }, (_, i) => sup.call('echo', { method: 'POST', url: '/api/echo/say', body: { i } })));
  t('30 richieste in parallelo', many.every((x, i) => x.status === 200 && json(x).echo.i === i));

  console.log('== inoltro dal gateway (anche flussi SSE)');
  const gw = http.createServer((req, res) => { sup.forward('echo', req, res); });
  await new Promise((res) => gw.listen(0, '127.0.0.1', res));
  const gbase = 'http://127.0.0.1:' + gw.address().port;
  let g = await fetch(gbase + '/api/echo/ping', { headers: { Cookie: 'ui_session=segreto', Origin: gbase } });
  t('GET inoltrato', g.status === 200 && (await g.json()).pong === true, g.status);
  g = await fetch(gbase + '/api/echo/say', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ k: 'v' }) });
  t('POST inoltrato con il corpo', g.status === 200 && (await g.json()).echo.k === 'v', g.status);
  g = await fetch(gbase + '/api/echo/sse');
  const reader = g.body.getReader(); let got = '';
  const t0 = Date.now();
  while (Date.now() - t0 < 4000 && (got.match(/data:/g) || []).length < 3) { const c = await reader.read(); if (c.done) break; got += Buffer.from(c.value).toString('utf8'); }
  t('il flusso SSE arriva a pezzi (almeno 3 eventi)', (got.match(/data:/g) || []).length >= 3 && g.headers.get('content-type').includes('event-stream'), got.slice(0, 80));
  await reader.cancel();
  const closed = await waitFor(async () => (json(await sup.call('echo', { url: '/api/echo/stats' })).closedStreams >= 1));
  t('se il browser si scollega, si chiude anche il flusso nel servizio', !!closed);
  gw.closeAllConnections(); gw.close();

  console.log('== caduta e riavvio');
  const pid1 = sup.status().echo.pid;
  await sup.call('echo', { url: '/api/echo/die' });
  const down = await waitFor(() => sup.status().echo.state !== 'ready', 3000);
  t('la caduta viene rilevata', !!down, sup.status().echo);
  r = await sup.call('echo', { url: '/api/echo/ping', waitMs: 8000 });
  t('il servizio riparte da solo e risponde', r.status === 200 && json(r).pid !== pid1, [r.status, json(r), pid1]);
  t('evento di caduta registrato', events.some((e) => e.type === 'crash' && e.service === 'echo' && e.code === 3), events.filter((e) => e.type === 'crash'));

  console.log('== fermata');
  const pid2 = sup.status().echo.pid;
  await sup.stop();
  t('fermata ordinata: stato stopped e processo terminato', sup.status().echo.state === 'stopped' && !alive(pid2), [sup.status().echo, alive(pid2)]);
  let reachable = true; try { await ipc.request({ pipe: sup.pipeOf('echo'), token: sup.token, url: '/_nacp/health', timeoutMs: 800 }); } catch { reachable = false; }
  t('dopo la fermata la pipe non risponde più', !reachable);
  let rejected = null; try { await sup.call('echo', { url: '/api/echo/ping' }); } catch (e) { rejected = e.message; }
  t('chiamare un servizio fermo dà un errore chiaro', /non è disponibile/.test(rejected || ''), rejected);

  console.log('== servizi difettosi');
  const bad = createSupervisor({ services: { echo: { script: ECHO, env: { FLAKY_MODE: 'exit-at-start' } } }, readyTimeoutMs: 5000 });
  let msg = ''; try { await bad.start(); } catch (e) { msg = e.message; }
  t('un servizio che esce all\'avvio fa fallire start() con il suo output', /si è chiuso all'avvio/.test(msg) && /errore finto/.test(msg), msg);
  await sleep(500);
  t('e non lascia processi né riavvii in corso', bad.status().echo.state === 'stopped' && bad.status().echo.pid === 0, bad.status().echo);
  const loop = createSupervisor({ services: { echo: { script: ECHO, env: { FLAKY_MODE: 'die-after-ready' } } }, restart: { max: 2, windowMs: 30000, backoffMs: [50, 50] }, onEvent: (e) => events.push(e) });
  await loop.start();
  const failed = await waitFor(() => loop.status().echo.state === 'failed', 10000);
  t('un servizio che cade in continuazione smette di essere riavviato (failed)', !!failed, loop.status().echo);
  let m2 = ''; try { await loop.call('echo', { url: '/api/echo/ping', waitMs: 500 }); } catch (e) { m2 = e.message; }
  t('e le chiamate ricevono un errore chiaro', /non è disponibile \(failed\)/.test(m2), m2);
  await loop.stop();
  const lateGw = http.createServer((req, res) => { loop.forward('echo', req, res); });
  await new Promise((res) => lateGw.listen(0, '127.0.0.1', res));
  const f = await fetch('http://127.0.0.1:' + lateGw.address().port + '/api/echo/ping');
  t('il gateway risponde 503 con il motivo se il servizio non c\'è', f.status === 503 && /non è disponibile/.test((await f.json()).error), f.status);
  lateGw.closeAllConnections(); lateGw.close();

  console.log('== nessun orfano se il gateway muore');
  const parent = spawn(process.execPath, [path.join(__dirname, '..', 'fixtures', 'supervisor-parent.js')], { stdio: ['ignore', 'pipe', 'pipe'] });
  let outp = ''; parent.stdout.on('data', (d) => { outp += d; });
  const info = await waitFor(() => { try { return JSON.parse(outp.trim().split('\n')[0]); } catch { return null; } }, 10000);
  t('gateway di prova avviato con il suo servizio', !!info && info.pid > 0, outp);
  if (info) {
    process.kill(parent.pid, 'SIGKILL'); // solo il padre (su Windows senza l'albero): è il caso peggiore, un crash del gateway
    t('il padre è terminato', await waitFor(() => !alive(parent.pid), 5000));
    t('il servizio si chiude da solo senza il suo gateway', await waitFor(() => !alive(info.pid), 6000));
  }

  console.log('RISULTATO: ' + ok + ' ok, ' + ko + ' ko');
  setTimeout(() => process.exit(ko ? 1 : 0), 250);
})().catch((e) => { console.log('ERRORE', e.stack || e.message); process.exit(2); });
