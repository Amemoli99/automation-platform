// Permessi per rotta: il profilo (licenza) richiesto da ogni rotta non deve cambiare per sbaglio. Il registro è caps-golden.json.
'use strict';
const fs = require('fs');
const path = require('path');
const { capFor } = require('../../src/server/http/caps.js');
const routes = JSON.parse(fs.readFileSync(path.join(__dirname, 'caps-routes.json'), 'utf8'));
const want = JSON.parse(fs.readFileSync(path.join(__dirname, 'caps-golden.json'), 'utf8'));
let ko = 0;
for (const [m, u] of routes) { const got = capFor(m, u); if (got !== want[m + ' ' + u]) { ko++; console.log('KO ' + m + ' ' + u + ': atteso ' + want[m + ' ' + u] + ', ottenuto ' + got); } }
console.log('caps.js: ' + (routes.length - ko) + ' ok, ' + ko + ' ko');
process.exit(ko ? 1 : 0);
