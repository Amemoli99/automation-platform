// File statici della UI (pagine e risorse in src/web, anche in sottocartelle css/ e js/). Le pagine HTML ricevono una CSP con nonce: solo gli script della pagina possono girare.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

// Percorso richiesto dentro `dir`, mai fuori: niente '..', niente percorsi assoluti, niente file nascosti.
function resolveInside(dir, urlPath) {
  let rel;
  try { rel = decodeURIComponent(urlPath); } catch { return null; }
  if (rel === '/') rel = '/index.html';
  const parts = rel.split('/').filter(Boolean);
  if (!parts.length || parts.some((p) => p === '..' || p === '.' || p.startsWith('.') || p.includes('\\') || p.includes('\0'))) return null;
  const full = path.join(dir, ...parts);
  return full.startsWith(dir + path.sep) ? full : null;
}

// Serve la risorsa richiesta se esiste in `dir`. Ritorna true se ha risposto.
function serveStatic(req, res, dir) {
  const p = resolveInside(dir, req.url.split('?')[0]);
  if (!p || !(fs.existsSync(p) && fs.statSync(p).isFile())) return false;
  if (path.extname(p) === '.html') {
    const nonce = crypto.randomBytes(16).toString('base64');
    const html = fs.readFileSync(p, 'utf8').replace(/<script(?=[\s>])/g, `<script nonce="${nonce}"`);
    res.writeHead(200, {
      'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store',
      'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'`,
    }).end(html);
    return true;
  }
  // no-store anche per script e fogli di stile: dopo un aggiornamento dell'app il browser non deve riusare file vecchi
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(fs.readFileSync(p));
  return true;
}

module.exports = { serveStatic };
