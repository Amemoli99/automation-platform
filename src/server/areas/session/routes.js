// Rotte della sessione di lavoro: flusso eventi (SSE), passi, avvio, messaggi, domande a margine, permessi, stop.
const mcpenv = require('../mcp').env;
const session = require('./session');
const { state } = require('../../state');
const { NOT_HANDLED } = require('../../http/route');

module.exports = {
  async get(ctx) {
    const { req, res, json } = ctx;
    if (req.method === 'GET' && req.url === '/api/events') return session.attachClient(req, res);
    if (req.method === 'GET' && req.url === '/api/steps') return json(200, session.STEPS);
    return NOT_HANDLED;
  },
  async post(ctx) {
    const { req, res, json, body } = ctx;
    if (req.url === '/api/start') { await mcpenv.warm(state.root).catch(() => { /* credenziali non leggibili: le variabili risultano non impostate */ }); return session.start(String(body.ticket || '').trim(), body.permissionMode || 'acceptEdits', body.attachments), json(200, { ok: true }); }
    if (req.url === '/api/btw') return json(200, await session.askBtw(body.question));
    if (req.url === '/api/send') return session.send(String(body.text || ''), body.attachments), json(200, { ok: true });
    if (req.url === '/api/allow') return session.allow(body.rules), json(200, { ok: true });
    if (req.url === '/api/stop') return session.stop(), json(200, { ok: true });
    return NOT_HANDLED;
  },
};
