// File statici della UI (pagine e risorse in src/web). Le pagine HTML ricevono una CSP con nonce: solo gli script della pagina possono girare.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

// Serve la risorsa richiesta se esiste in `dir`. Ritorna true se ha risposto.
function serveStatic(req, res, dir) {
  const file = req.url === '/' ? 'index.html' : path.basename(req.url.split('?')[0]);
  const p = path.join(dir, file);
  if (!(fs.existsSync(p) && fs.statSync(p).isFile())) return false;
  if (path.extname(p) === '.html') {
    const nonce = crypto.randomBytes(16).toString('base64');
    const html = fs.readFileSync(p, 'utf8').replace(/<script(?=[\s>])/g, `<script nonce="${nonce}"`);
    res.writeHead(200, {
      'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store',
      'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'`,
    }).end(html);
    return true;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' }).end(fs.readFileSync(p));
  return true;
}

module.exports = { serveStatic };
