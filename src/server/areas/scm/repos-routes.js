// Rotte delle origini Git (GitHub/GitLab): origini salvate e collegate, elenco repository, clone.
const repos = require('./repos');
const { projectInfo, activate } = require('../project');
const { state, saveState } = require('../../state');
const { NOT_HANDLED } = require('../../http/route');

// Origini Git: l'app parte SENZA nessuna origine collegata e non ne deduce più dai progetti presenti sul computer.
// Quelle aggiunte dall'utente restano salvate ("savedList") e si collegano con un clic; "sources" sono solo quelle collegate in questa sessione.
// Le origini salvate si normalizzano alla prima lettura: le vecchie voci testuali (solo GitHub) vengono migrate, quelle non valide scartate.
let sourcesChecked = false;
function loadSources() {
  if (!sourcesChecked) {
    state.sources = state.sources.map((o) => {
      try { return repos.normalizeSource(typeof o === 'string' ? { provider: 'github', owner: o } : o); } catch { return null; }
    }).filter(Boolean);
    sourcesChecked = true;
  }
  return state.sources;
}

async function ownerSources() {
  const saved = loadSources().map(repos.describeSource);
  return { sources: saved.filter((s) => state.linked.has(s.key)), savedList: saved, saved: state.sources.length > 0, discovered: [] };
}
// Origine richiesta dal browser: deve essere una di quelle configurate o dedotte (mai un host arbitrario).
async function allowedSource(body) {
  const src = repos.normalizeSource(body.source || { provider: 'github', owner: body.owner });
  const { sources } = await ownerSources();
  if (!sources.some((s) => s.key === repos.sourceKey(src))) throw new Error('Origine non configurata: aggiungila prima alla lista delle origini.');
  return src;
}

module.exports = {
  async get(ctx) {
    const { req, res, json } = ctx;
    if (req.method === 'GET' && req.url === '/api/repos/sources') return json(200, await ownerSources());
    return NOT_HANDLED;
  },
  async post(ctx) {
    const { req, res, json, body } = ctx;
    if (req.url === '/api/repos/sources') {
      const list = (Array.isArray(body.sources) ? body.sources : []).map((s) => repos.normalizeSource(s));
      const prev = new Set(loadSources().map((s) => repos.sourceKey(s)));
      state.sources = list.filter((s, i) => list.findIndex((x) => repos.sourceKey(x) === repos.sourceKey(s)) === i).slice(0, 10);
      const now = new Set(state.sources.map((s) => repos.sourceKey(s)));
      for (const k of [...state.linked]) if (!now.has(k)) state.linked.delete(k); // un'origine tolta dalle salvate si scollega
      if (body.linkNew === true) for (const k of now) if (!prev.has(k)) state.linked.add(k); // appena aggiunta: collegata
      for (const k of (Array.isArray(body.link) ? body.link : [])) if (now.has(String(k))) state.linked.add(String(k));
      for (const k of (Array.isArray(body.unlink) ? body.unlink : [])) state.linked.delete(String(k));
      saveState();
      return json(200, await ownerSources());
    }
    if (req.url === '/api/repos/list') {
      const source = await allowedSource(body);
      const list = await repos.listRepos(source, { refresh: !!body.refresh });
      return json(200, { source: repos.describeSource(source), repos: repos.markLocal(list, body.parent) });
    }
    if (req.url === '/api/repos/clone') {
      if (state.running) throw new Error('Termina la sessione in corso prima di cambiare progetto');
      const source = await allowedSource(body);
      const r = await repos.cloneRepo({ source, repo: body.repo, parent: body.parent });
      activate(r.dir);
      return json(200, { ...r, project: projectInfo() });
    }
    return NOT_HANDLED;
  },
};
