// Scheda "Tool": cosa è collegato al sistema e cosa carica il progetto agganciato (sola lettura, nessuna modifica).
// Sicurezza: dei server MCP si mostrano solo i NOMI delle variabili d'ambiente e degli header, mai i valori;
// nei comandi e negli URL i segreti evidenti (flag --token/--key/--password, credenziali e query degli URL) sono oscurati.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { exec } = require('child_process');
const jdks = require('../project').jdks;

const KIT_CLAUDE = require('../../infra/paths').KIT_CLAUDE; // skill e agent del kit del Cockpit: servono a dire "nome presente nel kit"
const MAX_ITEMS = 300;

const clip = (s, n = 300) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return e.code === 'ENOENT' ? null : { __error: clip(e.message, 120) }; }
}
function readText(file, max = 64 * 1024) {
  try { const fd = fs.openSync(file, 'r'); try { const b = Buffer.alloc(max); const n = fs.readSync(fd, b, 0, max, 0); return b.toString('utf8', 0, n); } finally { fs.closeSync(fd); } } catch { return ''; }
}
const listDir = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; } };

// Frontmatter YAML minimale (chiave: valore, anche "description: >" su più righe).
function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const out = {};
  if (!m) return out;
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const k = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(lines[i]);
    if (!k) continue;
    let v = k[2];
    if (/^[>|][+-]?$/.test(v)) { v = ''; while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) v += ' ' + lines[++i].trim(); }
    out[k[1]] = v.replace(/^["']|["']$/g, '');
  }
  return out;
}

/* ---------- programmi sul computer ---------- */
function run(cmd, args, env, timeout = 15000) {
  return new Promise((resolve) => {
    // exec (shell) su Windows per risolvere i .cmd (claude, mvn, npx); comandi e argomenti sono costanti
    exec([cmd, ...args].join(' '), { timeout, windowsHide: true, encoding: 'utf8', env }, (err, stdout, stderr) =>
      resolve({ ok: !err, out: String(stdout || '').trim() || String(stderr || '').trim() }));
  });
}
const firstLine = (s) => clip(String(s).split(/\r?\n/)[0].replace(/\s*\([0-9a-f]{20,}\)/i, ''), 120); // senza l'hash di build (Maven)

// Il programma da cui dipende un server MCP (npx, uvx, node...), dal suo comando.
function runtimeOf(v) {
  if (!v || !v.command) return '';
  const base = (x) => path.basename(String(x)).toLowerCase().replace(/\.(exe|cmd|bat)$/, '');
  const c = base(v.command);
  if (c === 'cmd' && Array.isArray(v.args)) { const i = v.args.findIndex((a) => !/^\/[a-z]$/i.test(String(a))); return i >= 0 ? base(v.args[i]) : c; }
  return c;
}

async function programs(runtimeNeeds, jdkHome) {
  const jenv = jdks.envFor(jdkHome);
  const [claude, git, mvn, java, npx, uvx, winget] = await Promise.all([
    run('claude', ['--version']), run('git', ['--version']), run('mvn', ['-v'], jenv), run('java', ['-version'], jenv),
    run('npx', ['--version']), run('uvx', ['--version']), run('winget', ['--version']),
  ]);
  const jv = /version "([^"]+)"/.exec(java.out);
  const need = (id) => runtimeNeeds[id] && runtimeNeeds[id].length ? 'Richiesto dai server MCP: ' + runtimeNeeds[id].join(', ') : '';
  const row = (id, label, r, detail, why, required) => ({ id, label, status: r.ok ? 'ok' : (required ? 'fail' : 'warn'), detail: r.ok ? detail : 'Non trovato nel PATH', why });
  return [
    row('claude', 'Claude CLI', claude, firstLine(claude.out), 'Esegue la pipeline', true),
    { id: 'node', label: 'Node.js', status: Number(process.versions.node.split('.')[0]) >= 18 ? 'ok' : 'warn', detail: 'v' + process.versions.node, why: 'Fa girare questa applicazione' },
    row('git', 'Git', git, firstLine(git.out), 'Branch, worktree e commit', true),
    row('mvn', 'Maven', mvn, firstLine(mvn.out), 'Compila ed esegue i test', true),
    row('java', 'Java (JDK)', java, jv ? jv[1] + (jenv.JAVA_HOME && jdkHome ? ' (scelto per il progetto)' : '') : firstLine(java.out), 'Compilazione ed esecuzione dei test', true),
    row('npx', 'npx', npx, 'v' + firstLine(npx.out), need('npx') || 'Avvia server MCP basati su Node', !!need('npx')),
    row('uvx', 'uvx (uv)', uvx, firstLine(uvx.out), need('uvx') || 'Avvia server MCP basati su Python', !!need('uvx')),
    row('winget', 'winget', winget, firstLine(winget.out), 'Servirà per installare i programmi mancanti (non ancora attivo)', false),
  ];
}

/* ---------- server MCP ---------- */
const SECRET_FLAG = /^--?[\w-]*(key|token|secret|password|passwd|auth|credential)[\w-]*$/i;
function maskText(s) {
  return String(s).replace(/(\/\/)[^/@\s]+@/g, '$1***@').replace(/\?[^\s]*/g, '?…');
}
function maskCommand(parts) {
  const out = [];
  let hide = false;
  for (const p of parts.map(String)) {
    if (hide) { out.push('***'); hide = false; continue; }
    const eq = /^(--?[\w-]+)=(.*)$/.exec(p);
    if (eq && SECRET_FLAG.test(eq[1])) { out.push(eq[1] + '=***'); continue; }
    if (SECRET_FLAG.test(p)) { out.push(p); hide = true; continue; }
    out.push(maskText(p));
  }
  return clip(out.join(' '), 200);
}

function projectSettings(root) {
  const shared = readJson(path.join(root, '.claude', 'settings.json')) || {};
  const local = readJson(path.join(root, '.claude', 'settings.local.json')) || {};
  const arr = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string') : []);
  return {
    shared, local,
    enabled: [...arr(shared.enabledMcpjsonServers), ...arr(local.enabledMcpjsonServers)],
    disabled: [...arr(shared.disabledMcpjsonServers), ...arr(local.disabledMcpjsonServers)],
    enableAll: shared.enableAllProjectMcpServers === true || local.enableAllProjectMcpServers === true,
    allow: [...arr(shared.permissions && shared.permissions.allow), ...arr(local.permissions && local.permissions.allow)],
  };
}

function mcpServers(root) {
  const file = path.join(root, '.mcp.json');
  const j = readJson(file);
  if (!j) return { file: false, servers: [] };
  if (j.__error) return { file: true, error: 'File .mcp.json non leggibile: ' + j.__error, servers: [] };
  const st = projectSettings(root);
  const servers = Object.entries(j.mcpServers && typeof j.mcpServers === 'object' ? j.mcpServers : {}).slice(0, MAX_ITEMS).map(([name, v]) => {
    v = v && typeof v === 'object' ? v : {};
    const type = v.type || (v.url ? 'http' : 'stdio');
    const parts = type === 'stdio' ? [v.command || '', ...(Array.isArray(v.args) ? v.args : [])] : [v.url || ''];
    const enabled = st.disabled.includes(name) ? false : (st.enableAll || st.enabled.includes(name) ? true : null);
    const rules = st.allow.filter((r) => r === 'mcp__' + name || r.startsWith('mcp__' + name + '__'));
    const all = rules.some((r) => r === 'mcp__' + name || r === 'mcp__' + name + '__*');
    return {
      name, type, command: maskCommand(parts), runtime: type === 'stdio' ? runtimeOf(v) : '',
      envNames: Object.keys(v.env && typeof v.env === 'object' ? v.env : {}), headerNames: Object.keys(v.headers && typeof v.headers === 'object' ? v.headers : {}),
      enabled, permissions: all ? 'tutti gli strumenti' : (rules.length ? rules.length + ' strumenti' : 'nessun permesso preconcesso'),
    };
  });
  return { file: true, servers };
}

// Stato reale dei server (claude mcp list): avvia i server, quindi si lancia solo su richiesta.
async function mcpStatus(root, jdkHome) {
  const r = await new Promise((resolve) => {
    exec('claude mcp list', { cwd: root || os.homedir(), timeout: 90000, windowsHide: true, encoding: 'utf8', env: jdks.envFor(jdkHome), maxBuffer: 1024 * 1024 },
      (err, stdout) => resolve({ ok: !err, out: String(stdout || '') }));
  });
  if (!r.ok && !r.out.trim()) throw new Error('claude mcp list non è riuscito (claude non trovato o scaduto il tempo).');
  const items = [];
  for (const line of r.out.split(/\r?\n/)) {
    const m = /^(.+?): (.+) - (\S+) (.+)$/.exec(line.trim());
    if (!m) continue;
    const sym = m[3];
    items.push({
      name: clip(m[1], 80), command: maskCommand(m[2].split(/\s+/)),
      status: sym === '✔' || sym === '✓' ? 'ok' : (sym === '!' ? 'warn' : 'fail'), detail: clip(m[4], 120),
      scope: /^claude\.ai /i.test(m[1]) ? 'account' : 'locale',
    });
  }
  return items.slice(0, MAX_ITEMS);
}

/* ---------- skill, agent, comandi ---------- */
function claudeItems(root) {
  const base = path.join(root, '.claude');
  const kitHas = (kind, name) => fs.existsSync(path.join(KIT_CLAUDE, kind, name));
  const skills = [];
  for (const e of listDir(path.join(base, 'skills'))) {
    if (!e.isDirectory() || skills.length >= MAX_ITEMS) continue;
    const f = path.join(base, 'skills', e.name, 'SKILL.md');
    if (!fs.existsSync(f)) continue;
    const fm = frontmatter(readText(f, 8192));
    skills.push({ name: fm.name || e.name, id: e.name, description: clip(fm.description), origin: kitHas('skills', e.name) ? 'kit' : 'progetto' });
  }
  const agents = [];
  for (const e of listDir(path.join(base, 'agents'))) {
    if (!e.isFile() || !e.name.endsWith('.md') || agents.length >= MAX_ITEMS) continue;
    const fm = frontmatter(readText(path.join(base, 'agents', e.name), 8192));
    agents.push({ name: fm.name || e.name.slice(0, -3), id: e.name, description: clip(fm.description), model: clip(fm.model, 40), tools: clip(fm.tools, 120), origin: kitHas('agents', e.name) ? 'kit' : 'progetto' });
  }
  const commands = [];
  for (const e of listDir(path.join(base, 'commands'))) {
    if (!e.isFile() || !e.name.endsWith('.md') || commands.length >= MAX_ITEMS) continue;
    const text = readText(path.join(base, 'commands', e.name), 8192);
    const fm = frontmatter(text);
    const first = text.replace(/^---[\s\S]*?---\s*/, '').split(/\r?\n/).find((l) => l.trim());
    commands.push({ name: e.name.slice(0, -3), description: clip(fm.description || first || ''), origin: 'progetto' });
  }
  const by = (a, b) => a.name.localeCompare(b.name);
  return { skills: skills.sort(by), agents: agents.sort(by), commands: commands.sort(by) };
}

/* ---------- hook e script ---------- */
// Prima riga utile del commento iniziale o della docstring (salta shebang e l'intestazione che ripete solo il nome del file).
function describeFile(file) {
  const base = path.basename(file).toLowerCase();
  const noExt = (s) => s.replace(/\.[a-z0-9]+$/, '');
  let inDoc = false;
  for (const l of readText(file, 3072).split(/\r?\n/).slice(0, 30)) {
    let t = l.trim();
    if (!t || /^#!/.test(t) || /^#\s*requires/i.test(t) || /^@echo\s+off/i.test(t) || /^['"]use strict['"];?$/.test(t)) continue;
    let m;
    if (/^("""|''')\s*$/.test(t)) { inDoc = true; continue; }
    if ((m = /^("""|''')\s*(.+?)\s*("""|''')?$/.exec(t))) { t = m[2]; inDoc = true; }
    else if ((m = /^(?:#|\/\/|REM\s)\s*(.*)$/.exec(t))) t = m[1];
    else if (!inDoc) break; // finita l'intestazione: nessun commento iniziale
    t = t.trim();
    if (!t || /^[-=*#]+$/.test(t)) continue;
    if (t.toLowerCase() === base || noExt(t.toLowerCase()) === noExt(base)) continue;
    return clip(t, 200);
  }
  return '';
}

function hooksAndScripts(root) {
  const settingsHooks = [];
  const commands = [];
  for (const [fname, source] of [['settings.json', 'condiviso'], ['settings.local.json', 'locale']]) {
    const j = readJson(path.join(root, '.claude', fname));
    const hooks = j && !j.__error && j.hooks && typeof j.hooks === 'object' ? j.hooks : {};
    for (const [event, groups] of Object.entries(hooks)) {
      for (const g of Array.isArray(groups) ? groups : []) {
        for (const h of Array.isArray(g && g.hooks) ? g.hooks : []) {
          if (settingsHooks.length >= MAX_ITEMS) break;
          const command = clip(h && (h.command || h.prompt || h.url), 220);
          commands.push(command);
          settingsHooks.push({ event, matcher: clip(g.matcher || '*', 60), type: clip(h && h.type || 'command', 20), command, source });
        }
      }
    }
  }
  const registered = (name) => commands.some((c) => c.includes(name));
  const files = [];
  const walk = (dir, rel, depth) => {
    for (const e of listDir(dir)) {
      if (files.length >= MAX_ITEMS || e.name === '__pycache__' || e.name === 'node_modules' || e.name.startsWith('.')) continue;
      if (e.isDirectory()) { if (depth < 2) walk(path.join(dir, e.name), rel + '/' + e.name, depth + 1); continue; }
      if (!/\.(ps1|py|sh|bat|cmd|mjs|cjs|js)$/i.test(e.name)) continue;
      files.push({ path: rel + '/' + e.name, description: describeFile(path.join(dir, e.name)), registered: registered(e.name) });
    }
  };
  walk(path.join(root, '.claude', 'hooks'), '.claude/hooks', 0);
  walk(path.join(root, '.claude', 'scripts'), '.claude/scripts', 0);
  return { hooks: settingsHooks, files };
}

/* ---------- catalogo: aggiungere al progetto (nessuna installazione) ---------- */
const CATALOG_FILE = require('../../infra/paths').asset('catalog.json');
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const ENV_PLACEHOLDER = /^\$\{[A-Z][A-Z0-9_]{0,63}\}$/;

// Voce da scrivere in .mcp.json. Su Windows npx è un .cmd: claude lo avvia solo tramite "cmd /c" (come fanno già i progetti).
function mcpEntry(server) {
  if (server.type) return { ...server }; // server remoto (http/sse): nessun comando da avviare
  const args = Array.isArray(server.args) ? server.args.map(String) : [];
  const entry = process.platform === 'win32' && server.command === 'npx' ? { command: 'cmd', args: ['/c', 'npx', ...args] } : { command: server.command, args };
  if (server.env && Object.keys(server.env).length) entry.env = { ...server.env };
  return entry;
}

function catalogMcp() {
  const j = readJson(CATALOG_FILE);
  const list = j && Array.isArray(j.mcp) ? j.mcp : [];
  return list.filter((x) => x && ID_RE.test(String(x.id)) && x.server && typeof x.server.command === 'string' && x.server.command
    && Object.values(x.server.env || {}).every((v) => typeof v === 'string' && ENV_PLACEHOLDER.test(v))) // niente valori letterali: solo segnaposto
    .map((x) => ({ id: x.id, label: clip(x.label || x.id, 80), description: clip(x.description), notes: clip(x.notes), source: /^https:\/\/[\w./-]{1,200}$/.test(String(x.source || '')) ? x.source : '', server: x.server }));
}

function kitList() {
  const out = [];
  for (const e of listDir(path.join(KIT_CLAUDE, 'skills'))) {
    if (!e.isDirectory() || !ID_RE.test(e.name)) continue;
    const fm = frontmatter(readText(path.join(KIT_CLAUDE, 'skills', e.name, 'SKILL.md'), 8192));
    out.push({ type: 'skill', id: e.name, label: '/' + e.name, description: clip(fm.description) });
  }
  for (const e of listDir(path.join(KIT_CLAUDE, 'agents'))) {
    if (!e.isFile() || !e.name.endsWith('.md') || !ID_RE.test(e.name.slice(0, -3))) continue;
    const fm = frontmatter(readText(path.join(KIT_CLAUDE, 'agents', e.name), 8192));
    out.push({ type: 'agent', id: e.name.slice(0, -3), label: e.name.slice(0, -3), description: clip(fm.description) });
  }
  return out;
}

function filesUnder(dir, rel = '') {
  const out = [];
  for (const e of listDir(dir)) {
    if (out.length >= 50) break;
    if (e.isDirectory()) out.push(...filesUnder(path.join(dir, e.name), rel + e.name + '/'));
    else out.push(rel + e.name);
  }
  return out.slice(0, 50);
}
const kitTarget = (type, id) => type === 'skill'
  ? { src: path.join(KIT_CLAUDE, 'skills', id), rel: '.claude/skills/' + id }
  : { src: path.join(KIT_CLAUDE, 'agents', id + '.md'), rel: '.claude/agents/' + id + '.md' };

async function catalog(root) {
  const mcp = catalogMcp();
  const present = new Set(root ? mcpServers(root).servers.map((s) => s.name) : []);
  const runtimes = [...new Set(mcp.map((x) => x.server.command))];
  const have = {};
  await Promise.all(runtimes.map(async (r) => { have[r] = (await run(r, ['--version'])).ok; }));
  const kit = kitList().map((it) => {
    const t = kitTarget(it.type, it.id);
    return { ...it, present: !!root && fs.existsSync(path.join(root, t.rel)), files: it.type === 'skill' ? filesUnder(t.src).map((f) => t.rel + '/' + f) : [t.rel] };
  });
  return {
    project: !!root,
    mcp: mcp.map((x) => ({
      id: x.id, label: x.label, description: x.description, notes: x.notes, source: x.source, present: present.has(x.id),
      runtime: x.server.command, runtimeOk: !!have[x.server.command], envNames: Object.keys(x.server.env || {}),
      preview: JSON.stringify({ [x.id]: mcpEntry(x.server) }, null, 2),
    })),
    kit,
    hasProfile: !!root && fs.existsSync(path.join(root, '.claude', 'project-profile.md')),
  };
}

// Aggiunge un server MCP a .mcp.json: mai sovrascrive una voce esistente, rifiuta un file non valido, salva prima una copia in .tmp/.
function addMcp(root, id) {
  const item = catalogMcp().find((x) => x.id === id);
  if (!item) throw new Error('Voce non presente nel catalogo.');
  return writeMcpEntry(root, item.id, mcpEntry(item.server), Object.keys(item.server.env || {}));
}

// Voce dal registro MCP ufficiale: si ricostruisce dal registro (mai dai dati del browser), poi si scrive come le altre.
async function addRegistry(root, name, version, option) {
  const b = await require('./registry').build(name, version, option);
  return { ...writeMcpEntry(root, b.key, mcpEntry(b.server), b.envNames), summary: b.summary };
}

function writeMcpEntry(root, key, entry, envNames) {
  const file = path.join(root, '.mcp.json');
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw new Error('.mcp.json non leggibile: ' + clip(e.message, 100)); }
  let j = { mcpServers: {} };
  let indent = 2;
  if (text.trim()) {
    try { j = JSON.parse(text.replace(/^﻿/, '')); } catch { throw new Error('.mcp.json non è un JSON valido: non lo modifico.'); }
    if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('.mcp.json ha un formato inatteso: non lo modifico.');
    const m = /\n([ \t]+)"/.exec(text);
    if (m) indent = m[1].includes('\t') ? '\t' : m[1].length;
  }
  if (!j.mcpServers || typeof j.mcpServers !== 'object' || Array.isArray(j.mcpServers)) j.mcpServers = {};
  if (Object.prototype.hasOwnProperty.call(j.mcpServers, key)) throw new Error('Nel progetto esiste già un server "' + key + '": non lo sovrascrivo.');
  let backup = '';
  if (text) {
    fs.mkdirSync(path.join(root, '.tmp'), { recursive: true });
    backup = '.tmp/mcp.json.bak-' + Date.now();
    fs.writeFileSync(path.join(root, backup), text);
  }
  j.mcpServers[key] = entry;
  let out = JSON.stringify(j, null, indent) + '\n';
  if (text.includes('\r\n')) out = out.replace(/\n/g, '\r\n'); // mantiene gli a-capo del file
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, out);
  fs.renameSync(tmp, file);
  return { added: ['.mcp.json'], key, backup, envNames, note: 'Claude chiede l\'approvazione del server al primo uso.' };
}

// Copia nel progetto una skill o un agent del kit: mai sovrascrive, nessun percorso dall'utente (solo voci dell'elenco del kit).
function addKit(root, type, id) {
  const it = kitList().find((x) => x.type === type && x.id === id);
  if (!it) throw new Error('Voce non presente nel kit.');
  const t = kitTarget(type, id);
  const dst = path.join(root, t.rel);
  if (fs.existsSync(dst)) throw new Error('Esiste già nel progetto: ' + t.rel + '. Non lo sovrascrivo.');
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(t.src, dst, { recursive: true, errorOnExist: true, force: false });
  return { added: type === 'skill' ? filesUnder(t.src).map((f) => t.rel + '/' + f) : [t.rel], note: fs.existsSync(path.join(root, '.claude', 'project-profile.md')) ? '' : 'Manca .claude/project-profile.md: le skill e gli agent del kit lo leggono. Usa "Prepara il progetto" per il kit completo.' };
}

async function addToProject(root, type, id, extra) {
  if (!root) throw new Error('Nessun progetto agganciato: scegline uno dalla scheda Progetto.');
  id = String(id || '');
  if (type === 'registry') return addRegistry(root, id, extra && extra.version, extra && extra.option); // il nome del registro ha una barra: lo valida registry.js
  if (!ID_RE.test(id)) throw new Error('Identificativo non valido.');
  if (type === 'mcp') return addMcp(root, id);
  if (type === 'skill' || type === 'agent') return addKit(root, type, id);
  throw new Error('Tipo non valido.');
}

/* ---------- insieme ---------- */
async function collect(root, jdkHome) {
  const mcp = root ? mcpServers(root) : { file: false, servers: [] };
  const needs = {};
  for (const s of mcp.servers) if (s.runtime) (needs[s.runtime] = needs[s.runtime] || []).push(s.name);
  const prog = await programs(needs, jdkHome);
  if (!root) return { project: false, programs: prog };
  return { project: true, programs: prog, mcp, ...claudeItems(root), ...hooksAndScripts(root) };
}

module.exports = { collect, mcpStatus, catalog, addToProject, frontmatter, maskCommand, runtimeOf };
