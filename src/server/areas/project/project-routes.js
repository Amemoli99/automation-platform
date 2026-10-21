// Rotte del progetto che lavorano sui suoi file: controlli, anteprima della pipeline, piano e verifica del wizard, preparazione,
// test esistenti, token Maven, selettore di cartelle. Non toccano lo stato dell'app: il progetto e le preferenze arrivano in ctx.context.
// Le rotte che cambiano lo stato (aggancio, scelta di skill e JDK, creazione) sono nel gateway: gateway/project.js.
const path = require('path');
const fs = require('fs');
const projects = require('./projects');
const { NOT_HANDLED, requireCap, needRoot, prefsOf } = require('../../http/route');

// Chiavi dei ticket che hanno già un test nel progetto (classe <PREFISSO>_<n>.java, es. NX-2 -> NX_2.java). Sola lettura.
function existingTests(root, keys) {
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

module.exports = {
  async get(ctx) {
    const { req, res, json } = ctx;
    if (req.method === 'GET' && req.url === '/api/project/inspect') return json(200, projects.inspect(needRoot(ctx), ctx.context.prefs));
    if (req.method === 'GET' && req.url === '/api/project/pipeline') return json(200, projects.resolvePipeline(needRoot(ctx), ctx.context.prefs));
    return NOT_HANDLED;
  },
  async post(ctx) {
    const { req, res, json, body } = ctx;
    if (req.url === '/api/project/prepare') {
      if (ctx.context.running) throw new Error('Termina la sessione in corso prima di preparare il progetto');
      const root = needRoot(ctx);
      const r = projects.configureExisting({ dir: root, prefs: ctx.context.prefs, addKit: !!body.addKit });
      return json(200, { ...r, inspect: projects.inspect(root, ctx.context.prefs) });
    }
    if (req.url === '/api/tests/existing') return json(200, { existing: existingTests(needRoot(ctx), body.keys) });
    if (req.url === '/api/pipeline/preview') return json(200, { command: projects.buildCommand(needRoot(ctx), ctx.context.prefs, String(body.ticket || '').trim() || 'TICKET-1 — titolo di esempio') });
    if (req.url === '/api/project/pick-folder') return json(200, { dir: await projects.pickFolder() });
    if (req.url === '/api/project/plan') {
      if (body.mode !== 'existing') requireCap(ctx, 'project.create', 'di creare nuovi progetti');
      const plan = body.mode === 'existing' ? projects.planExisting({ ...body, prefs: prefsOf(ctx, body.dir) }) : projects.planNew(body);
      return json(200, { dir: plan.dir, files: projects.classify(plan) });
    }
    if (req.url === '/api/project/verify') return json(200, await projects.verify(body.dir));
    if (req.url === '/api/m2/token') return json(200, projects.saveM2Token(body.username, body.token));
    return NOT_HANDLED;
  },
};
