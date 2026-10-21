#!/usr/bin/env node
'use strict';
// Strumento di chi EMETTE le licenze. Non va distribuito agli utenti e la chiave privata non va mai nel kit né in git.
//
//   node tools/license.js machine                      codice di questo PC
//   node tools/license.js keygen [--out DIR] [--embed] crea la coppia di chiavi (una volta sola)
//   node tools/license.js issue --private FILE --org "Acme" --user "Mario Rossi" --email m.rossi@acme.it
//                               --role tester --machine XXXX-XXXX-XXXX-XXXX --days 90 [--out licenza.json]
//   node tools/license.js verify FILE --public FILE     controlla un file di licenza
const fs = require('fs');
const os = require('os');
const path = require('path');
const lic = require('../src/server/areas/license').license;

const args = process.argv.slice(2);
const cmd = args.shift();
const opt = {};
const rest = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) { const k = args[i].slice(2); const next = args[i + 1]; if (next === undefined || next.startsWith('--')) opt[k] = true; else { opt[k] = next; i++; } } else rest.push(args[i]);
}
const die = (m) => { console.error('Errore: ' + m); process.exit(1); };
const need = (k) => { if (!opt[k] || opt[k] === true) die(`manca --${k}`); return opt[k]; };

if (cmd === 'machine') {
  console.log(lic.machineCode());
} else if (cmd === 'keygen') {
  const dir = path.resolve(typeof opt.out === 'string' ? opt.out : path.join(os.homedir(), '.developerTest-keys'));
  const priv = path.join(dir, 'license-private.pem'), pub = path.join(dir, 'license-public.pem');
  if (fs.existsSync(priv)) die(`esiste già una chiave privata in ${priv}: non la sovrascrivo (perderesti la capacità di rinnovare le licenze emesse).`);
  fs.mkdirSync(dir, { recursive: true });
  const k = lic.generateKeypair();
  fs.writeFileSync(priv, k.privatePem, { mode: 0o600 });
  fs.writeFileSync(pub, k.publicPem);
  console.log('Chiave privata :', priv, '  <-- CUSTODISCILA: backup sicuro, mai in git né nel kit');
  console.log('Chiave pubblica:', pub);
  if (opt.embed) {
    const f = path.join(__dirname, '..', 'src', 'server', 'areas', 'license', 'license.js');
    const src = fs.readFileSync(f, 'utf8');
    const re = /^const PUBLIC_KEY_PEM = .*;$/m;
    if (!re.test(src)) die('non trovo PUBLIC_KEY_PEM in src/server/areas/license/license.js');
    if (!/^const PUBLIC_KEY_PEM = null;$/m.test(src) && !opt.force) die('src/server/areas/license/license.js contiene già una chiave pubblica: usa --force per sostituirla (le licenze già emesse smetterebbero di valere).');
    fs.writeFileSync(f, src.replace(re, () => 'const PUBLIC_KEY_PEM = ' + JSON.stringify(k.publicPem) + ';'));
    console.log('Chiave pubblica incorporata in src/server/areas/license/license.js: da ora l\'app richiede una licenza.');
  } else console.log('Per attivare le licenze nell\'app: rilancia con --embed (oppure copia la chiave pubblica in src/server/areas/license/license.js).');
} else if (cmd === 'issue') {
  const privatePem = fs.readFileSync(path.resolve(need('private')), 'utf8');
  const text = lic.issue({ privatePem, org: need('org'), user: need('user'), email: need('email'), role: need('role'), machine: need('machine'), days: opt.days || 90 });
  const out = path.resolve(typeof opt.out === 'string' ? opt.out : `licenza-${String(opt.user).replace(/[^\w.-]+/g, '_')}.json`);
  fs.writeFileSync(out, text);
  const p = JSON.parse(Buffer.from(JSON.parse(text).payload, 'base64url').toString('utf8'));
  console.log(`Licenza creata: ${out}\n  ${p.user} <${p.email}> · ${p.org} · profilo ${p.role} · PC ${p.machine}\n  valida fino al ${new Date(p.expires).toLocaleDateString('it-IT')}`);
} else if (cmd === 'verify') {
  const file = rest[0]; if (!file) die('indica il file da controllare');
  const v = lic.verifyText(fs.readFileSync(path.resolve(file), 'utf8'), { pubPem: fs.readFileSync(path.resolve(need('public')), 'utf8'), machine: typeof opt.machine === 'string' ? opt.machine : undefined });
  if (!v.ok) die(v.message);
  console.log('Licenza valida:', JSON.stringify(v.data, null, 2));
} else {
  console.log('Comandi: machine | keygen [--out DIR] [--embed] | issue --private F --org O --user U --email E --role R --machine M [--days N] [--out F] | verify FILE --public F');
  process.exit(cmd ? 1 : 0);
}
