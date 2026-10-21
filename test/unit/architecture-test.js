// Regole di architettura di src/server. Le aree sono moduli con confini netti (primo passo per poterle staccare come servizi):
//  1. tra aree si importa solo l'interfaccia pubblica (areas/<area>/index.js), mai i file interni;
//  2. un'area può dipendere solo dalle aree elencate in ALLOWED (ogni voce nuova va decisa, non capita);
//  3. nessun ciclo tra aree;
//  4. le aree non importano il gateway (main, gateway/), e il nucleo (infra, state) non importa nessuna area.
// Il gateway (main.js, gateway/, http/) può usare tutte le aree, ma sempre dall'interfaccia pubblica (e dalle rotte: areas/<area>/routes.js).
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', 'src', 'server');
// area -> aree da cui dipende. Ogni riga è un debito consapevole: va ridotta, non allargata.
const ALLOWED = {
  license: [], jira: [], pipelines: [], project: [], platform: [],
  scm: ['project'],        // git e repos leggono profilo e progetto
  tools: ['project'],      // strumenti e JDK
  mcp: ['pipelines', 'project'], // le schede chiedono la bozza a Claude (pipelines.callClaude); 'Chiedi a Claude' usa il JDK del progetto
  demo: ['project', 'jira'], // i dati simulati sostituiscono progetto e Jira
  session: ['project', 'mcp', 'demo'], // comando e profilo del progetto, credenziali MCP, simulatore
};
const files = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'assets') walk(f); } else if (e.name.endsWith('.js')) files.push(f); } })(ROOT);
const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/').replace(/\.js$/, '');
const areaOf = (r) => { const m = /^areas\/([^/]+)\//.exec(r); return m ? m[1] : null; };
const layerOf = (r) => areaOf(r) ? 'area' : r.startsWith('infra/') || r === 'state' ? 'core' : 'gateway';

let ko = 0, edges = 0;
const used = {};
const fail = (m) => { ko++; console.log('KO ' + m); };
for (const f of files) {
  const me = rel(f), meArea = areaOf(me), meLayer = layerOf(me);
  const text = fs.readFileSync(f, 'utf8');
  for (const m of text.matchAll(/require\('(\.{1,2}\/[^']+)'\)/g)) {
    let t = path.resolve(path.dirname(f), m[1]);
    if (fs.existsSync(t) && fs.statSync(t).isDirectory()) t = path.join(t, 'index');
    const target = rel(t.endsWith('.js') ? t : t + '.js');
    if (!fs.existsSync(path.join(ROOT, target + '.js'))) continue; // risorse fuori dal codice
    edges++;
    const tArea = areaOf(target), tLayer = layerOf(target);
    if (meLayer === 'core' && tLayer !== 'core') fail(me + ' (nucleo) importa ' + target + ': il nucleo non dipende da aree né dal gateway');
    if (meLayer === 'area' && tLayer === 'gateway' && !target.startsWith('http/')) fail(me + ' importa ' + target + ': le aree non dipendono dal gateway');
    if (tArea && tArea !== meArea) {
      const pub = target === 'areas/' + tArea + '/index';
      const routes = meLayer === 'gateway' && new RegExp('^areas/' + tArea + '/([\\w-]+-)?routes$').test(target); // le rotte di un'area (o di un suo pezzo, es. git-routes) sono un secondo punto d'ingresso per il gateway e i servizi
      const sim = false;
      if (!pub && !routes && !sim) fail(me + ' importa ' + target + ': tra aree si importa solo areas/' + tArea + '/index.js');
      if (meLayer === 'core') continue;
      if (meArea) {
        (used[meArea] = used[meArea] || new Set()).add(tArea);
        if (!(ALLOWED[meArea] || []).includes(tArea)) fail(me + ': l\'area "' + meArea + '" non può dipendere da "' + tArea + '" (consentite: ' + ((ALLOWED[meArea] || []).join(', ') || 'nessuna') + ')');
      }
    }
  }
}
// cicli tra aree (sulle dipendenze dichiarate)
const state = {};
const visit = (a, trail) => {
  if (state[a] === 2) return;
  if (state[a] === 1) { fail('ciclo tra aree: ' + [...trail, a].join(' -> ')); return; }
  state[a] = 1;
  for (const b of ALLOWED[a] || []) visit(b, [...trail, a]);
  state[a] = 2;
};
Object.keys(ALLOWED).forEach((a) => visit(a, []));
// voci dichiarate ma non più usate: vanno tolte (il debito si riduce)
for (const [a, list] of Object.entries(ALLOWED)) for (const b of list) if (!(used[a] && used[a].has(b))) fail('ALLOWED dichiara ' + a + ' -> ' + b + ' ma non è più usata: toglila');
const areas = new Set(files.map((f) => areaOf(rel(f))).filter(Boolean));
for (const a of areas) if (!(a in ALLOWED)) fail('area "' + a + '" assente da ALLOWED');
for (const a of areas) if (!fs.existsSync(path.join(ROOT, 'areas', a, 'index.js'))) fail('area "' + a + '" senza index.js (interfaccia pubblica)');
console.log('architettura: ' + areas.size + ' aree, ' + edges + ' import controllati, ' + (ko ? ko + ' violazioni' : 'nessuna violazione'));
process.exit(ko ? 1 : 0);
