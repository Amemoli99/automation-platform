// Versione e build dell'applicazione, per mostrarle nella UI e per il supporto.
// - version/edition vengono da ui/version.json (l'unico file da cambiare quando si rilascia una nuova versione);
// - build è un'impronta (7 caratteri) di TUTTI i file in ui/: cambia da sola a ogni modifica, quindi due PC con la stessa versione ma file
//   diversi si riconoscono subito; builtAt è la data dell'ultima modifica a quei file. Calcolati una volta all'avvio.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const paths = require('../infra/paths');
const UI = paths.APP_DIR;
const EXT = /\.(js|json|html|css|cs|ps1|md|webp|png|svg)$/i;
let cached = null;

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, out);
    else if (EXT.test(e.name)) out.push(f);
  }
}

function info() {
  if (cached) return cached;
  let ver = {};
  try { ver = JSON.parse(fs.readFileSync(paths.asset('version.json'), 'utf8')); } catch { /* senza version.json: 0.0.0 */ }
  const files = [];
  try { walk(UI, files); } catch { /* cartella non leggibile: build vuota */ }
  files.sort();
  const h = crypto.createHash('sha1');
  let latest = 0;
  for (const f of files) {
    try {
      const st = fs.statSync(f);
      if (st.mtimeMs > latest) latest = st.mtimeMs;
      h.update(path.relative(UI, f).split(path.sep).join('/'));
      h.update(fs.readFileSync(f));
    } catch { /* file sparito durante la lettura: si ignora */ }
  }
  cached = {
    version: String(ver.version || '0.0.0').slice(0, 40),
    edition: String(ver.edition || '').slice(0, 40),
    build: files.length ? h.digest('hex').slice(0, 7) : '',
    builtAt: latest ? new Date(latest).toISOString() : '',
    node: process.version,
    platform: process.platform + ' ' + os.release(),
    files: files.length,
  };
  return cached;
}

module.exports = { info };
