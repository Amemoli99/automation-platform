// Unica fonte per le cartelle dell'app: dove sta il codice e dove l'utente tiene i suoi dati.
// Dai sorgenti questo file sta in ui/infra; nel pacchetto offuscato è unito in ui/server.js (esbuild): in entrambi i casi UI_DIR è la cartella "ui".
'use strict';
const os = require('os');
const path = require('path');

const UI_DIR = path.basename(__dirname) === 'infra' ? path.resolve(__dirname, '..') : __dirname;
const KIT_DIR = path.resolve(UI_DIR, '..'); // radice dello strumento (non un progetto dell'utente)
const KIT_CLAUDE = path.join(KIT_DIR, 'kit', '.claude'); // skill e agent forniti col Cockpit

// Dati dell'utente (licenza, credenziali cifrate, stato), fuori dal pacchetto. UI_DATA_DIR serve ai test.
const dataDir = () => process.env.UI_DATA_DIR || path.join(process.env.APPDATA || os.homedir(), 'developerTest-UI');
const uiFile = (...parts) => path.join(UI_DIR, ...parts);

module.exports = { UI_DIR, KIT_DIR, KIT_CLAUDE, dataDir, uiFile };
