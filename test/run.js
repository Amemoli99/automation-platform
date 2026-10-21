#!/usr/bin/env node
'use strict';
// Lanciatore dei test. Prepara da solo tutto ciò che serve (licenza di prova, progetto, finto Jira, finto claude) in .tmp/test,
// avvia il server, esegue lo scenario e lo ferma.
//   node test/run.js unit|flow|smoke|all [--dist <cartella del pacchetto>]
// Con --dist il server parte dal pacchetto costruito (npm run dist) invece che dai sorgenti: è la prova di fumo del file offuscato.
const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const lic = require(path.join(ROOT, 'src', 'server', 'areas', 'license', 'license'));
const FIX = path.join(__dirname, 'fixtures');
const TMP = path.join(ROOT, '.tmp', 'test');

const argv = process.argv.slice(2);
const what = argv.find((a) => !a.startsWith('--')) || 'all';
const inproc = argv.includes('--inproc'); // tutto in un solo processo (NACP_INPROC=1): via di fuga, deve restare identico
if (inproc) process.env.NACP_INPROC = '1';
const distArg = argv.indexOf('--dist') >= 0 ? argv[argv.indexOf('--dist') + 1] : null;
const ENTRY = distArg ? path.join(path.resolve(distArg), 'ui', 'server.js') : path.join(ROOT, 'src', 'server', 'main.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fwd = (p) => p.replace(/\\/g, '/');
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); s.on('error', rej); });

function runNode(file, args, env) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [file, ...args], { cwd: ROOT, env: { ...process.env, ...env }, stdio: 'inherit' });
    p.on('exit', (c) => resolve(c));
  });
}

async function api(base, method, url, body) {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Origin: base }, body: method === 'POST' ? JSON.stringify(body || {}) : undefined });
  let j = {}; try { j = await r.json(); } catch { /* non json */ }
  return [r.status, j];
}

// Ambiente di prova: licenza valida per questo PC firmata con una chiave creata al volo (la chiave vera non serve né si tocca).
async function startEnv(name, opt = {}) {
  const dir = path.join(TMP, name);
  fs.rmSync(dir, { recursive: true, force: true });
  const data = path.join(dir, 'data'), proj = path.join(dir, 'proj'), parent = path.join(dir, 'parent');
  for (const d of [data, proj, parent, path.join(dir, 'ws')]) fs.mkdirSync(d, { recursive: true });
  const kp = lic.generateKeypair();
  const pub = path.join(dir, 'license-public.pem');
  fs.writeFileSync(pub, kp.publicPem);
  fs.writeFileSync(path.join(data, 'license.json'), lic.issue({ privatePem: kp.privatePem, org: 'Prova', user: 'Test Locale', email: 'test@esempio.it', role: 'admin', machine: lic.machineCode(), days: 7 }));
  fs.writeFileSync(path.join(data, 'active-project.json'), JSON.stringify({ recent: [], sources: [{ provider: 'github', host: 'github.com', owner: 'org-esempio' }, { provider: 'gitlab', host: 'gitlab.esempio.it', owner: 'gruppo-esempio' }], prefs: {}, frameworkRepo: 'https://maven.pkg.github.com/mia-org/mio-repo' }));

  const children = [];
  const env = { ...process.env, ...(opt.auth ? { UI_TOKEN: 'token-di-prova-1234567890' } : { UI_AUTH: 'off' }), UI_LICENSE_PUB_PEM: pub, UI_DATA_DIR: data, UI_WORKSPACE: path.join(dir, 'ws'), STUB_LOG: path.join(dir, 'stub-log.json'), ENV_LOG: path.join(dir, 'env-log.json') };
  Object.assign(env, opt.env || {}); // variabili aggiuntive del singolo scenario
  if (opt.stub) { // il server lancia "claude" con shell:true: su Windows serve un .cmd che richiami il finto
    const cmd = path.join(dir, 'claude.cmd');
    fs.writeFileSync(cmd, '@echo off\r\nnode "' + path.join(FIX, opt.stub) + '" %*\r\n');
    env.UI_CLAUDE_BIN = cmd;
  }
  if (opt.jira) {
    const jp = await freePort();
    children.push(spawn(process.execPath, [path.join(FIX, 'fake_jira.js')], { env: { ...process.env, FAKE_JIRA_PORT: String(jp) }, stdio: 'ignore' }));
    env.UI_JIRA_API = 'http://127.0.0.1:' + jp;
    await sleep(500);
  }
  const port = await freePort();
  const base = 'http://127.0.0.1:' + port;
  const server = spawn(process.execPath, [ENTRY], { cwd: ROOT, env: { ...env, UI_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; server.stdout.on('data', (d) => { log += d; }); server.stderr.on('data', (d) => { log += d; });
  children.push(server);
  const stop = () => { for (const c of children) { try { c.kill(); } catch { /* già terminato */ } } };
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { const r = await fetch(base + '/api/version'); up = r.status < 500; } catch { await sleep(250); } }
  if (!up) { stop(); throw new Error('il server non è partito:\n' + log); }

  // progetto di prova: creato dall'app stessa, come farebbe l'utente dal wizard
  if (!opt.noProject) {
    const [s, j] = await api(base, 'POST', '/api/project/create', { mode: 'new', name: 'Prova Setup', dir: proj + '/p', envs: [{ name: 'DEV', url: 'https://dev.example.it' }], username: '', password: '', initialCommit: false, pipeline: { mode: 'default' }, frameworkRepo: 'https://maven.pkg.github.com/mia-org/mio-repo', activate: true });
    if (s !== 200) { stop(); throw new Error('progetto di prova non creato: ' + JSON.stringify(j).slice(0, 200)); }
    // valore noto che l'app deve mascherare alla lettera
    if (opt.secretEnv) fs.appendFileSync(path.join(proj, 'p', '.env'), ['', 'APP_PASSWORD=Segr3toDiProva99', ''].join(String.fromCharCode(10)));
    if (opt.mcp) {
      const f = path.join(proj, 'p', '.mcp.json'); const m = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { mcpServers: {} };
      m.mcpServers = { ...(m.mcpServers || {}), fake: { command: 'node', args: [fwd(path.join(FIX, 'fake_mcp.js'))], env: { FAKE_TOKEN: '${FAKE_TOKEN}' } } };
      fs.writeFileSync(f, JSON.stringify(m, null, 2));
    }
  }
  if (opt.jira) { // connessione salvata ma scollegata: è lo stato da cui parte l'utente
    let [s, j] = await api(base, 'POST', '/api/jira/config', { baseUrl: 'https://prova.atlassian.net', email: 'prova@esempio.it', token: 'token-di-prova' });
    if (s !== 200) { stop(); throw new Error('Jira di prova non configurato: ' + JSON.stringify(j).slice(0, 200)); }
    [s, j] = await api(base, 'POST', '/api/jira/unlink', {});
  }
  return { base, dir: parent, data, stubLog: env.STUB_LOG, root: path.join(proj, 'p'), stop, log: () => log };
}

const SUITES = {
  unit: [{ name: 'mascheramento dei segreti', file: 'test/unit/redact-test.js', unit: true }, { name: 'permessi per rotta', file: 'test/unit/caps-test.js', unit: true }, { name: 'nomi usati e non dichiarati', file: 'test/unit/scope-test.js', unit: true }, { name: 'architettura: aree, interfacce, dipendenze', file: 'test/unit/architecture-test.js', unit: true }, { name: 'servizi: pipe con nome, token, supervisore', file: 'test/unit/ipc-test.js', unit: true }],
  flow: [
    { name: 'diretta: finestre, mascheramento, output', file: 'test/flow/live-test.js', env: { stub: 'stub_live_claude.js', secretEnv: true } },
    { name: 'Demo e Jira', file: 'test/flow/demo-jira-test.js', env: { noProject: true } },
    { name: 'pagine e risorse della UI', file: 'test/flow/web-test.js', env: { noProject: true } },
    { name: 'accesso protetto (token, cookie, Origin, Host)', file: 'test/flow/auth-test.js', env: { auth: true, noProject: true }, withToken: true },
    { name: 'permessi concessi e domande a margine', file: 'test/flow/allow-test.js', env: { stub: 'stub_allow_claude.js' }, withLog: true },
    { name: 'servizi: Jira come processo separato', file: 'test/flow/services-test.js', env: { noProject: true }, args: ['on'], needsServices: true },
    { name: 'servizi: se non parte, Jira resta in-process', file: 'test/flow/services-test.js', env: { noProject: true, env: { NACP_SERVICE_ENTRY_JIRA: 'C:/non/esiste/jira.js' } }, args: ['fallback'], needsServices: true },
    { name: 'servizi: Tools con il contesto del gateway', file: 'test/flow/tools-service-test.js', env: { env: { NACP_SERVICES: 'jira,tools' } }, needsServices: true },
    { name: 'servizi: Pipelines (editor) con il contesto del gateway', file: 'test/flow/pipelines-service-test.js', env: { stub: 'stub_panel_claude.js', env: { NACP_SERVICES: 'jira,tools,pipelines' } }, needsServices: true, withRoot: true },
    { name: 'sgancio alla chiusura', file: 'test/flow/detach-test.js', env: {}, withData: true },
    { name: 'rotte del server (stato e messaggi identici al registro)', file: 'test/flow/routes-probe.js', env: { stub: 'stub_live_claude.js' }, withRoot: true },
  ],
  smoke: [{ name: 'prova di fumo (pagine, Jira, MCP, editor, wizard, Demo)', file: 'test/smoke/smoke-test.js', env: { stub: 'stub_panel_claude.js', jira: true, mcp: true }, withDir: true }],
};

(async () => {
  const groups = what === 'all' ? ['unit', 'flow', 'smoke'] : [what];
  if (groups.some((g) => !SUITES[g])) { console.error('uso: node test/run.js unit|flow|smoke|all [--dist <cartella>]'); process.exit(2); }
  let bad = 0;
  for (const g of groups) for (const t of SUITES[g]) {
    if (inproc && t.needsServices) continue;
    console.log('\n=== ' + t.name + (distArg ? ' [pacchetto]' : ''));
    if (t.unit) { if (await runNode(path.join(ROOT, t.file), [], {})) bad++; continue; }
    let env;
    try { env = await startEnv(path.basename(t.file, '.js'), t.env); } catch (e) { console.log('  KO  ' + e.message); bad++; continue; }
    const extra = t.withDir ? [env.dir] : t.withRoot ? [env.root] : t.withToken ? ['token-di-prova-1234567890'] : t.withData ? [env.data, env.root] : t.withLog ? [env.root, env.stubLog] : t.args || [];
    if (argv.includes('--record')) extra.push('--record'); // rigenera il registro delle rotte
    try { if (await runNode(path.join(ROOT, t.file), [env.base, ...extra], {})) bad++; } finally { env.stop(); }
  }
  console.log('\n' + (bad ? 'ESITO: ' + bad + ' scenari con errori' : 'ESITO: tutti i test passati'));
  process.exit(bad ? 1 : 0);
})();
