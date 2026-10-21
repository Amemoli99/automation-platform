// Rotte della scheda Tool: strumenti rilevati, catalogo, registro MCP, aggiunta al progetto.
const tools = require('./tools');
const registry = require('./registry');
const { NOT_HANDLED, needRoot } = require('../../http/route');

module.exports = {
  async get(ctx) {
    const { req, res, json } = ctx;
    if (req.method === 'GET' && req.url === '/api/tools') return json(200, await tools.collect(ctx.context.root, ctx.context.root ? ctx.context.prefs.jdk : ''));
    if (req.method === 'GET' && req.url.startsWith('/api/tools/registry')) { // ricerca o elenco nel registro ufficiale MCP (sola lettura, serve internet)
      const p = new URL(req.url, 'http://localhost').searchParams;
      return json(200, await registry.search(p.get('q')));
    }
    if (req.method === 'GET' && req.url === '/api/tools/catalog') return json(200, await tools.catalog(ctx.context.root));
    if (req.method === 'GET' && req.url === '/api/tools/mcp-status') return json(200, { items: await tools.mcpStatus(ctx.context.root, ctx.context.root ? ctx.context.prefs.jdk : '') });
    return NOT_HANDLED;
  },
  async post(ctx) {
    const { req, res, json, body } = ctx;
    if (req.url === '/api/tools/add') { // aggiunge al progetto un server MCP o una skill/agent del kit (nessuna installazione)
      if (ctx.context.demo) throw new Error('Non disponibile in modalità Demo: il progetto è una simulazione.');
      return json(200, await tools.addToProject(needRoot(ctx), body.type, body.id, { version: body.version, option: body.option }));
    }
    return NOT_HANDLED;
  },
};
