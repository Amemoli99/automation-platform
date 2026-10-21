// Nexsoft Automation Cockpit: interfaccia locale per sviluppare test automatici con la pipeline /implementTest. Zero dipendenze: node src/server/main.js
// Avvia `claude` in modalità stream-json e inoltra eventi al browser via SSE. Qui: avvio del server HTTP, controlli comuni e smistamento alle aree in routes/.
const http = require('http');
const paths = require('./infra/paths');
const mcpenv = require('./services/mcpenv');
const mcpclient = require('./services/mcpclient');
const git = require('./services/git');
const demo = require('./services/demo');
const license = require('./services/license');
const { openInIde } = require('./services/ide');
const { capFor, denyMessage } = require('./http/caps');
const { createAuth } = require('./http/auth');
const { serveStatic } = require('./http/static');
const { state, saveState, needRoot } = require('./state');
const session = require('./session');
const workspace = require('./workspace');
const { NOT_HANDLED } = require('./routes/common');

// Aree della API, nell'ordine in cui vengono interrogate. Ognuna espone get(ctx) e post(ctx) e risponde NOT_HANDLED per le rotte che non sono sue.
const AREAS = [require('./routes/system'), require('./routes/run'), require('./routes/config'), require('./routes/project'), require('./routes/repos'),
  require('./routes/git'), require('./routes/jira'), require('./routes/mcp'), require('./routes/pipelines'), require('./routes/tools')]; // require statici: il pacchetto li unisce con esbuild
const MAX_BODY = Math.ceil(session.MAX_TOTAL * 1.4); // base64 + overhead JSON

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

  const ctx = { req, res, json, body: null, shutdown };
  try {
    const need = capFor(req.method, req.url);
    if (need) {
      const st = license.current();
      if (!license.allows(st, need, !!state.demo)) return json(403, { error: denyMessage(st, need), code: 'role', role: st.role, need });
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
      if (req.url === '/api/demo') { if (body.on) workspace.demoEnter(); else workspace.demoLeave(); return json(200, { on: !!state.demo }); }
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
server.listen(PORT, HOST, () => {
  console.log(`Nexsoft Automation Cockpit su http://${HOST}:${PORT}`);
  if (auth.AUTH_ON) {
    auth.writeSession();
    console.log(`Accesso protetto. Se non hai usato NexsoftAutomationCockpit.exe, apri: http://${HOST}:${PORT}/?t=${auth.TOKEN}`);
  } else console.warn('ATTENZIONE: UI_AUTH=off, accesso non protetto (solo per i test).');
});
