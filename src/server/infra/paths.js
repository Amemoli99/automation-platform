// Unica fonte per le cartelle dell'app: dove stanno codice e risorse e dove l'utente tiene i suoi dati.
// Due layout, stesso risultato per chi chiama:
//  - sorgenti:  <repo>/src/server/infra/paths.js  → risorse in src/server/assets, pagine in src/web, strumento = <repo>
//  - pacchetto: unito in <pkg>/ui/server.js (esbuild, __dirname = <pkg>/ui) → risorse e pagine accanto al server, strumento = <pkg>
'use strict';
const os = require('os');
const path = require('path');

const IN_SOURCE = path.basename(__dirname) === 'infra';
// Nel pacchetto il gateway è ui/server.js e ogni servizio è ui/services/<nome>.js (bundle separati): per tutti la cartella "ui" è quella dei dati e delle pagine.
const PKG_UI = path.basename(__dirname) === 'services' ? path.resolve(__dirname, '..') : __dirname;
const SERVER_DIR = IN_SOURCE ? path.resolve(__dirname, '..') : PKG_UI;
const KIT_DIR = IN_SOURCE ? path.resolve(SERVER_DIR, '..', '..') : path.resolve(PKG_UI, '..'); // radice dello strumento (non un progetto dell'utente)
const ASSETS_DIR = IN_SOURCE ? path.join(SERVER_DIR, 'assets') : SERVER_DIR; // catalog.json, skill-steps.json, version.json, templates/
const WEB_DIR = IN_SOURCE ? path.join(KIT_DIR, 'src', 'web') : path.join(SERVER_DIR, 'public'); // pagine servite al browser
const SIM_FILE = IN_SOURCE ? path.join(SERVER_DIR, 'areas', 'demo', 'sim.js') : path.join(SERVER_DIR, 'demo', 'sim.js'); // simulatore della modalità Demo (processo a parte)
const APP_DIR = IN_SOURCE ? path.join(KIT_DIR, 'src') : SERVER_DIR; // cartella su cui si calcola l'impronta della build
const SERVICES_DIR = IN_SOURCE ? path.join(SERVER_DIR, 'service-entries') : path.join(SERVER_DIR, 'services'); // punti d'ingresso dei servizi (processi separati)
const serviceEntry = (name) => path.join(SERVICES_DIR, name + '.js');
const KIT_CLAUDE = path.join(KIT_DIR, 'kit', '.claude'); // skill e agent forniti col Cockpit

// Dati dell'utente (licenza, credenziali cifrate, stato), fuori dal pacchetto. UI_DATA_DIR serve ai test.
const dataDir = () => process.env.UI_DATA_DIR || path.join(process.env.APPDATA || os.homedir(), 'developerTest-UI');
const asset = (...parts) => path.join(ASSETS_DIR, ...parts);

module.exports = { KIT_DIR, KIT_CLAUDE, ASSETS_DIR, WEB_DIR, SIM_FILE, APP_DIR, SERVICES_DIR, dataDir, asset, serviceEntry };
