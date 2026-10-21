// Rotte delle origini Git (GitHub/GitLab): origini salvate e collegate, elenco repository, clone.
// Non legge lo stato dell'app: le origini sono dell'area (sources.js). Il clone qui si ferma alla copia locale: agganciare il progetto
// clonato è compito del gateway (gateway/repos.js), perché cambia lo stato dell'app.
const repos = require('./repos');
const sources = require('./sources');
const { NOT_HANDLED } = require('../../http/route');

async function ownerSources() {
  const saved = sources.load().map(repos.describeSource);
  return { sources: saved.filter((s) => sources.linked.has(s.key)), savedList: saved, saved: saved.length > 0, discovered: [] };
}
// Origine richiesta dal browser: deve essere una di quelle configurate o dedotte (mai un host arbitrario).
async function allowedSource(body) {
  const src = repos.normalizeSource(body.source || { provider: 'github', owner: body.owner });
  const { sources: linkedNow } = await ownerSources();
  if (!linkedNow.some((s) => s.key === repos.sourceKey(src))) throw new Error('Origine non configurata: aggiungila prima alla lista delle origini.');
  return src;
}
// Clona (o riconosce la copia locale già presente) senza toccare il progetto agganciato.
async function cloneOnly(body) {
  const source = await allowedSource(body);
  return repos.cloneRepo({ source, repo: body.repo, parent: body.parent });
}

module.exports = {
  cloneOnly,
  async get(ctx) {
    const { req, res, json } = ctx;
    if (req.method === 'GET' && req.url === '/api/repos/sources') return json(200, await ownerSources());
    return NOT_HANDLED;
  },
  async post(ctx) {
    const { req, res, json, body } = ctx;
    if (req.url === '/api/repos/sources') {
      const list = (Array.isArray(body.sources) ? body.sources : []).map((s) => repos.normalizeSource(s));
      const prev = new Set(sources.load().map((s) => repos.sourceKey(s)));
      sources.save(list.filter((s, i) => list.findIndex((x) => repos.sourceKey(x) === repos.sourceKey(s)) === i).slice(0, 10));
      const now = new Set(sources.load().map((s) => repos.sourceKey(s)));
      for (const k of [...sources.linked]) if (!now.has(k)) sources.linked.delete(k); // un'origine tolta dalle salvate si scollega
      if (body.linkNew === true) for (const k of now) if (!prev.has(k)) sources.linked.add(k); // appena aggiunta: collegata
      for (const k of (Array.isArray(body.link) ? body.link : [])) if (now.has(String(k))) sources.linked.add(String(k));
      for (const k of (Array.isArray(body.unlink) ? body.unlink : [])) sources.linked.delete(String(k));
      return json(200, await ownerSources());
    }
    if (req.url === '/api/repos/list') {
      const source = await allowedSource(body);
      const list = await repos.listRepos(source, { refresh: !!body.refresh });
      return json(200, { source: repos.describeSource(source), repos: repos.markLocal(list, body.parent) });
    }
    return NOT_HANDLED;
  },
};
