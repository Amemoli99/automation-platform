// Costruisce la cartella da zippare: backend unito in un solo file offuscato (ui\server.js), niente altri sorgenti .js.
// Uso: node build/build-dist.js [cartella-sorgenti] [cartella-destinazione] [nome]
// Default: la radice del repository, .tmp/dist, NexsoftAutomationCockpit.
'use strict';
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const JavaScriptObfuscator = require('javascript-obfuscator');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.resolve(process.argv[2] || ROOT);
const OUT = path.resolve(process.argv[3] || path.join(ROOT, '.tmp', 'dist'));
const NAME = process.argv[4] || 'NexsoftAutomationCockpit'; // nome della cartella nello zip e dell'eseguibile
const PKG = path.join(OUT, NAME);

// Dal repository al pacchetto: i sorgenti stanno in src/ e launcher/, il pacchetto mantiene il layout ui/ che l'eseguibile si aspetta.
function copy(rel, dest = rel) {
  const from = path.join(SRC, rel), to = path.join(PKG, dest);
  if (!fs.existsSync(from)) { console.log('  (non presente, saltato)', rel); return; }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(PKG, { recursive: true });

// 1) file che restano com'erano (eseguibile, documentazione, kit, interfaccia nel browser, dati letti a runtime)
const ASSETS = path.join('src', 'server', 'assets');
for (const rel of [NAME + '.exe', 'README.md', 'kit']) copy(rel);
copy(path.join('src', 'web'), path.join('ui', 'public'));
for (const f of ['templates', 'catalog.json', 'skill-steps.json', 'version.json', '.gitignore']) copy(path.join(ASSETS, f), path.join('ui', f));
for (const f of ['Launcher.cs', 'build-exe.ps1']) copy(path.join('launcher', f), path.join('ui', f));

// 2) backend: un solo file per il server e uno per il simulatore della modalità Demo (è lanciato come processo a parte)
const OBF = {
  compact: true, target: 'node', sourceMap: false, log: false,
  identifierNamesGenerator: 'hexadecimal', renameGlobals: false, renameProperties: false,
  stringArray: true, stringArrayEncoding: ['base64'], stringArrayThreshold: 0.8, stringArrayRotate: true, stringArrayShuffle: true,
  stringArrayWrappersCount: 2, stringArrayWrappersType: 'function', stringArrayIndexShift: true,
  splitStrings: false, transformObjectKeys: false, controlFlowFlattening: false, deadCodeInjection: false,
  numbersToExpressions: true, simplify: true, selfDefending: false, debugProtection: false, disableConsoleOutput: false, unicodeEscapeSequence: false,
};
const stats = [];
for (const [entry, out] of [[path.join('src', 'server', 'main.js'), path.join('ui', 'server.js')], [path.join('src', 'server', 'areas', 'demo', 'sim.js'), path.join('ui', 'demo', 'sim.js')]]) {
  const bundled = esbuild.buildSync({
    entryPoints: [path.join(SRC, entry)], bundle: true, platform: 'node', format: 'cjs', target: 'node18',
    minify: true, legalComments: 'none', write: false, logLevel: 'warning',
  }).outputFiles[0].text;
  const intermediate = path.join(OUT, '_bundle-' + path.basename(entry));
  fs.writeFileSync(intermediate, bundled); // solo per controllo interno: sta fuori dal pacchetto
  const obf = JavaScriptObfuscator.obfuscate(bundled, OBF).getObfuscatedCode();
  const to = path.join(PKG, out);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, obf);
  stats.push([entry, bundled.length, obf.length]);
}
for (const [e, a, b] of stats) console.log(e.padEnd(18), 'bundle', String(a).padStart(8), 'B  offuscato', String(b).padStart(8), 'B');
console.log('pronto:', PKG);
