// Aree che girano come servizi separati (processi figli su pipe con nome). Il gateway controlla accesso e permessi come sempre,
// poi inoltra le richieste di quelle aree al loro servizio. Se un servizio non parte, l'area resta in-process: l'app non si ferma.
//   NACP_SERVICES=jira,...   aree da avviare come servizi (default: jira, tools, pipelines, git, mcp, repos); vuoto oppure NACP_INPROC=1 = tutto in un processo.
'use strict';
const fs = require('fs');
const path = require('path');
const paths = require('../infra/paths');
const ipc = require('../infra/ipc');
const { createSupervisor } = require('../supervisor');
const { state } = require('../state');

// area -> prefissi di rotta serviti dal servizio. Un servizio per area (stesso nome).
const TABLE = {
  jira: ['/api/jira/'],
  tools: ['/api/tools'],
  pipelines: ['/api/pipelines'],
  git: ['/api/git/'],
  mcp: ['/api/mcp/'],
  repos: ['/api/repos/sources', '/api/repos/list'], // il clone passa dal gateway (gateway/repos.js): cambia il progetto agganciato
};

function enabledNames() {
  if (process.env.NACP_INPROC === '1') return [];
  const raw = process.env.NACP_SERVICES;
  const list = raw === undefined ? ['jira', 'tools', 'pipelines', 'git', 'mcp', 'repos'] : raw.split(',').map((s) => s.trim()).filter(Boolean);
  return list.filter((n) => TABLE[n]);
}

function create({ log = () => {} } = {}) {
  const names = enabledNames();
  const live = new Set(); // servizi avviati davvero (gli altri restano in-process)
  let sup = null;

  const entryOf = (n) => process.env['NACP_SERVICE_ENTRY_' + n.toUpperCase()] || paths.serviceEntry(n); // la variabile serve solo ai test
  // Dopo ogni (ri)avvio di un servizio gli si ripete lo stato che non vive nel suo processo (la modalità Demo).
  const onEvent = (e) => {
    log(e);
    if (e.type === 'state' && e.state === 'ready' && live.has(e.service) && state.demo) control(e.service, 'demo', { on: true }).catch(() => {});
  };

  async function start() {
    if (!names.length) return;
    const services = {};
    for (const n of names) {
      const script = entryOf(n);
      if (fs.existsSync(script)) services[n] = { script };
      else log({ type: 'skip', service: n, reason: 'entry non trovata: ' + script });
    }
    if (!Object.keys(services).length) return;
    sup = createSupervisor({ services, onEvent });
    // un servizio che non parte non ferma l'app: l'area resta in-process
    for (const n of Object.keys(services)) {
      try { await sup.start([n]); live.add(n); } catch (e) { log({ type: 'fallback', service: n, error: e.message }); }
    }
  }

  // Errore del servizio come l'avrebbe lanciato il codice locale: stesso messaggio, e lo stesso segno di permesso negato.
  function failure(r, fallback) {
    let j = null; try { j = JSON.parse(r.body.toString('utf8')); } catch { /* non JSON */ }
    return Object.assign(new Error((j && j.error) || fallback), { status: r.status, ...(j && j.code === 'role' ? { denied: true } : {}) });
  }
  const has = (name) => live.has(name);
  const serviceFor = (url) => {
    const p = String(url).split('?')[0];
    for (const n of live) if (TABLE[n].some((pre) => p.startsWith(pre))) return n;
    return null;
  };
  const forward = (name, req, res, context) => sup.forward(name, req, res, context);
  const call = (name, opts) => sup.call(name, opts);
  // Messaggio di controllo al servizio (es. 'demo'): lo gestisce il suo punto d'ingresso.
  async function control(name, op, body) {
    const r = await sup.call(name, { method: 'POST', url: '/_nacp/control/' + op, body: body || {}, waitMs: 8000 });
    if (r.status === 404 && /Controllo sconosciuto/.test(r.body.toString('utf8'))) return { ok: true, ignored: true }; // il servizio non ha questo controllo: non lo riguarda
    if (r.status !== 200) throw failure(r, 'Il servizio "' + name + '" ha rifiutato "' + op + '"');
    return JSON.parse(r.body.toString('utf8'));
  }
  const broadcast = (op, body) => Promise.all([...live].map((n) => control(n, op, body)));
  // Come chiamare un'area: via servizio se gira separata, altrimenti con la funzione locale.
  async function callOr(name, opts, local, context) {
    if (!has(name)) return local();
    const r = await call(name, { ...opts, headers: { ...(opts.headers || {}), [ipc.CONTEXT_HEADER]: ipc.encodeContext(context) } });
    if (r.status !== 200) throw failure(r, 'Servizio "' + name + '": ' + r.status);
    return JSON.parse(r.body.toString('utf8'));
  }
  const status = () => (sup ? sup.status() : {});
  const stop = async () => { if (sup) await sup.stop(); live.clear(); };
  return { start, has, serviceFor, forward, call, control, broadcast, callOr, status, stop, names: () => [...live] };
}

module.exports = { create, TABLE };
