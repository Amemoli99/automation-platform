// Nomi usati ma non dichiarati: ogni modulo importato da un file di src/server (servizi, stato, sessione...) e usato in un altro file
// deve essere importato lì. Prende anche gli usi con spread (...nome.campo). Evita errori tipo "jdks is not defined" a runtime.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', 'src', 'server');
const files = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'assets') walk(f); } else if (e.name.endsWith('.js')) files.push(f); } })(ROOT);

const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:\\'"`])\/\/.*$/gm, '$1')
  .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, "''")
  .replace(/`(?:[^`\\]|\\.)*`/g, (m) => m.replace(/\$\{([^}]*)\}/g, ' $1 '));
const src = Object.fromEntries(files.map((f) => [f, fs.readFileSync(f, 'utf8')]));

// nomi che i moduli importano o dichiarano a livello alto in qualche file
const known = new Set();
for (const text of Object.values(src)) {
  for (const m of text.matchAll(/^(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(/gm)) known.add(m[1]);
  for (const m of text.matchAll(/^(?:const|let)\s+\{([^}]*)\}\s*=\s*require\(/gm)) m[1].split(',').forEach((s) => known.add(s.split(':').pop().trim()));
}
// nomi troppo generici o spesso usati come variabili locali: si controllano solo se compaiono come chiamata/uso di modulo (nome.campo o nome( )
['path', 'fs', 'os', 'http', 'crypto', 'spawn', 'exec'].forEach((n) => known.add(n));

let ko = 0, checked = 0;
// Si controllano i file che orchestrano (main, sessione, stato, rotte, auth/static): i servizi hanno testi e regex con parole uguali ai nomi dei moduli.
const ORCH = (f) => /\/(main|state)\.js$|\/areas\/\w+\/(session|routes|[\w-]+-routes|activate|mode)\.js$|\/gateway\/|\/http\/(auth|static|route)\.js$/.test(f.split(path.sep).join('/'));
for (const f of files.filter(ORCH)) {
  const text = strip(src[f]);
  const declared = new Set();
  for (const m of text.matchAll(/(?:^|\s)(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/g)) declared.add(m[1]);
  for (const m of text.matchAll(/(?:const|let)\s+\{([^}]*)\}\s*=/g)) m[1].split(',').forEach((s) => declared.add(s.split(':').pop().replace(/=.*$/, '').trim()));
  for (const m of text.matchAll(/(?:const|let)\s+\[([^\]]*)\]\s*=/g)) m[1].split(',').forEach((s) => declared.add(s.trim()));
  for (const m of text.matchAll(/\(([^()]*)\)\s*=>|function\s*[\w$]*\s*\(([^()]*)\)/g)) (m[1] || m[2] || '').split(',').forEach((s) => declared.add(s.replace(/=.*$/, '').replace(/[{}[\]\s.]/g, '')));
  for (const m of text.matchAll(/\b([A-Za-z_$][\w$]*)\s*=>/g)) declared.add(m[1]);
  for (const m of text.matchAll(/catch\s*\(([\w$]+)\)/g)) declared.add(m[1]);
  for (const m of text.matchAll(/for\s*\((?:const|let)\s+(?:\[([^\]]*)\]|([\w$]+))/g)) (m[1] || m[2] || '').split(',').forEach((s) => declared.add(s.trim()));
  for (const n of known) {
    if (declared.has(n)) continue;
    // uso come variabile: non preceduto da '.' (salvo lo spread '...') né da lettere/cifre
    const re = new RegExp('(?<![\\w$])(?<!(?<!\\.\\.)\\.)' + n.replace(/\$/g, '\\$') + '(?![\\w$])(?!\\s*:)', 'g');
    const hits = (text.match(re) || []).length;
    checked++;
    if (hits) { ko++; console.log('KO ' + path.relative(ROOT, f) + ': usa "' + n + '" (' + hits + ' volte) ma non lo importa né lo dichiara'); }
  }
}
console.log('scope: ' + files.filter(ORCH).length + ' file controllati, ' + (ko ? ko + ' nomi non dichiarati' : 'nessun nome non dichiarato'));
process.exit(ko ? 1 : 0);
