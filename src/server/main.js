// Nexsoft Automation Cockpit: interfaccia locale per sviluppare test automatici con la pipeline /implementTest. Zero dipendenze: node src/server/main.js
// Avvia `claude` in modalità stream-json e inoltra eventi al browser via SSE. Qui: avvio del server HTTP, controlli comuni e smistamento alle aree in routes/.
const http = require('http');
const paths = require('./infra/paths');
const mcpenv = require('./areas/mcp').env;
const mcpclient = require('./areas/mcp').client;
const git = require('./areas/scm').git;
const demo = require('./areas/demo').demo;
const license = require('./areas/license').license;
const { openInIde } = require('./areas/platform').ide;
const { capFor, denyMessage } = require('./http/caps');
const { createAuth } = require('./http/auth');
const { serveStatic } = require('./http/static');
const { state, saveState, needRoot, prefsFor } = require('./state');
const session = require('./areas/session').session;
const demoMode = require('./areas/demo').mode;
const { NOT_HANDLED } = require('./http/route');
const remote = require('./gateway/remote').create({ log: (e) => { if (e.type === 'crash' || e.type === 'failed' || e.type === 'fallback' || e.type === 'skip') console.warn('[servizi]', JSON.stringify(e)); } });

// Aree della API, nell'ordine in cui vengono interrogate. Ognuna espone get(ctx) e post(ctx) e risponde NOT_HANDLED per le rotte che non sono sue.
const AREAS = [require('./gateway/system'), require('./gateway/repos'), require('./gateway/project'), require('./areas/session/routes'), require('./areas/project/routes'), require('./areas/scm/routes'),
  require('./areas/jira/routes'), require('./areas/mcp/routes'), require('./areas/pipelines/routes'), require('./areas/tools/routes')].flat(); // require statici: il pacchetto li unisce con esbuild
const MAX_BODY = Math.ceil(session.MAX_TOTAL * 1.4); // base64 + overhead JSON

// In-process la sessione dice direttamente allo stato dell'app se un claude è in corso; come servizio lo comunica il supervisore (gateway/remote.js).
session.hooks.onRunning = (running) => { state.running = running; };
// Progetto o modalità Demo cambiati: la sessione riparte da zero (come servizio, con un controllo).
state.events.on('reset', () => { if (remote.has('session')) remote.control('session', 'reset', {}).catch(() => { /* il servizio si riavvia da solo */ }); else session.reset(); });

const PORT = Number(process.env.UI_PORT || 4173);
const HOST = '127.0.0.1'; // solo locale: la UI pilota un agente con accesso al repo
const auth = createAuth({ HOST, PORT, dataDir: paths.dataDir });

const PUBLIC = paths.WEB_DIR;
if (state.root) mcpenv.warm(state.root).catch(() => { /* idem */ });
// Chiusura completa: termina la sessione claude (con i suoi figli) e poi il server stesso.
// Alla chiusura, se il lavoro sul progetto è tutto sistemato (nessuna modifica, nulla di non pubblicato, nessuna sessione) la
// piattaforma si sgancia: alla riapertura riparte pulita e il progetto resta tra i recenti. Altrimenti resta agganciata.
// I file di servizio della piattaforma (.tmp/, .playwright-mcp/) non contano come lavoro in sospeso.
async function detachIfClean() {
  if (state.demo || !state.root || state.running) return;
  try {
    const s = await git.status(state.root);
    // Senza git (non installato, init non riuscito, cartella non repository) non esiste lavoro "non pubblicato" che lo sgancio
    // possa far perdere, e restare agganciati per sempre sarebbe peggio: si sgancia (resta tra i recenti).
    // Con git valgono le regole: HEAD staccato o merge in corso -> resta agganciata.
    if (s.isRepo) {
      if (!s.branch || s.merging) return;
      const own = (p) => /^(\.tmp|\.playwright-mcp)(\/|$)/.test(p);
      // File di configurazione che scrive la piattaforma stessa (scheda Tool, editor pipeline, permessi): una loro modifica non è lavoro in sospeso.
      // Restano fuori da questo elenco codice, skill e agent: sono contenuti dell'utente e tengono agganciato il progetto.
      const platformFile = (p) => /^(\.mcp\.json|\.claude\/(settings|settings\.local|pipeline|pipeline-steps)\.json)$/.test(p);
      const noCommits = !s.locals.length; // repository appena creato senza commit iniziale: i file del wizard sono solo "non tracciati"
      if (!noCommits && s.entries.some((e) => !((e.untracked && own(e.path)) || platformFile(e.path)))) return;
      if (s.hasRemote && (s.ahead > 0 || !s.upstream)) return; // commit non pubblicati (o branch mai pubblicato)
    }
    state.recent = [state.root, ...state.recent.filter((x) => x !== state.root)].slice(0, 8);
    state.root = null;
    saveState();
  } catch { /* in caso di dubbio resta agganciata */ }
}
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await Promise.race([detachIfClean(), new Promise((r) => setTimeout(r, 4000))]);
  auth.removeSession();
  session.stop();
  await remote.stop();
  mcpclient.closeAll();
  server.close();
  setTimeout(() => process.exit(0), 500);
}
process.on('SIGINT', shutdown);

function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (d) => {
      b += d;
      if (b.length > MAX_BODY) reject(new Error('Body troppo grande'));
    });
    req.on('end', () => {
      try {
        resolve(b ? JSON.parse(b) : {});
      } catch (e) {
        reject(e);
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const json = (code, obj) => res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(obj));
  if (auth.guard(req, res, json)) return;

  // contesto della richiesta: ciò che le aree (anche quelle in un altro processo) devono sapere dello stato, senza leggerlo
  const lic = license.current();
  const context = { root: state.root, prefs: state.root ? prefsFor(state.root) : {}, allPrefs: state.prefs, demo: !!state.demo, running: state.running, caps: lic.caps, role: lic.role, roleLabel: lic.roleLabel };
  const ctx = { req, res, json, body: null, shutdown, remote, context };
  try {
    const need = capFor(req.method, req.url);
    if (need) {
      const st = license.current();
      if (!license.allows(st, need, !!state.demo)) return json(403, { error: denyMessage(st, need), code: 'role', role: st.role, need });
    }
    // Aree che girano come servizi separati: accesso e permessi sono già stati controllati qui, la richiesta passa com'è alla pipe del servizio.
    const svcName = remote.serviceFor(req.method, req.url);
    if (svcName && (req.method === 'GET' || req.method === 'POST')) {
      if (req.method === 'POST') {
        if (!(req.headers['content-type'] || '').includes('application/json')) return json(415, { error: 'JSON richiesto' });
        if (state.demo && demo.BLOCKED.has(req.url)) return json(403, { error: 'Non disponibile in modalità Demo: è una simulazione, non modifica nulla di reale.' });
      }
      return remote.forward(svcName, req, res, context);
    }
    if (req.method === 'GET') {
      for (const area of AREAS) { if ((await area.get(ctx)) !== NOT_HANDLED) return; }
    }
    if (req.method === 'POST') {
      if (!(req.headers['content-type'] || '').includes('application/json')) return json(415, { error: 'JSON richiesto' });
      ctx.body = await readBody(req);
      const body = ctx.body;
      if (req.url === '/api/license/import') return json(200, { ...license.importText(String(body.text || '')), inDemo: !!state.demo });
      if (req.url === '/api/ide/open') { if (state.demo) throw new Error('Non disponibile in modalità Demo: il progetto è una simulazione.'); return json(200, openInIde(needRoot(), body.path, body.line)); }
      if (req.url === '/api/demo') {
        if (body.on) demoMode.demoEnter(); else demoMode.demoLeave();
        try { await remote.broadcast('demo', { on: !!state.demo }); } catch (e) { if (body.on) demoMode.demoLeave(); throw e; } // i servizi seguono la modalità
        return json(200, { on: !!state.demo });
      }
      if (state.demo && demo.BLOCKED.has(req.url)) return json(403, { error: 'Non disponibile in modalità Demo: è una simulazione, non modifica nulla di reale.' });
      for (const area of AREAS) { if ((await area.post(ctx)) !== NOT_HANDLED) return; }
    }
    if (req.method === 'GET' && serveStatic(req, res, PUBLIC)) return;
    if (req.url.startsWith('/api/')) return json(404, { error: 'Questa funzione non esiste in questa versione del server della UI. Chiudi la UI e riaprila (NexsoftAutomationCockpit.exe) per caricare l\'ultima versione.' });
    res.writeHead(404).end('Not found');
  } catch (e) {
    json(e && e.denied ? 403 : 400, { error: e.message, ...(e && e.denied ? { code: 'role' } : {}) });
  }
});

process.on('exit', auth.removeSession);
// Si ascolta solo dopo l'avvio dei servizi (un servizio che non parte lascia l'area in-process: vedi gateway/remote.js).
remote.start().catch((e) => console.warn('[servizi] avvio non riuscito:', e.message)).then(() => server.listen(PORT, HOST, () => {
  console.log(`Nexsoft Automation Cockpit su http://${HOST}:${PORT}`);
  if (auth.AUTH_ON) {
    auth.writeSession();
    console.log(`Accesso protetto. Se non hai usato NexsoftAutomationCockpit.exe, apri: http://${HOST}:${PORT}/?t=${auth.TOKEN}`);
  } else console.warn('ATTENZIONE: UI_AUTH=off, accesso non protetto (solo per i test).');
}));
