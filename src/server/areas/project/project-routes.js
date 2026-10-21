// Rotte del progetto: informazioni, controlli, pipeline scelta, creazione e aggancio, JDK, credenziali Maven.
const path = require('path');
const fs = require('fs');
const projects = require('./projects');
const { activate } = require('./activate');
const jdks = require('./jdks');
const { state, isDir, prefsFor, saveState, needRoot } = require('../../state');
const { NOT_HANDLED, requireCap } = require('../../http/route');

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
  running: state.running,
  recent: state.recent.filter((d) => isDir(d) && d !== state.root),
  m2: projects.m2Status(),
  frameworkRepo: state.frameworkRepo,
});

module.exports = {
  async get(ctx) {
    const { req, res, json } = ctx;
    if (req.method === 'GET' && req.url === '/api/project') return json(200, projectInfo());
    if (req.method === 'GET' && req.url === '/api/project/inspect') return json(200, projects.inspect(needRoot(), prefsFor(state.root)));
    if (req.method === 'GET' && req.url === '/api/project/pipeline') return json(200, projects.resolvePipeline(needRoot(), prefsFor(state.root)));
    return NOT_HANDLED;
  },
  async post(ctx) {
    const { req, res, json, body } = ctx;
    if (req.url === '/api/project/prepare') {
      if (state.running) throw new Error('Termina la sessione in corso prima di preparare il progetto');
      const r = projects.configureExisting({ dir: needRoot(), prefs: prefsFor(state.root), addKit: !!body.addKit });
      return json(200, { ...r, inspect: projects.inspect(state.root, prefsFor(state.root)) });
    }
    if (req.url === '/api/tests/existing') return json(200, { existing: existingTests(body.keys) });
    if (req.url === '/api/project/pipeline') {
      const root = needRoot();
      const skills = projects.listSkills(root);
      if (!skills.some((s) => s.name === body.skill)) throw new Error('Skill non trovata nel progetto: ' + String(body.skill).slice(0, 60));
      state.prefs[String(root).toLowerCase()] = { ...prefsFor(root), skill: body.skill, args: projects.validArgs(body.args) };
      saveState();
      return json(200, projects.resolvePipeline(root, prefsFor(root)));
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
      if (body.mode !== 'existing') requireCap(ctx, 'project.create', 'di creare nuovi progetti');
      const plan = body.mode === 'existing' ? projects.planExisting({ ...body, prefs: prefsFor(body.dir) }) : projects.planNew(body);
      return json(200, { dir: plan.dir, files: projects.classify(plan) });
    }
    if (req.url === '/api/project/create') {
      if (body.mode !== 'existing') requireCap(ctx, 'project.create', 'di creare nuovi progetti');
      if (body.mode === 'existing') {
        const r = projects.configureExisting({ ...body, prefs: prefsFor(body.dir) });
        if (body.activate !== false) activate(r.dir);
        return json(200, r);
      }
      const r = await projects.createProject(body);
      state.frameworkRepo = projects.validFrameworkRepo(body.frameworkRepo); saveState();
      if (body.activate !== false) activate(r.dir);
      return json(200, r);
    }
    if (req.url === '/api/project/activate') return activate(body.dir), json(200, projectInfo());
    if (req.url === '/api/project/verify') return json(200, await projects.verify(body.dir));
    if (req.url === '/api/m2/token') return json(200, projects.saveM2Token(body.username, body.token));
    return NOT_HANDLED;
  },
  projectInfo,
};
