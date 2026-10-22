// Rotte del progetto che cambiano lo stato dell'app (progetto agganciato, recenti, preferenze per progetto, repository del framework):
// le possiede il gateway. Il lavoro sui file del progetto lo fa l'area project, che può girare come servizio.
const path = require('path');
const { projects, jdks, activate, detach } = require('../areas/project');
const { state, isDir, prefsFor, saveState, needRoot } = require('../state');
const { NOT_HANDLED, requireCap } = require('../http/route');

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
  projectInfo,
  async get(ctx) {
    const { req, res, json } = ctx;
    if (req.method === 'GET' && req.url === '/api/project') return json(200, projectInfo());
    return NOT_HANDLED;
  },
  async post(ctx) {
    const { req, res, json, body } = ctx;
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
    if (req.url === '/api/project/create') {
      if (body.mode !== 'existing') requireCap(ctx, 'project.create', 'di creare nuovi progetti');
      const remote = ctx.remote;
      if (body.mode === 'existing') {
        const arg = { ...body, prefs: prefsFor(body.dir) };
        const r = remote.has('project') ? await remote.control('project', 'configure-existing', arg) : projects.configureExisting(arg);
        if (body.activate !== false) activate(r.dir);
        return json(200, r);
      }
      const r = remote.has('project') ? await remote.control('project', 'create-project', body) : await projects.createProject(body);
      state.frameworkRepo = projects.validFrameworkRepo(body.frameworkRepo); saveState();
      if (body.activate !== false) activate(r.dir);
      return json(200, r);
    }
    if (req.url === '/api/project/activate') return activate(body.dir), json(200, projectInfo());
    if (req.url === '/api/project/detach') return detach(), json(200, projectInfo());
    return NOT_HANDLED;
  },
};
