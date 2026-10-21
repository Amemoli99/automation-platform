// Clone di un repository e aggancio del progetto: la parte "clona" è dell'area scm (può girare come servizio),
// l'aggancio cambia lo stato dell'app, quindi lo fa il gateway.
const { activate } = require('../areas/project');
const { projectInfo } = require('./project');
const reposRoutes = require('../areas/scm/repos-routes');
const { NOT_HANDLED } = require('../http/route');

module.exports = {
  async get() { return NOT_HANDLED; },
  async post(ctx) {
    const { req, json, body } = ctx;
    if (req.url !== '/api/repos/clone') return NOT_HANDLED;
    if (ctx.context.running) throw new Error('Termina la sessione in corso prima di cambiare progetto');
    const r = ctx.remote.has('repos') ? await ctx.remote.control('repos', 'clone', body) : await reposRoutes.cloneOnly(body);
    activate(r.dir);
    return json(200, { ...r, project: projectInfo() });
  },
};
