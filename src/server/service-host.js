// Host di un servizio: espone su una pipe con nome le rotte di un'area, con lo stesso modello del gateway
// (ogni modulo di rotte ha get(ctx) e post(ctx) e risponde NOT_HANDLED per ciò che non è suo).
// Il gateway ha già controllato accesso e permessi: qui si verifica solo il token del supervisore (infra/ipc.js).
// Non importa nessuna area: le rotte arrivano dal chiamante, così lo stesso host serve qualunque area e le prove.
'use strict';
const { serve, decodeContext, CONTEXT_HEADER } = require('./infra/ipc');
const { NOT_HANDLED } = require('./http/route');

const MAX_BODY = 40 * 1024 * 1024; // gli allegati arrivano in base64

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error('Body troppo grande')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { const s = Buffer.concat(chunks).toString('utf8'); resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

// Avvia il servizio e ritorna il server. `routes`: modulo o elenco di moduli di rotte.
// `controls`: messaggi di controllo del gateway ({ operazione: (corpo) => risposta }), per ciò che non è una rotta (es. attivare la Demo).
// `onShutdown`: da chiamare prima di uscire (es. fermare i processi figli del servizio).
async function runService({ name, routes, pipe, token, controls = {}, onShutdown = null }) {
  const modules = [].concat(routes);
  const started = Date.now();
  let server = null;
  let closing = false;
  const shutdown = (code = 0) => {
    if (closing) return;
    closing = true;
    try { if (onShutdown) onShutdown(); } catch { /* si esce comunque */ }
    try { server.close(); } catch { /* già chiuso */ }
    setTimeout(() => process.exit(code), 150);
  };
  const handler = async (req, res) => {
    const json = (code, obj) => res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Nacp-Service': name }).end(JSON.stringify(obj));
    res.setHeader('X-Nacp-Service', name); // il browser (e i test) possono vedere quale servizio ha risposto
    try {
      if (req.method === 'GET' && req.url === '/_nacp/health') return json(200, { ok: true, service: name, pid: process.pid, uptimeMs: Date.now() - started });
      if (req.method === 'POST' && req.url === '/_nacp/shutdown') { json(200, { ok: true }); return shutdown(0); }
      if (req.method === 'POST' && req.url.startsWith('/_nacp/control/')) {
        const op = req.url.slice('/_nacp/control/'.length);
        if (!Object.prototype.hasOwnProperty.call(controls, op)) return json(404, { error: 'Controllo sconosciuto: ' + op });
        return json(200, (await controls[op](await readBody(req))) || { ok: true });
      }
      const kind = req.method === 'GET' ? 'get' : req.method === 'POST' ? 'post' : null;
      if (kind) {
        const ctx = { req, res, json, body: kind === 'post' ? await readBody(req) : null, shutdown, context: decodeContext(req.headers[CONTEXT_HEADER]) };
        for (const m of modules) {
          if (typeof m[kind] !== 'function') continue;
          if ((await m[kind](ctx)) !== NOT_HANDLED) return;
        }
      }
      json(404, { error: 'Rotta non gestita dal servizio ' + name + '.' });
    } catch (e) {
      if (!res.headersSent) json(e && e.denied ? 403 : 400, { error: e.message, ...(e && e.denied ? { code: 'role' } : {}) });
      else res.destroy();
    }
  };
  server = await serve({ pipe, token, handler });
  // se il supervisore sparisce (chiuso o crash) il servizio non resta orfano
  process.on('disconnect', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
  if (process.send) process.send({ type: 'ready', service: name, pid: process.pid });
  return server;
}

module.exports = { runService };
