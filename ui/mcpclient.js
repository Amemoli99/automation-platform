// Client MCP minimo (trasporto stdio) per la scheda dei server MCP: avvia il server del progetto come farebbe claude, fa l'handshake,
// elenca i tool e li chiama. Zero dipendenze. Solo server locali (stdio): quelli remoti (http/sse) non sono supportati qui.
// Il server è codice di terze parti che gira con le credenziali dell'utente, esattamente come quando lo avvia claude: per questo
// le scritture sono bloccate finché l'utente non conferma (vedi risk()) e i processi si chiudono dopo 5 minuti di inattività.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const mcpenv = require('./mcpenv');
const { killTree } = require('./infra/proc');

const PROTOCOL = '2025-06-18';
const IDLE_MS = 5 * 60 * 1000;
const MAX_TEXT = 200000;
const sessions = new Map(); // progetto|server -> Session

function readSpec(root, name) {
  let j;
  try { j = JSON.parse(fs.readFileSync(path.join(root, '.mcp.json'), 'utf8').replace(/^﻿/, '')); } catch { throw new Error('.mcp.json non leggibile.'); }
  const v = j && j.mcpServers && Object.prototype.hasOwnProperty.call(j.mcpServers, name) ? j.mcpServers[name] : null;
  if (!v || typeof v !== 'object') throw new Error('Il server "' + name + '" non è nel .mcp.json del progetto.');
  const type = v.type || (v.url ? 'http' : 'stdio');
  if (type !== 'stdio') throw new Error('Questo server è remoto (' + type + '): la scheda gestisce solo server locali (stdio).');
  if (typeof v.command !== 'string' || !v.command.trim()) throw new Error('Il server non ha un comando.');
  return { command: v.command.trim(), args: Array.isArray(v.args) ? v.args.map(String) : [], env: v.env && typeof v.env === 'object' ? v.env : {} };
}
// Variabili ${VAR} usate dal server (in env e args).
function placeholders(spec) {
  const out = new Set();
  const scan = (s) => { for (const m of String(s).matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-[^}]*)?\}/g)) out.add(m[1]); };
  Object.values(spec.env).forEach(scan); spec.args.forEach(scan); scan(spec.command);
  return [...out];
}
function expand(s, vars) { return String(s).replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_, n, d) => (vars[n] != null && vars[n] !== '' ? vars[n] : (d != null ? d : ''))); }

function buildProcess(spec, root, server) {
  const stored = mcpenv.forServer(root, server);
  const vars = { ...process.env, ...stored };
  const env = { ...process.env, ...stored };
  for (const [k, v] of Object.entries(spec.env)) env[k] = expand(v, vars);
  const command = expand(spec.command, vars);
  const args = spec.args.map((a) => expand(a, vars));
  const base = path.basename(command).toLowerCase();
  if (process.platform === 'win32' && /^(npx|npm|pnpm|yarn)(\.cmd)?$/.test(base)) {
    // npx & co sono script .cmd: servono tramite cmd.exe, con argomenti ristretti (niente caratteri speciali della shell)
    for (const a of [command, ...args]) if (/["%^&|<>\r\n]/.test(a)) throw new Error('Argomento non consentito per l\'avvio del server: ' + a.slice(0, 40));
    const line = [command, ...args].map((a) => (/[\s]/.test(a) ? '"' + a + '"' : a)).join(' ');
    return { file: 'cmd.exe', args: ['/d', '/s', '/c', '"' + line + '"'], opts: { windowsVerbatimArguments: true }, env };
  }
  return { file: command, args, opts: {}, env };
}

class Session {
  constructor(root, name) { this.root = root; this.name = name; this.id = 0; this.pending = new Map(); this.buf = ''; this.stderr = ''; this.closed = false; this.ready = null; this.tools = null; }
  start() {
    const spec = readSpec(this.root, this.name);
    const b = buildProcess(spec, this.root, this.name);
    this.missing = placeholders(spec).filter((n) => { const st = mcpenv.forServer(this.root, this.name); return (st[n] == null || st[n] === '') && !process.env[n] && !new RegExp('\\$\\{' + n + ':-').test(JSON.stringify(spec)); });
    this.proc = spawn(b.file, b.args, { cwd: this.root, env: b.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, ...b.opts });
    this.proc.stdout.on('data', (d) => this.onData(String(d)));
    this.proc.stderr.on('data', (d) => { this.stderr = (this.stderr + d).slice(-3000); });
    this.proc.stdin.on('error', () => { /* il processo può chiudersi prima */ });
    this.proc.on('error', (e) => this.fail(new Error('Impossibile avviare il server: ' + e.message + (e.code === 'ENOENT' ? ' (programma non trovato: ' + path.basename(b.file) + ' è installato?)' : ''))));
    this.proc.on('close', (code) => this.fail(new Error('Il server si è chiuso (codice ' + code + ').' + this.hint())));
    this.ready = this.handshake();
    return this.ready;
  }
  hint() {
    const tail = this.stderr.trim().split('\n').slice(-3).join(' | ').slice(0, 400);
    const miss = this.missing && this.missing.length ? ' Variabili mancanti: ' + this.missing.join(', ') + '.' : '';
    return miss + (tail ? ' Messaggio del server: ' + tail : '');
  }
  fail(err) {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.idle);
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(err); }
    this.pending.clear();
    sessions.delete(this.root + '|' + this.name);
  }
  onData(s) {
    this.buf += s;
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      let m; try { m = JSON.parse(line); } catch { continue; } // righe di log non JSON: ignorate
      if (m && m.id != null && (m.result !== undefined || m.error) && this.pending.has(m.id)) {
        const p = this.pending.get(m.id); this.pending.delete(m.id); clearTimeout(p.timer);
        m.error ? p.reject(new Error((m.error.message || 'Errore del server') + (m.error.code != null ? ' (' + m.error.code + ')' : ''))) : p.resolve(m.result);
      } else if (m && m.id != null && m.method) {
        this.send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Metodo non supportato dal Cockpit' } }); // richieste dal server (sampling, roots…): rifiutate
      }
    }
  }
  send(o) { if (!this.closed) this.proc.stdin.write(JSON.stringify(o) + '\n'); }
  request(method, params, timeoutMs) {
    return new Promise((resolve, reject) => {
      if (this.closed) return reject(new Error('Il server non è in esecuzione.'));
      const id = ++this.id;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Nessuna risposta da "' + method + '" entro ' + Math.round(timeoutMs / 1000) + ' s.' + this.hint())); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }
  async handshake() {
    const r = await this.request('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'nexsoft-cockpit', version: '1.0' } }, 120000); // la prima volta npx/uvx scaricano il pacchetto
    this.info = r && r.serverInfo ? { name: String(r.serverInfo.name || ''), version: String(r.serverInfo.version || '') } : null;
    this.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    this.touch();
  }
  touch() { clearTimeout(this.idle); this.idle = setTimeout(() => this.close(), IDLE_MS); if (this.idle.unref) this.idle.unref(); }
  close() {
    if (!this.closed) {
      this.fail(new Error('Sessione chiusa.'));
      killTree(this.proc);
    }
  }
}

async function session(root, name) {
  const k = root + '|' + name;
  let s = sessions.get(k);
  if (!s || s.closed) {
    await mcpenv.warm(root);
    s = new Session(root, name);
    sessions.set(k, s);
    s.start().catch(() => { /* l'errore arriva a chi attende s.ready */ });
  }
  await s.ready;
  s.touch();
  return s;
}

async function listTools(root, name) {
  const s = await session(root, name);
  const tools = [];
  let cursor;
  for (let page = 0; page < 20; page++) {
    const r = await s.request('tools/list', cursor ? { cursor } : {}, 30000);
    for (const t of (r && Array.isArray(r.tools) ? r.tools : [])) {
      if (!t || typeof t.name !== 'string') continue;
      tools.push({ name: t.name, title: typeof t.title === 'string' ? t.title : '', description: String(t.description || '').slice(0, 1500), inputSchema: t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : { type: 'object', properties: {} }, annotations: t.annotations && typeof t.annotations === 'object' ? t.annotations : {} });
    }
    cursor = r && r.nextCursor;
    if (!cursor) break;
  }
  s.tools = tools;
  return { server: s.info, tools };
}

// 'read' = sola lettura; 'write' = può modificare dati; 'destructive' = dichiarato distruttivo. Nel dubbio: 'write' (chiede conferma).
function risk(tool) {
  const a = tool.annotations || {};
  if (a.destructiveHint === true) return 'destructive';
  if (a.readOnlyHint === true) return 'read';
  if (a.readOnlyHint === undefined) {
    // senza annotazioni: solo se il nome ha un verbo di lettura (get, search, list…) e nessun verbo di scrittura
    const parts = tool.name.toLowerCase().split(/[_\-.]+/);
    const READ = ['get', 'search', 'list', 'read', 'find', 'fetch', 'query', 'describe', 'view', 'show', 'lookup'];
    const WRITE = ['create', 'update', 'delete', 'remove', 'add', 'write', 'set', 'post', 'put', 'send', 'transition', 'move', 'edit', 'upload', 'import', 'run', 'execute', 'merge', 'push', 'close', 'assign', 'link', 'comment', 'publish', 'restore', 'archive'];
    if (parts.some((p) => READ.includes(p)) && !parts.some((p) => WRITE.includes(p))) return 'read';
  }
  return 'write';
}

async function callTool(root, name, toolName, args, confirmed) {
  const s = await session(root, name);
  if (!s.tools) await listTools(root, name);
  const tool = s.tools.find((t) => t.name === toolName);
  if (!tool) throw new Error('Il server non ha un tool "' + toolName + '".');
  const rk = risk(tool);
  if (rk !== 'read' && confirmed !== true) throw Object.assign(new Error('Questo tool può modificare dati (' + toolName + '): serve la tua conferma.'), { needsConfirm: true, risk: rk });
  if (args == null) args = {};
  if (typeof args !== 'object' || Array.isArray(args)) throw new Error('Argomenti non validi.');
  if (JSON.stringify(args).length > 100000) throw new Error('Argomenti troppo grandi.');
  const r = await s.request('tools/call', { name: toolName, arguments: args }, 120000);
  s.touch();
  let size = 0;
  const content = (Array.isArray(r && r.content) ? r.content : []).map((c) => {
    if (c && c.type === 'text') { const t = String(c.text || ''); const room = Math.max(0, MAX_TEXT - size); size += t.length; return { type: 'text', text: t.slice(0, room) + (t.length > room ? '\n… (troncato)' : '') }; }
    return { type: String((c && c.type) || 'altro'), text: '[contenuto non testuale: ' + String((c && c.type) || 'altro') + ']' };
  });
  return { isError: !!(r && r.isError), content, structured: r && r.structuredContent && JSON.stringify(r.structuredContent).length < MAX_TEXT ? r.structuredContent : null, risk: rk };
}

// Server del .mcp.json con le variabili ${VAR} che richiedono (nessun valore).
function servers(root) {
  let j;
  try { j = JSON.parse(fs.readFileSync(path.join(root, '.mcp.json'), 'utf8').replace(/^\uFEFF/, '')); } catch { return []; }
  const m = j && j.mcpServers && typeof j.mcpServers === 'object' ? j.mcpServers : {};
  return Object.entries(m).slice(0, 50).map(([name, v]) => {
    v = v && typeof v === 'object' ? v : {};
    const type = v.type || (v.url ? 'http' : 'stdio');
    let vars = [];
    if (type === 'stdio') { try { vars = placeholders(readSpec(root, name)); } catch { vars = []; } }
    return { name, type, supported: type === 'stdio', vars };
  });
}

function stop(root, name) { const s = sessions.get(root + '|' + name); if (s) s.close(); }
function closeAll() { for (const s of [...sessions.values()]) s.close(); }

module.exports = { readSpec, placeholders, servers, listTools, callTool, risk, stop, closeAll };
