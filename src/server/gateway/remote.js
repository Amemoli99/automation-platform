// Aree che girano come servizi separati (processi figli su pipe con nome). Il gateway controlla accesso e permessi come sempre,
// poi inoltra le richieste di quelle aree al loro servizio. Se un servizio non parte, l'area resta in-process: l'app non si ferma.
//   NACP_SERVICES=jira,...   aree da avviare come servizi (default: jira, tools, pipelines, git, mcp, repos, project, session); vuoto oppure NACP_INPROC=1 = tutto in un processo.
'use strict';
const fs = require('fs');
const path = require('path');
const paths = require('../infra/paths');
const ipc = require('../infra/ipc');
const { createSupervisor } = require('../supervisor');
const { state } = require('../state');

// servizio -> rotte che gli spettano, come "METODO percorso" (METODO può essere *; un percorso che finisce con * è un prefisso).
// Le rotte che cambiano lo stato dell'app restano nel gateway (gateway/*.js) e non compaiono qui.
const TABLE = {
  jira: ['* /api/jira/*'],
  tools: ['* /api/tools*'],
  pipelines: ['* /api/pipelines*'],
  git: ['* /api/git/*'],
  mcp: ['* /api/mcp/*'],
  repos: ['* /api/repos/sources*', '* /api/repos/list*'], // il clone passa dal gateway (gateway/repos.js): cambia il progetto agganciato
  session: ['GET /api/events', 'GET /api/steps', 'POST /api/start', 'POST /api/send', 'POST /api/btw', 'POST /api/allow', 'POST /api/stop'],
  project: [
    'GET /api/project/inspect', 'GET /api/project/pipeline', 'GET /api/config', 'GET /api/claude/auth', 'GET /api/claude/login',
    'POST /api/project/prepare', 'POST /api/tests/existing', 'POST /api/pipeline/preview', 'POST /api/project/pick-folder', 'POST /api/project/plan',
    'POST /api/project/verify', 'POST /api/m2/token', 'POST /api/config/permissions', 'POST /api/config/profile', 'POST /api/claude/login', 'POST /api/claude/login/cancel',
  ],
};
const matches = (patterns, method, url) => patterns.some((pat) => {
  const i = pat.indexOf(' ');
  const m = pat.slice(0, i), path = pat.slice(i + 1);
  return (m === '*' || m === method) && (path.endsWith('*') ? url.startsWith(path.slice(0, -1)) : url === path);
});

function enabledNames() {
  if (process.env.NACP_INPROC === '1') return [];
  const raw = process.env.NACP_SERVICES;
  const list = raw === undefined ? ['jira', 'tools', 'pipelines', 'git', 'mcp', 'repos', 'project', 'session'] : raw.split(',').map((s) => s.trim()).filter(Boolean);
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
    // "sessione in corso" vive nel servizio Session: il gateway ne tiene una copia perché git, progetto e cambio progetto la consultano
    if (e.type === 'message' && e.service === 'session' && e.message.type === 'running') state.running = !!e.message.running;
    if (e.type === 'state' && e.service === 'session' && e.state !== 'ready') state.running = false; // il servizio è caduto o si ferma: nessun claude in corso
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
  const serviceFor = (method, url) => {
    const p = String(url).split('?')[0];
    for (const n of live) if (matches(TABLE[n], method, p)) return n;
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
  const controlOr = (name, op, body, local) => (has(name) ? control(name, op, body) : local());
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
  return { start, has, serviceFor, forward, call, control, controlOr, broadcast, callOr, status, stop, names: () => [...live] };
}

module.exports = { create, TABLE };
