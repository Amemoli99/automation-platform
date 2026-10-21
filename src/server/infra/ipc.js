// Comunicazione tra processi dell'app: HTTP su pipe con nome (Windows) o socket di dominio Unix (altrove), senza aprire porte di rete.
// Protezioni: nome casuale a ogni avvio dell'app, token obbligatorio in ogni richiesta, diritti della pipe limitati all'utente
// (nessun accesso in lettura/scrittura "a tutti"). Un programma dello stesso utente che conosca nome e token può comunque collegarsi:
// è lo stesso limite della porta locale, ma qui non c'è nessuna porta da scoprire.
'use strict';
const crypto = require('crypto');
const http = require('http');
const os = require('os');
const path = require('path');

const HEADER = 'x-nacp-token';
const newId = (bytes = 8) => crypto.randomBytes(bytes).toString('hex');
const pipePath = (session, name) => (process.platform === 'win32'
  ? '\\\\.\\pipe\\nacp-' + session + '-' + name
  : path.join(os.tmpdir(), 'nacp-' + session + '-' + name + '.sock'));
const safeEq = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return x.length === y.length && crypto.timingSafeEqual(x, y); };

// Server HTTP su pipe. `handler(req, res)` riceve solo richieste con il token giusto.
function serve({ pipe, token, handler }) {
  const server = http.createServer((req, res) => {
    if (!safeEq(req.headers[HEADER], token)) {
      res.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Accesso non autorizzato al servizio.' }));
      return;
    }
    handler(req, res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ path: pipe, readableAll: false, writableAll: false }, () => resolve(server));
  });
}

// Richiesta a un servizio. Ritorna { status, headers, body (Buffer) }.
function request({ pipe, token, method = 'GET', url = '/', headers = {}, body, timeoutMs = 30000 }) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : (Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)));
    const h = { ...headers, [HEADER]: token };
    if (payload) { h['content-length'] = payload.length; if (!h['content-type']) h['content-type'] = 'application/json'; }
    const req = http.request({ socketPath: pipe, method, path: url, headers: h, timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('Il servizio non ha risposto entro ' + Math.round(timeoutMs / 1000) + ' s.')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// Inoltra una richiesta del browser a un servizio senza interpretarla (anche flussi SSE): il gateway ha già controllato accesso e permessi.
function forward({ pipe, token, req, res, onError }) {
  const headers = { ...req.headers, [HEADER]: token };
  delete headers.cookie; delete headers.host; delete headers.origin; // dati del browser: il servizio non li vede
  const up = http.request({ socketPath: pipe, method: req.method, path: req.url, headers }, (r) => {
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
    r.on('error', () => res.destroy());
  });
  up.on('error', (e) => { if (!res.headersSent) { (onError || ((er, rs) => rs.writeHead(502, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Servizio non raggiungibile: ' + er.message })))) (e, res); } else res.destroy(); });
  res.on('close', () => up.destroy()); // il browser si è scollegato (es. flusso SSE): chiude anche verso il servizio
  req.pipe(up);
}

module.exports = { HEADER, newId, pipePath, serve, request, forward };
