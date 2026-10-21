// Sicurezza dell'accesso: la UI pilota un agente con accesso al repository, quindi solo l'eseguibile (che porta il token) può usarla.
// Ogni avvio genera un token segreto. Il browser lo riceve una sola volta (dall'eseguibile, che apre /?t=<token>) e lo tiene in un
// cookie HttpOnly: senza, né altri programmi/utenti del PC né le pagine web possono chiamare le API, che pilotano l'agente.
// UI_AUTH=off è solo per i test automatici. Un test dedicato (test/flow/auth-test.js) copre questo modulo.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const unauthorizedPage = `<!doctype html><html lang="it"><meta charset="utf-8"><title>Accesso richiesto</title>
<style>body{font:15px/1.6 "Segoe UI",system-ui,sans-serif;background:#f6f7f9;color:#16181d;display:grid;place-items:center;min-height:100vh;margin:0}main{background:#fff;border:1px solid #e4e7ec;border-radius:14px;padding:32px 36px;max-width:460px;box-shadow:0 4px 16px rgba(16,24,40,.06)}h1{font-size:19px;margin:0 0 8px}p{margin:8px 0;color:#4b5563}</style>
<main><h1>Accesso richiesto</h1><p>Questa pagina si apre solo dall'eseguibile <b>NexsoftAutomationCockpit.exe</b>, che porta con sé la chiave di accesso di questa sessione.</p><p>Chiudi questa scheda e riavvia l'eseguibile.</p></main></html>`;

function createAuth({ HOST, PORT, dataDir }) {
  const AUTH_ON = process.env.UI_AUTH !== 'off';
  const TOKEN = /^[A-Za-z0-9_-]{16,128}$/.test(process.env.UI_TOKEN || '') ? process.env.UI_TOKEN : crypto.randomBytes(32).toString('hex');
  const COOKIE_NAME = 'ui_session_' + PORT; // per porta: due istanze su porte diverse non si sovrascrivono il cookie
  const ORIGINS = [`http://${HOST}:${PORT}`, `http://localhost:${PORT}`];
  const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
  const cookieOf = (req) => { const m = new RegExp('(?:^|;\\s*)' + COOKIE_NAME + '=([A-Za-z0-9_-]+)').exec(req.headers.cookie || ''); return m ? m[1] : ''; };
  const SESSION_FILE = path.join(dataDir(), 'session-' + PORT + '.json');

  function writeSession() { // lo legge l'eseguibile per aprire il browser col token giusto
    try { fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true }); fs.writeFileSync(SESSION_FILE, JSON.stringify({ port: PORT, token: TOKEN, pid: process.pid }), { mode: 0o600 }); } catch (e) { console.error('Impossibile scrivere il file di sessione:', e.message); }
  }
  function removeSession() { try { fs.rmSync(SESSION_FILE, { force: true }); } catch { /* già rimosso */ } }

  // Controlli comuni a ogni richiesta. Ritorna true se la richiesta è già stata chiusa (rifiutata o reindirizzata).
  function guard(req, res, json) {
    // difesa da DNS rebinding / richieste cross-origin verso l'agente locale
    const hostOk = [`${HOST}:${PORT}`, `localhost:${PORT}`].includes(req.headers.host);
    if (!hostOk) { res.writeHead(403).end('Forbidden'); return true; }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'"); // la pagina principale ne imposta una più larga (con nonce)
    // richieste che arrivano da un'altra origine (altra pagina web) sono rifiutate, anche se il cookie ci fosse
    if (req.headers.origin && !ORIGINS.includes(req.headers.origin)) { json(403, { error: 'Origine non consentita' }); return true; }
    if (AUTH_ON) {
      const url0 = new URL(req.url, 'http://x');
      if (req.method === 'GET' && url0.pathname === '/' && url0.searchParams.has('t')) {
        if (safeEq(url0.searchParams.get('t'), TOKEN)) {
          res.writeHead(302, { 'Set-Cookie': `${COOKIE_NAME}=${TOKEN}; HttpOnly; SameSite=Strict; Path=/`, Location: '/', 'Cache-Control': 'no-store' }).end();
          return true;
        }
      }
      if (!safeEq(cookieOf(req), TOKEN)) {
        if (req.url.startsWith('/api/')) { json(401, { error: 'Accesso non autorizzato: riapri la UI dall\'eseguibile.' }); return true; }
        res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'" }).end(unauthorizedPage);
        return true;
      }
    }
    return false;
  }

  return { AUTH_ON, TOKEN, writeSession, removeSession, guard };
}

module.exports = { createAuth };
