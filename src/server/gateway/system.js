// Rotte di sistema: licenza, versione, diagnostica, JDK installati, apertura in IntelliJ, chiusura.
const path = require('path');
const config = require('../areas/project').config;
const projects = require('../areas/project').projects;
const jdks = require('../areas/project').jdks;
const tools = require('../areas/tools').tools;
const appinfo = require('../areas/platform').appinfo;
const report = require('../areas/platform').report;
const jira = require('../areas/jira').jira;
const demo = require('../areas/demo').demo;
const license = require('../areas/license').license;
const session = require('../areas/session').session;
const { state, prefsFor } = require('../state');
const { NOT_HANDLED } = require('../http/route');

module.exports = {
  async get(ctx) {
    const { req, res, json } = ctx;
    if (req.method === 'GET' && req.url === '/api/license') return json(200, { ...license.current(), inDemo: !!state.demo });
    if (req.method === 'GET' && req.url === '/api/demo') return json(200, { on: !!state.demo });
    if (req.method === 'GET' && req.url === '/api/services') return json(200, Object.fromEntries(Object.entries(ctx.remote.status()).map(([k, v]) => [k, { state: v.state, pid: v.pid, crashes: v.crashes }])));
    if (req.method === 'GET' && req.url === '/api/diagnostics') return json(200, await config.diagnostics(state.root || projects.KIT, { noProject: !state.root, jdk: state.root ? prefsFor(state.root).jdk : '' }));
    if (req.method === 'GET' && req.url === '/api/diagnostics/export') { // report Markdown per il supporto: nessun segreto (vedi report.js)
      const jdk = state.root ? prefsFor(state.root).jdk : '';
      const safe = async (fn) => { try { return await fn(); } catch { return null; } };
      const diag = (await safe(() => config.diagnostics(state.root || projects.KIT, { noProject: !state.root, jdk }))) || [];
      const toolsInfo = await safe(() => ctx.remote.callOr('tools', { url: '/api/tools' }, () => tools.collect(state.root, jdk), ctx.context));
      let project = { attached: false };
      if (state.root) {
        const insp = await safe(() => projects.inspect(state.root, prefsFor(state.root)));
        const pipe = insp && insp.pipeline;
        project = { attached: true, name: path.basename(state.root), dir: state.root, skill: pipe && pipe.chosen, args: pipe && pipe.args, steps: pipe ? (pipe.steps ? pipe.steps.length : (pipe.stepsMeaningful ? session.STEPS.length : 0)) : null, jdk, items: (insp && insp.items) || [] };
      }
      const lic = await safe(() => license.current());
      const jst = await safe(() => ctx.remote.callOr('jira', { url: '/api/jira/state' }, () => jira.publicState()));
      const sess = await safe(() => ctx.remote.controlOr('session', 'status', {}, () => ({ status: session.getStatus() })));
      const md = report.build({ now: new Date(), app: appinfo.info(), demo: !!state.demo, diag, project, tools: toolsInfo, license: lic, jira: jst && { configured: !!jst.configured, source: jst.source }, session: { status: (sess && sess.status) || '' } });
      const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
      res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': 'attachment; filename="nacp-diagnostica-' + stamp + '.md"', 'Cache-Control': 'no-store' }).end(md);
      return;
    }
    if (req.method === 'GET' && req.url === '/api/version') return json(200, appinfo.info());
    if (req.method === 'GET' && req.url === '/api/jdks') { const l = jdks.list(); const sel = state.root ? prefsFor(state.root).jdk || '' : ''; return json(200, { ...l, selected: sel, selectedValid: !sel || !!jdks.validHome(sel) }); }
    return NOT_HANDLED;
  },
  async post(ctx) {
    const { req, res, json, body } = ctx;
    if (req.url === '/api/shutdown') return json(200, { ok: true }), setTimeout(ctx.shutdown, 200), undefined;
    return NOT_HANDLED;
  },
};
