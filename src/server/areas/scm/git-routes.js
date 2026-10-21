// Rotte git del progetto: stato e operazioni (mai mentre la pipeline scrive file).
const git = require('./git');
const { NOT_HANDLED, needRoot, requireCap } = require('../../http/route');

const isProtectedBranch = (s) => !!s.branch && (['main', 'master'].includes(s.branch) || s.branch === s.baseBranch);

module.exports = {
  async get(ctx) {
    const { req, res, json } = ctx;
    if (req.method === 'GET' && req.url === '/api/git/status') return json(200, await git.status(needRoot(ctx)));
    return NOT_HANDLED;
  },
  async post(ctx) {
    const { req, res, json, body } = ctx;
    if (req.url.startsWith('/api/git/')) {
      // Le operazioni git modificano l'albero di lavoro: mai mentre la pipeline sta scrivendo file.
      if (ctx.context.running) throw new Error('Termina la sessione in corso prima di operare su git.');
      const root = needRoot(ctx);
      const op = req.url.slice('/api/git/'.length);
      if (op === 'push' || op === 'merge') { const s0 = await git.status(root); if (isProtectedBranch(s0)) requireCap(ctx, 'git.protected', op === 'push' ? 'di pubblicare sul branch principale (' + s0.branch + ')' : 'di unire dentro il branch principale (' + s0.branch + ')'); }
      const ops = {
        update: () => git.update(root),
        switch: () => git.switchTo(root, body.name, !!body.remote),
        create: () => git.create(root, body.name, body.from),
        merge: () => git.merge(root, body.source),
        'merge-abort': () => git.abortMerge(root),
        push: () => git.push(root),
        commit: () => git.commit(root, body.files, body.message),
      };
      if (Object.prototype.hasOwnProperty.call(ops, op)) {
        const r = await ops[op]();
        return json(200, { ...r, status: await git.status(root) });
      }
    }
    return NOT_HANDLED;
  },
};
