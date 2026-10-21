// Rotte della scheda Tool: strumenti rilevati, catalogo, registro MCP, aggiunta al progetto.
const tools = require('../services/tools');
const registry = require('../services/registry');
const { state, prefsFor, needRoot } = require('../state');
const { NOT_HANDLED } = require('./common');

module.exports = {
  async get(ctx) {
    const { req, res, json } = ctx;
    if (req.method === 'GET' && req.url === '/api/tools') return json(200, await tools.collect(state.root, state.root ? prefsFor(state.root).jdk : ''));
    if (req.method === 'GET' && req.url.startsWith('/api/tools/registry')) { // ricerca o elenco nel registro ufficiale MCP (sola lettura, serve internet)
      const p = new URL(req.url, 'http://localhost').searchParams;
      return json(200, await registry.search(p.get('q')));
    }
    if (req.method === 'GET' && req.url === '/api/tools/catalog') return json(200, await tools.catalog(state.root));
    if (req.method === 'GET' && req.url === '/api/tools/mcp-status') return json(200, { items: await tools.mcpStatus(state.root, state.root ? prefsFor(state.root).jdk : '') });
    return NOT_HANDLED;
  },
  async post(ctx) {
    const { req, res, json, body } = ctx;
    if (req.url === '/api/tools/add') { // aggiunge al progetto un server MCP o una skill/agent del kit (nessuna installazione)
      if (state.demo) throw new Error('Non disponibile in modalità Demo: il progetto è una simulazione.');
      return json(200, await tools.addToProject(needRoot(), body.type, body.id, { version: body.version, option: body.option }));
    }
    return NOT_HANDLED;
  },
};
