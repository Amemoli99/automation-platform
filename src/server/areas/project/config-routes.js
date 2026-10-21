// Rotte di configurazione: accesso a Claude, permessi e profilo del progetto.
const config = require('./config');
const { needRoot } = require('../../state');
const { NOT_HANDLED } = require('../../http/route');

module.exports = {
  async get(ctx) {
    const { req, res, json } = ctx;
    if (req.method === 'GET' && req.url === '/api/claude/auth') return json(200, await config.authStatus());
    if (req.method === 'GET' && req.url === '/api/claude/login') return json(200, config.loginState());
    if (req.method === 'GET' && req.url === '/api/config') return json(200, config.readConfig(needRoot()));
    return NOT_HANDLED;
  },
  async post(ctx) {
    const { req, res, json, body } = ctx;
    if (req.url === '/api/claude/login') return json(200, config.startLogin());
    if (req.url === '/api/claude/login/cancel') return json(200, config.stopLogin());
    if (req.url === '/api/config/permissions') return json(200, { allow: config.savePermissions(needRoot(), body.allow) });
    if (req.url === '/api/config/profile') return json(200, { value: config.saveProfileValue(needRoot(), body.key, body.value) });
    return NOT_HANDLED;
  },
};
