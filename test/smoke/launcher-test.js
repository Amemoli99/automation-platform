// Prova dell'eseguibile (solo Windows): avvia il server, pubblica la chiave di accesso e passa l'indirizzo col token.
//   node test/smoke/launcher-test.js [percorso-exe]      (default: NexsoftAutomationCockpit.exe nella radice; si costruisce con: npm run exe)
// Funziona sia con l'exe nel repository (avvia src/server/main.js) sia con quello del pacchetto (avvia ui/server.js).
'use strict';
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const exe = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'NexsoftAutomationCockpit.exe'));
let ok = 0, ko = 0;
const t = (n, c, x) => { if (c) { ok++; console.log('  ok  ', n); } else { ko++; console.log('  KO  ', n, x !== undefined ? '-> ' + JSON.stringify(x).slice(0, 200) : ''); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });

(async () => {
  if (process.platform !== 'win32') { console.log('  (saltato: solo Windows)'); return; }
  t('l\'eseguibile esiste', fs.existsSync(exe), exe);
  if (!fs.existsSync(exe)) process.exit(1);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nacp-exe-'));
  const port = await freePort();
  const urlFile = path.join(dir, 'url.txt');
  const env = { ...process.env, UI_PORT: String(port), UI_DATA_DIR: dir, UI_WORKSPACE: dir, UI_LAUNCH_URL_FILE: urlFile };
  delete env.UI_AUTH; delete env.UI_TOKEN;
  const code = await new Promise((res) => { const p = spawn(exe, [], { env, stdio: 'ignore' }); p.on('exit', res); });
  t('l\'eseguibile termina senza errori dopo aver avviato il server', code === 0, code);
  const url = fs.existsSync(urlFile) ? fs.readFileSync(urlFile, 'utf8').trim() : '';
  t('indirizzo con la chiave di accesso', new RegExp('^http://127\\.0\\.0\\.1:' + port + '/\\?t=[A-Za-z0-9_-]{16,}$').test(url), url);
  const base = 'http://127.0.0.1:' + port;
  let r = await fetch(base + '/api/version');
  t('senza chiave l\'API è chiusa', r.status === 401, r.status);
  r = await fetch(url, { redirect: 'manual' });
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  t('con la chiave arriva il cookie di sessione', r.status === 302 && cookie.includes('ui_session_'), [r.status, cookie.slice(0, 20)]);
  r = await fetch(base + '/', { headers: { Cookie: cookie } });
  t('la pagina si apre', r.status === 200 && /Nexsoft Automation Cockpit/.test(await r.text()), r.status);
  r = await fetch(base + '/api/shutdown', { method: 'POST', headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' }, body: '{}' });
  t('chiusura dal browser', r.status === 200, r.status);
  let down = false;
  for (let i = 0; i < 20 && !down; i++) { await sleep(300); try { await fetch(base + '/api/version'); } catch { down = true; } }
  t('il server si ferma', down);
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 30, retryDelay: 500 }); } catch (e) { console.log('  (pulizia non riuscita, cartella temporanea lasciata: ' + dir + ')'); }
  console.log('RISULTATO: ' + ok + ' ok, ' + ko + ' ko');
  setTimeout(() => process.exit(ko ? 1 : 0), 250); // uscita differita: chiudere subito con connessioni aperte fa crashare libuv su Windows
})().catch((e) => { console.log('ERRORE', e.message); process.exit(2); });
