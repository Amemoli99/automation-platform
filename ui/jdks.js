// Rilevamento e scelta del JDK da usare per un progetto (Maven compila ed esegue con quello).
// Il JDK scelto viene passato come JAVA_HOME (e in testa al PATH) ai processi lanciati dal Cockpit: nessuna modifica al computer.
const fs = require('fs');
const os = require('os');
const path = require('path');

// Cartelle che contengono un JDK per sottocartella (installazioni abituali su Windows).
function roots() {
  const out = [];
  for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean)) {
    for (const d of ['Java', 'Eclipse Adoptium', 'Microsoft', 'Amazon Corretto', 'Zulu', 'Semeru', 'BellSoft']) out.push(path.join(base, d));
  }
  out.push(path.join(os.homedir(), '.jdks')); // JDK scaricati da IntelliJ
  return out;
}

const javaExe = (home) => path.join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');

// Versione dal file `release` del JDK (JAVA_VERSION="17.0.19"), senza lanciare java.
function readVersion(home) {
  try {
    const m = /^JAVA_VERSION="?([^"\r\n]+)"?/m.exec(fs.readFileSync(path.join(home, 'release'), 'utf8'));
    if (m) return m[1];
  } catch { /* nessun file release */ }
  return '';
}
const majorOf = (v) => { const m = /^(?:1\.)?(\d+)/.exec(v || ''); return m ? Number(m[1]) : 0; };

// Un percorso è ammesso solo se è un JDK reale e non contiene caratteri che spezzerebbero PATH o la riga di comando.
function validHome(home) {
  const raw = String(home || '').trim();
  if (!raw || raw.length > 260 || /[\u0000-\u001f";&|<>^%]/.test(raw) || !path.isAbsolute(raw)) return null;
  const h = path.resolve(raw); // normalizza separatori e barra finale
  try { return fs.statSync(javaExe(h)).isFile() ? h : null; } catch { return null; }
}

function describe(home, tag) {
  const version = readVersion(home);
  const major = majorOf(version);
  return { home, version, major, label: (major ? 'Java ' + major : 'Java') + (version ? ' (' + version + ')' : '') + ' — ' + path.basename(home) + (tag ? ' · ' + tag : '') };
}

// Elenco dei JDK trovati; `system` è quello che il computer usa se non si sceglie nulla (JAVA_HOME).
function list() {
  const seen = new Map();
  const add = (home, tag) => { const h = validHome(home); if (h && !seen.has(h.toLowerCase())) seen.set(h.toLowerCase(), describe(h, tag)); };
  if (process.env.JAVA_HOME) add(process.env.JAVA_HOME, 'JAVA_HOME');
  for (const r of roots()) {
    let names = [];
    try { names = fs.readdirSync(r); } catch { continue; }
    for (const n of names) add(path.join(r, n));
  }
  const jdks = [...seen.values()].sort((a, b) => b.major - a.major || a.home.localeCompare(b.home));
  const sysHome = process.env.JAVA_HOME ? validHome(process.env.JAVA_HOME) : null;
  return { jdks, system: sysHome ? describe(sysHome, 'JAVA_HOME') : null };
}

// Ambiente per i processi del progetto: con un JDK scelto (e ancora valido) JAVA_HOME e PATH lo puntano, altrimenti quello del computer.
function envFor(home) {
  const env = { ...process.env };
  const h = validHome(home);
  if (!h) return env;
  const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path') || 'PATH';
  env.JAVA_HOME = h;
  env[pathKey] = path.join(h, 'bin') + path.delimiter + (env[pathKey] || '');
  return env;
}

module.exports = { list, envFor, validHome, describe };
