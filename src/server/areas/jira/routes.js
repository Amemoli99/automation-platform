// Rotte Jira: connessione, query e ticket.
const jira = require('./jira');
const { state } = require('../../state');
const { NOT_HANDLED } = require('../../http/route');

module.exports = {
  async get(ctx) {
    const { req, res, json } = ctx;
    if (req.method === 'GET' && req.url === '/api/jira/state') return json(200, jira.publicState());
    if (req.method === 'GET' && req.url === '/api/jira/verify') return json(200, await jira.verifyConnection());
    if (req.method === 'GET' && req.url === '/api/jira/discover') return json(200, { candidates: await jira.discoverWindowsCredentials() });
    return NOT_HANDLED;
  },
  async post(ctx) {
    const { req, res, json, body } = ctx;
    if (req.url.startsWith('/api/jira/')) {
      const op = req.url.slice('/api/jira/'.length);
      if (!['config', 'config/remove', 'auto', 'use-windows', 'link', 'unlink'].includes(op)) jira.requireLinked(); // tutto il resto presuppone una connessione attiva
      const ops = {
        'config': () => jira.saveConfig(body),
        'config/remove': () => jira.removeConfig(),
        'link': () => jira.link(),
        'unlink': () => jira.unlink(),
        'auto': () => jira.autoConnect(),
        'use-windows': () => jira.useWindowsCredential(body),
        'dashboard': () => jira.analyzeDashboard(body.url),
        'source': () => jira.analyzeSource(body.url),
        'meta': () => jira.projectMeta(body.projects),
        'jql': () => ({ jql: jira.buildJql(body) }),
        'search': () => jira.search({ jql: body.queryId ? jira.getQuery(body.queryId).jql : body.jql, nextPage: body.nextPage, max: body.max }),
        'issue': () => jira.issueDetail(body.key),
        'queries': () => jira.saveQuery(body),
        'queries/delete': () => ({ queries: jira.deleteQuery(body.id) }),
      };
      if (Object.prototype.hasOwnProperty.call(ops, op)) return json(200, await ops[op]());
    }
    return NOT_HANDLED;
  },
};
