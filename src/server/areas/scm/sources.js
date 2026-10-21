// Origini Git (GitHub/GitLab) dell'utente: quelle salvate (in sources.json) e quelle collegate in questa sessione (solo in memoria).
// Le possiede l'area scm, non lo stato dell'app: così può girare come servizio. Alla prima lettura, se sources.json non esiste,
// si migrano le origini che le versioni precedenti tenevano dentro active-project.json.
const fs = require('fs');
const path = require('path');
const paths = require('../../infra/paths');
const repos = require('./repos');

const file = () => path.join(paths.dataDir(), 'sources.json');
const legacyFile = () => process.env.UI_STATE_FILE || path.join(paths.dataDir(), 'active-project.json');
const linked = new Set(); // chiavi delle origini collegate: a ogni avvio si riparte vuoti
let list = null;

// Normalizza: le vecchie voci testuali (solo GitHub) vengono migrate, quelle non valide scartate.
const normalize = (arr) => (Array.isArray(arr) ? arr : []).map((o) => {
  try { return repos.normalizeSource(typeof o === 'string' ? { provider: 'github', owner: o } : o); } catch { return null; }
}).filter(Boolean);

function read() {
  try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { /* nuovo file: si prova il vecchio stato */ }
  try { return JSON.parse(fs.readFileSync(legacyFile(), 'utf8')).sources; } catch { return []; }
}
function load() {
  if (!list) list = normalize(read());
  return list;
}
function save(next) {
  list = next;
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file() + '.tmp', JSON.stringify(list));
  fs.renameSync(file() + '.tmp', file());
}

module.exports = { load, save, linked };
