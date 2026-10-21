// Rotte dei server MCP del progetto: credenziali, tool, chiamate, schede, domande a Claude.
const path = require('path');
const mcpenv = require('../services/mcpenv');
const jdks = require('../services/jdks');
const mcpclient = require('../services/mcpclient');
const mcppanels = require('../services/mcppanels');
const mcpask = require('../services/mcpask');
const tools = require('../services/tools');
const { state, prefsFor, needRoot } = require('../state');
const { NOT_HANDLED } = require('./common');

module.exports = {
  async get(ctx) {
    const { req, res, json } = ctx;
    if (req.method === 'GET' && req.url === '/api/mcp/servers') {
      const root = needRoot();
      return json(200, { project: path.basename(root), servers: mcpclient.servers(root).map((s) => { const st = mcpenv.status(root, s.name); return { ...s, vars: s.vars.map((n) => ({ name: n, set: !!st[n], inEnv: !!process.env[n] })), hasPanel: !!mcppanels.load(s.name), mode: mcpask.modeOf(s.name) }; }) });
    }
    if (req.method === 'GET' && req.url.startsWith('/api/mcp/panel?')) return json(200, { descriptor: mcppanels.load(new URL(req.url, 'http://x').searchParams.get('server')) });
    if (req.method === 'GET' && req.url.startsWith('/api/mcp/ask-active?')) return json(200, mcpask.active(new URL(req.url, 'http://x').searchParams.get('server')));
    if (req.method === 'GET' && req.url.startsWith('/api/mcp/ask-status?')) return json(200, mcpask.status(new URL(req.url, 'http://x').searchParams.get('id')));
    return NOT_HANDLED;
  },
  async post(ctx) {
    const { req, res, json, body } = ctx;
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
    return NOT_HANDLED;
  },
};
