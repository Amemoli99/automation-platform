// Supervisore dei servizi: li avvia come processi figli, ognuno su una pipe con nome, li controlla e li riavvia se cadono, li ferma con calma.
// Non conosce nessuna area: riceve l'elenco { nome: { script, args, env } } da chi lo crea (main.js).
'use strict';
const { spawn } = require('child_process');
const ipc = require('./infra/ipc');
const { killTree } = require('./infra/proc');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DEFAULT_RESTART = { max: 4, windowMs: 60000, backoffMs: [200, 1000, 3000, 5000] }; // oltre `max` cadute in `windowMs` il servizio resta "failed"

function createSupervisor({ services, restart = {}, readyTimeoutMs = 15000, onEvent = () => {} }) {
  const policy = { ...DEFAULT_RESTART, ...restart };
  const session = ipc.newId(8);   // nome casuale delle pipe: cambia a ogni avvio
  const token = ipc.newId(24);    // segreto condiviso con i figli solo via ambiente
  const svc = {};                 // nome -> { def, pipe, state, child, pid, restarts[], tail, waiters, wantStop }
  for (const [name, def] of Object.entries(services)) svc[name] = { name, def, pipe: ipc.pipePath(session, name), state: 'stopped', child: null, pid: 0, crashes: [], tail: '', waiters: [], wantStop: false };

  const emit = (e) => { try { onEvent(e); } catch { /* chi ascolta non deve far cadere il supervisore */ } };
  const setState = (s, state) => { s.state = state; emit({ type: 'state', service: s.name, state, pid: s.pid }); if (state === 'ready' || state === 'failed') { for (const w of s.waiters.splice(0)) w(state); } };
  const note = (s, chunk) => { s.tail = (s.tail + chunk.toString('utf8')).slice(-4000); };

  function spawnOne(s) {
    return new Promise((resolve, reject) => {
      s.wantStop = false;
      setState(s, 'starting');
      const env = { ...process.env, ...(s.def.env || {}), NACP_SERVICE: s.name, NACP_PIPE: s.pipe, NACP_TOKEN: token };
      const child = spawn(process.execPath, [s.def.script, ...(s.def.args || [])], { env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
      s.child = child; s.pid = child.pid;
      child.stdout.on('data', (d) => note(s, d));
      child.stderr.on('data', (d) => note(s, d));
      let settled = false;
      const timer = setTimeout(() => { if (!settled) { settled = true; killTree(child); reject(new Error('Il servizio "' + s.name + '" non è partito entro ' + Math.round(readyTimeoutMs / 1000) + ' s.' + (s.tail ? ' Ultimo output: ' + s.tail.trim().slice(-300) : ''))); } }, readyTimeoutMs);
      child.on('message', (m) => { if (m && m.type === 'ready' && !settled) { settled = true; clearTimeout(timer); setState(s, 'ready'); resolve(); } });
      child.on('error', (e) => { clearTimeout(timer); if (!settled) { settled = true; setState(s, 'failed'); reject(e); } });
      child.on('exit', (code, signal) => {
        clearTimeout(timer);
        if (s.child !== child) return;
        s.child = null; s.pid = 0;
        if (!settled) { settled = true; reject(new Error('Il servizio "' + s.name + '" si è chiuso all\'avvio (codice ' + code + ').' + (s.tail ? ' Ultimo output: ' + s.tail.trim().slice(-300) : ''))); }
        if (s.wantStop) { setState(s, 'stopped'); return; }
        emit({ type: 'crash', service: s.name, code, signal });
        onCrash(s);
      });
    });
  }

  async function onCrash(s) {
    const now = Date.now();
    s.crashes = s.crashes.filter((t) => now - t < policy.windowMs); s.crashes.push(now);
    if (s.crashes.length > policy.max) { setState(s, 'failed'); emit({ type: 'failed', service: s.name, tail: s.tail }); return; }
    setState(s, 'restarting');
    await sleep(policy.backoffMs[Math.min(s.crashes.length - 1, policy.backoffMs.length - 1)]);
    if (s.wantStop) return;
    try { await spawnOne(s); } catch (e) { emit({ type: 'restart-error', service: s.name, error: e.message }); } // se il nuovo processo cade, ci pensa il suo 'exit' a riprovare
  }

  const get = (name) => { const s = svc[name]; if (!s) throw new Error('Servizio sconosciuto: ' + name); return s; };
  // Attende che il servizio sia pronto (utile mentre si sta riavviando).
  const whenReady = (s, ms) => new Promise((resolve, reject) => {
    if (s.state === 'ready') return resolve();
    if (s.state === 'failed' || s.state === 'stopped') return reject(new Error('Il servizio "' + s.name + '" non è disponibile (' + s.state + ').'));
    const t = setTimeout(() => reject(new Error('Il servizio "' + s.name + '" non è tornato disponibile in tempo.')), ms);
    s.waiters.push((st) => { clearTimeout(t); st === 'ready' ? resolve() : reject(new Error('Il servizio "' + s.name + '" non è disponibile (' + st + ').')); });
  });

  return {
    session, token,
    pipeOf: (name) => get(name).pipe,
    names: () => Object.keys(svc),
    async start(names = Object.keys(svc)) {
      try { await Promise.all(names.map((n) => spawnOne(get(n)))); } catch (e) { await this.stop(500); throw e; } // un avvio fallito non lascia processi in giro
    },
    async call(name, opts = {}) {
      const s = get(name);
      await whenReady(s, opts.waitMs == null ? 5000 : opts.waitMs);
      return ipc.request({ pipe: s.pipe, token, ...opts });
    },
    // Inoltra la richiesta del browser (gateway). Se il servizio non è disponibile risponde 503 con il motivo.
    async forward(name, req, res) {
      try { await whenReady(get(name), 3000); } catch (e) { res.writeHead(503, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: e.message })); return; }
      ipc.forward({ pipe: get(name).pipe, token, req, res });
    },
    status() { return Object.fromEntries(Object.values(svc).map((s) => [s.name, { state: s.state, pid: s.pid, pipe: s.pipe, crashes: s.crashes.length }])); },
    // Fermata ordinata: richiesta di chiusura, attesa breve, poi terminazione dell'albero di processi.
    async stop(graceMs = 3000) {
      await Promise.all(Object.values(svc).map(async (s) => {
        s.wantStop = true;
        const child = s.child;
        if (!child) { setState(s, 'stopped'); return; }
        const exited = new Promise((r) => child.once('exit', r));
        try { await ipc.request({ pipe: s.pipe, token, method: 'POST', url: '/_nacp/shutdown', body: {}, timeoutMs: 1500 }); } catch { /* già chiuso o non risponde */ }
        const ok = await Promise.race([exited.then(() => true), sleep(graceMs).then(() => false)]);
        if (!ok) { killTree(child); await Promise.race([exited, sleep(1500)]); }
        setState(s, 'stopped');
      }));
    },
  };
}

module.exports = { createSupervisor };
