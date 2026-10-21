// Nexsoft Automation Cockpit: interfaccia locale per sviluppare test automatici con la pipeline /implementTest. Zero dipendenze: node ui/server.js
// Avvia `claude` in modalità stream-json e inoltra eventi al browser via SSE.
const http = require('http');
const fs = require('fs');
const path = require('path');
const paths = require('./infra/paths');
const { spawnClaude } = require('./infra/claude');
const { killTree } = require('./infra/proc');
const { spawn } = require('child_process');
const config = require('./services/config');
const projects = require('./services/projects');
const pipelines = require('./services/pipelines');
const mcpenv = require('./services/mcpenv');
const { redact, describeTool } = require('./services/redact');
const mcpclient = require('./services/mcpclient');
const mcppanels = require('./services/mcppanels');
const mcpask = require('./services/mcpask');
const jdks = require('./services/jdks');
const tools = require('./services/tools');
const appinfo = require('./services/appinfo');
const report = require('./services/report');
const registry = require('./services/registry');
const git = require('./services/git');
const os = require('os');
const repos = require('./services/repos');
const jira = require('./services/jira');
const demo = require('./services/demo');
const crypto = require('crypto');
const license = require('./services/license');
const { capFor, requireCap, denyMessage } = require('./http/caps');
const { createAuth } = require('./http/auth');
const { state, isDir, prefsFor, saveState, needRoot } = require('./state');
const session = require('./session');
const MAX_BODY = Math.ceil(session.MAX_TOTAL * 1.4); // base64 + overhead JSON
const { serveStatic } = require('./http/static');

const PORT = Number(process.env.UI_PORT || 4173);
const HOST = '127.0.0.1'; // solo locale: la UI pilota un agente con accesso al repo
const auth = createAuth({ HOST, PORT, dataDir: paths.dataDir });

const isProtectedBranch = (s) => !!s.branch && (['main', 'master'].includes(s.branch) || s.branch === s.baseBranch);

const PUBLIC = paths.WEB_DIR;
if (state.root) mcpenv.warm(state.root).catch(() => { /* idem */ });
// IntelliJ IDEA: UI_IDEA_BIN, poi le installazioni più comuni su Windows (la più recente per prima).
let ideaBin;
function findIdea() {
  if (ideaBin !== undefined) return ideaBin;
  const cands = [];
  if (process.env.UI_IDEA_BIN) cands.push(process.env.UI_IDEA_BIN);
  const sub = (dir, re) => { try { return fs.readdirSync(dir).filter((n) => re.test(n)).sort().reverse().map((n) => path.join(dir, n)); } catch { return []; } };
  for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean)) {
    for (const d of sub(path.join(base, 'JetBrains'), /^IntelliJ IDEA/i)) cands.push(path.join(d, 'bin', 'idea64.exe'));
  }
  if (process.env.LOCALAPPDATA) {
    for (const d of sub(path.join(process.env.LOCALAPPDATA, 'Programs'), /^IntelliJ IDEA/i)) cands.push(path.join(d, 'bin', 'idea64.exe'));
    const tb = path.join(process.env.LOCALAPPDATA, 'JetBrains', 'Toolbox', 'apps');
    for (const app of sub(tb, /^(IDEA|intellij)/i)) for (const ch of sub(app, /^ch-/)) for (const v of sub(ch, /^\d/)) cands.push(path.join(v, 'bin', 'idea64.exe'));
  }
  ideaBin = cands.find((c) => { try { return fs.statSync(c).isFile(); } catch { return false; } }) || null;
  return ideaBin;
}
// Apre un file (o una cartella) del progetto in IntelliJ, alla riga indicata. Nessuna shell: argomenti passati come array.
function openInIde(rel, line) {
  if (state.demo) throw new Error('Non disponibile in modalità Demo: il progetto è una simulazione.');
  const root = needRoot();
  const bin = findIdea();
  if (!bin) throw new Error('IntelliJ IDEA non trovato. Installalo oppure imposta la variabile UI_IDEA_BIN con il percorso di idea64.exe e riavvia la UI.');
  const full = path.resolve(root, String(rel || ''));
  const back = path.relative(root, full);
  if (back.startsWith('..') || path.isAbsolute(back)) throw new Error('Il file non è dentro il progetto.');
  if (!fs.existsSync(full)) throw new Error('Il file non esiste (ancora) nel progetto: ' + (back || String(rel)).replace(/\\/g, '/'));
  const n = Number(line);
  const args = [root, ...(Number.isInteger(n) && n > 0 && n < 10000000 ? ['--line', String(n)] : []), full];
  const p = spawn(bin, args, { detached: true, stdio: 'ignore' });
  p.on('error', () => { ideaBin = undefined; });
  p.unref();
  return { ok: true, ide: path.basename(path.dirname(path.dirname(bin))) };
}

// Origini Git: l'app parte SENZA nessuna origine collegata e non ne deduce più dai progetti presenti sul computer.
// Quelle aggiunte dall'utente restano salvate ("savedList") e si collegano con un clic; "sources" sono solo quelle collegate in questa sessione.
async function ownerSources() {
  const saved = state.sources.map(repos.describeSource);
  return { sources: saved.filter((s) => state.linked.has(s.key)), savedList: saved, saved: state.sources.length > 0, discovered: [] };
}
// Origine richiesta dal browser: deve essere una di quelle configurate o dedotte (mai un host arbitrario).
async function allowedSource(body) {
  const src = repos.normalizeSource(body.source || { provider: 'github', owner: body.owner });
  const { sources } = await ownerSources();
  if (!sources.some((s) => s.key === repos.sourceKey(src))) throw new Error('Origine non configurata: aggiungila prima alla lista delle origini.');
  return src;
}

// Chiavi dei ticket che hanno già un test nel progetto (classe <PREFISSO>_<n>.java, es. NX-2 -> NX_2.java). Sola lettura.
function existingTests(keys) {
  const root = needRoot();
  const want = new Map();
  for (const k of (Array.isArray(keys) ? keys : []).slice(0, 500)) {
    if (/^[A-Z][A-Z0-9_]{1,19}-\d+$/.test(String(k))) want.set(String(k).replace('-', '_'), String(k));
  }
  const found = {};
  let seen = 0;
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (++seen > 30000) return;
      if (e.isDirectory()) { if (!['node_modules', '.git', 'target', '.idea'].includes(e.name)) walk(path.join(dir, e.name)); continue; }
      if (!e.name.endsWith('.java')) continue;
      const key = want.get(e.name.slice(0, -5));
      if (key && !found[key]) found[key] = path.relative(root, path.join(dir, e.name)).split(path.sep).join('/');
    }
  };
  walk(path.join(root, 'src'));
  return found;
}

const projectInfo = () => ({
  attached: !!state.root,
  root: state.root,
  name: state.root ? path.basename(state.root) : null,
  kit: projects.KIT,
  workspace: state.workspace,
  running: session.isRunning(),
  recent: state.recent.filter((d) => isDir(d) && d !== state.root),
  m2: projects.m2Status(),
  frameworkRepo: state.frameworkRepo,
});

// Chiusura completa: termina la sessione claude (con i suoi figli) e poi il server stesso.
// Alla chiusura, se il lavoro sul progetto è tutto sistemato (nessuna modifica, nulla di non pubblicato, nessuna sessione) la
// piattaforma si sgancia: alla riapertura riparte pulita e il progetto resta tra i recenti. Altrimenti resta agganciata.
// I file di servizio della piattaforma (.tmp/, .playwright-mcp/) non contano come lavoro in sospeso.
async function detachIfClean() {
  if (state.demo || !state.root || session.isRunning()) return;
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

  try {
    const need = capFor(req.method, req.url);
    if (need) {
      const st = license.current();
      if (!license.allows(st, need, !!state.demo)) return json(403, { error: denyMessage(st, need), code: 'role', role: st.role, need });
    }
    if (req.method === 'GET' && req.url === '/api/license') return json(200, { ...license.current(), inDemo: !!state.demo });
    if (req.method === 'GET' && req.url === '/api/events') return session.attachClient(req, res);
    if (req.method === 'GET' && req.url === '/api/demo') return json(200, { on: !!state.demo });
    if (req.method === 'GET' && req.url === '/api/steps') return json(200, session.STEPS);
    if (req.method === 'GET' && req.url === '/api/project') return json(200, projectInfo());
    if (req.method === 'GET' && req.url === '/api/repos/sources') return json(200, await ownerSources());
    if (req.method === 'GET' && req.url === '/api/jira/state') return json(200, jira.publicState());
    if (req.method === 'GET' && req.url === '/api/jira/verify') return json(200, await jira.verifyConnection());
    if (req.method === 'GET' && req.url === '/api/jira/discover') return json(200, { candidates: await jira.discoverWindowsCredentials() });
    if (req.method === 'GET' && req.url === '/api/git/status') return json(200, await git.status(needRoot()));
    if (req.method === 'GET' && req.url === '/api/project/inspect') return json(200, projects.inspect(needRoot(), prefsFor(state.root)));
    if (req.method === 'GET' && req.url === '/api/project/pipeline') return json(200, projects.resolvePipeline(needRoot(), prefsFor(state.root)));
    if (req.method === 'GET' && req.url === '/api/claude/auth') return json(200, await config.authStatus());
    if (req.method === 'GET' && req.url === '/api/claude/login') return json(200, config.loginState());
    if (req.method === 'GET' && req.url === '/api/config') return json(200, config.readConfig(needRoot()));
    if (req.method === 'GET' && req.url === '/api/mcp/servers') {
      const root = needRoot();
      return json(200, { project: path.basename(root), servers: mcpclient.servers(root).map((s) => { const st = mcpenv.status(root, s.name); return { ...s, vars: s.vars.map((n) => ({ name: n, set: !!st[n], inEnv: !!process.env[n] })), hasPanel: !!mcppanels.load(s.name), mode: mcpask.modeOf(s.name) }; }) });
    }
    if (req.method === 'GET' && req.url.startsWith('/api/mcp/panel?')) return json(200, { descriptor: mcppanels.load(new URL(req.url, 'http://x').searchParams.get('server')) });
    if (req.method === 'GET' && req.url.startsWith('/api/mcp/ask-active?')) return json(200, mcpask.active(new URL(req.url, 'http://x').searchParams.get('server')));
    if (req.method === 'GET' && req.url.startsWith('/api/pipelines/fix-active?')) { const q = new URL(req.url, 'http://x').searchParams; return json(200, pipelines.fixActive(q.get('kind'), q.get('name'))); }
    if (req.method === 'GET' && req.url.startsWith('/api/mcp/ask-status?')) return json(200, mcpask.status(new URL(req.url, 'http://x').searchParams.get('id')));
    if (req.method === 'GET' && req.url === '/api/pipelines') return json(200, { project: path.basename(needRoot()), ...pipelines.list(needRoot()) });
    if (req.method === 'GET' && req.url.startsWith('/api/pipelines/steps?')) return json(200, pipelines.getSteps(needRoot(), new URL(req.url, 'http://x').searchParams.get('skill')));
    if (req.method === 'GET' && req.url.startsWith('/api/pipelines/link-preview?')) {
      const q = new URL(req.url, 'http://x').searchParams;
      return json(200, pipelines.linkPreview(needRoot(), q.get('skill'), q.get('agent')));
    }
    if (req.method === 'GET' && req.url.startsWith('/api/pipelines/fix-status?')) return json(200, pipelines.fixStatus(new URL(req.url, 'http://x').searchParams.get('id')));
    if (req.method === 'GET' && req.url.startsWith('/api/pipelines/item?')) {
      const q = new URL(req.url, 'http://x').searchParams;
      return json(200, pipelines.read(needRoot(), q.get('kind'), q.get('name')));
    }
    if (req.method === 'GET' && req.url === '/api/diagnostics') return json(200, await config.diagnostics(state.root || projects.KIT, { noProject: !state.root, jdk: state.root ? prefsFor(state.root).jdk : '' }));
    if (req.method === 'GET' && req.url === '/api/tools') return json(200, await tools.collect(state.root, state.root ? prefsFor(state.root).jdk : ''));
    if (req.method === 'GET' && req.url === '/api/diagnostics/export') { // report Markdown per il supporto: nessun segreto (vedi report.js)
      const jdk = state.root ? prefsFor(state.root).jdk : '';
      const safe = async (fn) => { try { return await fn(); } catch { return null; } };
      const diag = (await safe(() => config.diagnostics(state.root || projects.KIT, { noProject: !state.root, jdk }))) || [];
      const toolsInfo = await safe(() => tools.collect(state.root, jdk));
      let project = { attached: false };
      if (state.root) {
        const insp = await safe(() => projects.inspect(state.root, prefsFor(state.root)));
        const pipe = insp && insp.pipeline;
        project = { attached: true, name: path.basename(state.root), dir: state.root, skill: pipe && pipe.chosen, args: pipe && pipe.args, steps: pipe ? (pipe.steps ? pipe.steps.length : (pipe.stepsMeaningful ? session.STEPS.length : 0)) : null, jdk, items: (insp && insp.items) || [] };
      }
      const lic = await safe(() => license.current());
      const jst = await safe(() => jira.publicState());
      const md = report.build({ now: new Date(), app: appinfo.info(), demo: !!state.demo, diag, project, tools: toolsInfo, license: lic, jira: jst && { configured: !!jst.configured, source: jst.source }, session: { status: session.getStatus() } });
      const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
      res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': 'attachment; filename="nacp-diagnostica-' + stamp + '.md"', 'Cache-Control': 'no-store' }).end(md);
      return;
    }
    if (req.method === 'GET' && req.url === '/api/version') return json(200, appinfo.info());
    if (req.method === 'GET' && req.url.startsWith('/api/tools/registry')) { // ricerca o elenco nel registro ufficiale MCP (sola lettura, serve internet)
      const p = new URL(req.url, 'http://localhost').searchParams;
      return json(200, await registry.search(p.get('q')));
    }
    if (req.method === 'GET' && req.url === '/api/tools/catalog') return json(200, await tools.catalog(state.root));
    if (req.method === 'GET' && req.url === '/api/tools/mcp-status') return json(200, { items: await tools.mcpStatus(state.root, state.root ? prefsFor(state.root).jdk : '') });
    if (req.method === 'GET' && req.url === '/api/jdks') { const l = jdks.list(); const sel = state.root ? prefsFor(state.root).jdk || '' : ''; return json(200, { ...l, selected: sel, selectedValid: !sel || !!jdks.validHome(sel) }); }
    if (req.method === 'POST') {
      if (!(req.headers['content-type'] || '').includes('application/json')) return json(415, { error: 'JSON richiesto' });
      const body = await readBody(req);
      if (req.url === '/api/license/import') return json(200, { ...license.importText(String(body.text || '')), inDemo: !!state.demo });
      if (req.url === '/api/ide/open') return json(200, openInIde(body.path, body.line));
      if (req.url === '/api/demo') { if (body.on) session.demoEnter(); else session.demoLeave(); return json(200, { on: !!state.demo }); }
      if (state.demo && demo.BLOCKED.has(req.url)) return json(403, { error: 'Non disponibile in modalità Demo: è una simulazione, non modifica nulla di reale.' });
      if (req.url === '/api/claude/login') return json(200, config.startLogin());
      if (req.url === '/api/claude/login/cancel') return json(200, config.stopLogin());
      if (req.url === '/api/start') { await mcpenv.warm(state.root).catch(() => { /* credenziali non leggibili: le variabili risultano non impostate */ }); return session.start(String(body.ticket || '').trim(), body.permissionMode || 'acceptEdits', body.attachments), json(200, { ok: true }); }
      if (req.url === '/api/btw') return json(200, await session.askBtw(body.question));
      if (req.url === '/api/send') return session.send(String(body.text || ''), body.attachments), json(200, { ok: true });
      if (req.url === '/api/config/permissions') return json(200, { allow: config.savePermissions(needRoot(), body.allow) });
      if (req.url === '/api/config/profile') return json(200, { value: config.saveProfileValue(needRoot(), body.key, body.value) });
      if (req.url === '/api/mcp/env') { const root = needRoot(); await mcpenv.set(root, String(body.server || ''), body.values); mcpclient.stop(root, String(body.server)); return json(200, { vars: mcpenv.status(root, String(body.server)) }); }
      if (req.url === '/api/mcp/tools') { const r = await mcpclient.listTools(needRoot(), String(body.server || '')); return json(200, { server: r.server, tools: r.tools.map((t) => ({ ...t, risk: mcpclient.risk(t) })) }); }
      if (req.url === '/api/mcp/mode') return json(200, mcpask.setMode(String(body.server || ''), String(body.mode || '')));
      if (req.url === '/api/mcp/ask') return json(200, await mcpask.start(needRoot(), String(body.server || ''), body.request, { ...jdks.envFor(prefsFor(state.root).jdk), ...mcpenv.cached(state.root) }));
      if (req.url === '/api/mcp/ask-cancel') return json(200, mcpask.cancel(body.id));
      if (req.url === '/api/mcp/plan') { const s = String(body.server || ''); const r = await mcpclient.listTools(needRoot(), s); return json(200, await mcppanels.plan(s, r.tools.map((t) => ({ ...t, risk: mcpclient.risk(t) })), body.request)); }
      if (req.url === '/api/mcp/call') {
        try { return json(200, await mcpclient.callTool(needRoot(), String(body.server || ''), String(body.tool || ''), body.args, body.confirm === true)); }
        catch (e) { if (e && e.needsConfirm) return json(409, { error: e.message, needsConfirm: true, risk: e.risk }); throw e; }
      }
      if (req.url === '/api/mcp/stop') { mcpclient.stop(needRoot(), String(body.server || '')); return json(200, { ok: true }); }
      if (req.url === '/api/mcp/panel/auto') { const s = String(body.server || ''); const r = await mcpclient.listTools(needRoot(), s); return json(200, { descriptor: mcppanels.validate(s, mcppanels.autoDescriptor(s, r.tools), r.tools) }); }
      if (req.url === '/api/mcp/panel/draft') { const s = String(body.server || ''); const r = await mcpclient.listTools(needRoot(), s); return json(200, { descriptor: await mcppanels.draft(s, r.tools) }); }
      if (req.url === '/api/mcp/panel/save') { const s = String(body.server || ''); const r = await mcpclient.listTools(needRoot(), s); const d = mcppanels.validate(s, body.descriptor, r.tools); mcppanels.save(s, d); return json(200, { descriptor: d }); }
      if (req.url === '/api/mcp/panel/delete') { mcppanels.remove(String(body.server || '')); return json(200, { ok: true }); }
      if (req.url === '/api/pipelines/save') return json(200, pipelines.save(needRoot(), body));
      if (req.url === '/api/pipelines/agent') return json(200, pipelines.createAgent(needRoot(), body));
      if (req.url === '/api/pipelines/steps') return json(200, pipelines.saveSteps(needRoot(), body.steps));
      if (req.url === '/api/pipelines/draft') return json(200, await pipelines.draftAgent(needRoot(), body.description));
      if (req.url === '/api/pipelines/fix') return json(200, pipelines.fixStart(needRoot(), body.kind, body.name));
      if (req.url === '/api/pipelines/fix-cancel') return json(200, pipelines.fixCancel(body.id));
      if (req.url === '/api/pipelines/fix-apply') return json(200, pipelines.fixApply(needRoot(), body));
      if (req.url === '/api/pipelines/skill') return json(200, pipelines.createSkill(needRoot(), body));
      if (req.url === '/api/pipelines/draft-skill') return json(200, await pipelines.draftSkill(needRoot(), body.description));
      if (req.url === '/api/pipelines/skill-steps') return json(200, pipelines.saveSkillSteps(needRoot(), body.skill, body.steps));
      if (req.url === '/api/pipelines/link') return json(200, pipelines.linkApply(needRoot(), body));
      if (req.url.startsWith('/api/git/')) {
        // Le operazioni git modificano l'albero di lavoro: mai mentre la pipeline sta scrivendo file.
        if (session.isRunning()) throw new Error('Termina la sessione in corso prima di operare su git.');
        const root = needRoot();
        const op = req.url.slice('/api/git/'.length);
        if (op === 'push' || op === 'merge') { const s0 = await git.status(root); if (isProtectedBranch(s0)) requireCap('git.protected', op === 'push' ? 'di pubblicare sul branch principale (' + s0.branch + ')' : 'di unire dentro il branch principale (' + s0.branch + ')'); }
        const ops = {
          update: () => git.update(root),
          switch: () => git.switchTo(root, body.name, !!body.remote),
          create: () => git.create(root, body.name, body.from),
          merge: () => git.merge(root, body.source),
          'merge-abort': () => git.abortMerge(root),
          push: () => git.push(root),
          commit: () => git.commit(root, body.files, body.message),
        };
        if (Object.prototype.hasOwnProperty.call(ops, op)) {
          const r = await ops[op]();
          return json(200, { ...r, status: await git.status(root) });
        }
      }
      if (req.url === '/api/project/prepare') {
        if (session.isRunning()) throw new Error('Termina la sessione in corso prima di preparare il progetto');
        const r = projects.configureExisting({ dir: needRoot(), prefs: prefsFor(state.root), addKit: !!body.addKit });
        return json(200, { ...r, inspect: projects.inspect(state.root, prefsFor(state.root)) });
      }
      if (req.url === '/api/tests/existing') return json(200, { existing: existingTests(body.keys) });
      if (req.url.startsWith('/api/jira/')) {
        const op = req.url.slice('/api/jira/'.length);
        if (!['config', 'config/remove', 'auto', 'use-windows', 'link', 'unlink'].includes(op)) jira.requireLinked(); // tutto il resto presuppone una connessione attiva
        const ops = {
          'config': () => jira.saveConfig(body),
          'config/remove': () => jira.removeConfig(),
          'link': () => jira.link(),
          'unlink': () => jira.unlink(),
          'auto': () => jira.autoConnect(),
          'use-windows': () => jira.useWindowsCredential(body),
          'dashboard': () => jira.analyzeDashboard(body.url),
          'source': () => jira.analyzeSource(body.url),
          'meta': () => jira.projectMeta(body.projects),
          'jql': () => ({ jql: jira.buildJql(body) }),
          'search': () => jira.search({ jql: body.queryId ? jira.getQuery(body.queryId).jql : body.jql, nextPage: body.nextPage, max: body.max }),
          'issue': () => jira.issueDetail(body.key),
          'queries': () => jira.saveQuery(body),
          'queries/delete': () => ({ queries: jira.deleteQuery(body.id) }),
        };
        if (Object.prototype.hasOwnProperty.call(ops, op)) return json(200, await ops[op]());
      }
      if (req.url === '/api/repos/sources') {
        const list = (Array.isArray(body.sources) ? body.sources : []).map((s) => repos.normalizeSource(s));
        const prev = new Set(state.sources.map((s) => repos.sourceKey(s)));
        state.sources = list.filter((s, i) => list.findIndex((x) => repos.sourceKey(x) === repos.sourceKey(s)) === i).slice(0, 10);
        const now = new Set(state.sources.map((s) => repos.sourceKey(s)));
        for (const k of [...state.linked]) if (!now.has(k)) state.linked.delete(k); // un'origine tolta dalle salvate si scollega
        if (body.linkNew === true) for (const k of now) if (!prev.has(k)) state.linked.add(k); // appena aggiunta: collegata
        for (const k of (Array.isArray(body.link) ? body.link : [])) if (now.has(String(k))) state.linked.add(String(k));
        for (const k of (Array.isArray(body.unlink) ? body.unlink : [])) state.linked.delete(String(k));
        saveState();
        return json(200, await ownerSources());
      }
      if (req.url === '/api/repos/list') {
        const source = await allowedSource(body);
        const list = await repos.listRepos(source, { refresh: !!body.refresh });
        return json(200, { source: repos.describeSource(source), repos: repos.markLocal(list, body.parent) });
      }
      if (req.url === '/api/repos/clone') {
        if (session.isRunning()) throw new Error('Termina la sessione in corso prima di cambiare progetto');
        const source = await allowedSource(body);
        const r = await repos.cloneRepo({ source, repo: body.repo, parent: body.parent });
        session.activate(r.dir);
        return json(200, { ...r, project: projectInfo() });
      }
      if (req.url === '/api/project/pipeline') {
        const root = needRoot();
        const skills = projects.listSkills(root);
        if (!skills.some((s) => s.name === body.skill)) throw new Error('Skill non trovata nel progetto: ' + String(body.skill).slice(0, 60));
        state.prefs[String(root).toLowerCase()] = { ...prefsFor(root), skill: body.skill, args: projects.validArgs(body.args) };
        saveState();
        return json(200, projects.resolvePipeline(root, prefsFor(root)));
      }
      if (req.url === '/api/tools/add') { // aggiunge al progetto un server MCP o una skill/agent del kit (nessuna installazione)
        if (state.demo) throw new Error('Non disponibile in modalità Demo: il progetto è una simulazione.');
        return json(200, await tools.addToProject(needRoot(), body.type, body.id, { version: body.version, option: body.option }));
      }
      if (req.url === '/api/project/jdk') { // JDK per questo progetto; vuoto = quello del computer
        const root = needRoot();
        const home = String(body.home || '').trim();
        const valid = home ? jdks.validHome(home) : '';
        if (home && !valid) throw new Error('Non è un JDK valido: manca bin/java.exe (indica la cartella del JDK, non quella di bin).');
        const cur = { ...prefsFor(root) };
        if (valid) cur.jdk = valid; else delete cur.jdk;
        state.prefs[String(root).toLowerCase()] = cur;
        saveState();
        return json(200, { selected: cur.jdk || '' });
      }
      if (req.url === '/api/pipeline/preview') return json(200, { command: projects.buildCommand(needRoot(), prefsFor(state.root), String(body.ticket || '').trim() || 'TICKET-1 — titolo di esempio') });
      if (req.url === '/api/project/pick-folder') return json(200, { dir: await projects.pickFolder() });
      if (req.url === '/api/project/plan') {
        if (body.mode !== 'existing') requireCap('project.create', 'di creare nuovi progetti');
        const plan = body.mode === 'existing' ? projects.planExisting({ ...body, prefs: prefsFor(body.dir) }) : projects.planNew(body);
        return json(200, { dir: plan.dir, files: projects.classify(plan) });
      }
      if (req.url === '/api/project/create') {
        if (body.mode !== 'existing') requireCap('project.create', 'di creare nuovi progetti');
        if (body.mode === 'existing') {
          const r = projects.configureExisting({ ...body, prefs: prefsFor(body.dir) });
          if (body.activate !== false) session.activate(r.dir);
          return json(200, r);
        }
        const r = await projects.createProject(body);
        state.frameworkRepo = projects.validFrameworkRepo(body.frameworkRepo); saveState();
        if (body.activate !== false) session.activate(r.dir);
        return json(200, r);
      }
      if (req.url === '/api/project/activate') return session.activate(body.dir), json(200, projectInfo());
      if (req.url === '/api/project/verify') return json(200, await projects.verify(body.dir));
      if (req.url === '/api/m2/token') return json(200, projects.saveM2Token(body.username, body.token));
      if (req.url === '/api/allow') return session.allow(body.rules), json(200, { ok: true });
      if (req.url === '/api/stop') return session.stop(), json(200, { ok: true });
      if (req.url === '/api/shutdown') return json(200, { ok: true }), setTimeout(shutdown, 200), undefined;
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
