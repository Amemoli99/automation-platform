// Sicurezza dell'accesso con l'autenticazione ACCESA: senza token e cookie niente API né pagina; Host e Origin estranei rifiutati.
//   node test/flow/auth-test.js <base> <token>
'use strict';
const base = process.argv[2];
const token = process.argv[3];
const url = new URL(base);
let ok = 0, ko = 0;
const t = (n, c, x) => { if (c) { ok++; console.log('  ok  ', n); } else { ko++; console.log('  KO  ', n, x !== undefined ? '-> ' + JSON.stringify(x).slice(0, 200) : ''); } };
const call = (p, o = {}) => fetch(base + p, { redirect: 'manual', ...o });

(async () => {
  let r = await call('/api/version');
  t('API senza cookie: 401', r.status === 401, r.status);
  r = await call('/');
  t('pagina senza cookie: 401 con avviso', r.status === 401 && /Accesso richiesto/.test(await r.text()), r.status);
  r = await call('/?t=sbagliato');
  t('token sbagliato: nessun cookie', r.status === 401 && !r.headers.get('set-cookie'), [r.status, r.headers.get('set-cookie')]);
  r = await call('/?t=' + token);
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  const flags = r.headers.get('set-cookie') || '';
  t('token giusto: 302 con cookie HttpOnly e SameSite=Strict', r.status === 302 && /HttpOnly/.test(flags) && /SameSite=Strict/.test(flags) && /^ui_session_\d+=/.test(cookie), [r.status, flags]);
  r = await call('/api/version', { headers: { Cookie: cookie } });
  t('API con cookie: 200', r.status === 200, r.status);
  r = await call('/', { headers: { Cookie: cookie } });
  const csp = r.headers.get('content-security-policy') || '';
  t('pagina con cookie: 200 e CSP con nonce', r.status === 200 && /script-src 'nonce-/.test(csp) && /<script nonce="/.test(await r.text()), [r.status, csp.slice(0, 60)]);
  r = await call('/api/version', { headers: { Cookie: 'ui_session_' + url.port + '=sbagliato' } });
  t('cookie sbagliato: 401', r.status === 401, r.status);
  r = await call('/api/version', { headers: { Cookie: cookie, Origin: 'http://evil.example' } });
  t('Origin estraneo: 403 anche col cookie giusto', r.status === 403, r.status);
  r = await call('/api/version', { headers: { Cookie: cookie, Origin: base } });
  t('Origin dell\'app: 200', r.status === 200, r.status);
  // Host estraneo (DNS rebinding): fetch non permette di cambiare Host, si usa una richiesta http a basso livello
  const http = require('http');
  const status = await new Promise((res) => { const q = http.request({ host: url.hostname, port: url.port, path: '/api/version', headers: { Host: 'evil.example', Cookie: cookie } }, (x) => { x.resume(); res(x.statusCode); }); q.on('error', () => res(0)); q.end(); });
  t('Host estraneo: 403', status === 403, status);
  r = await call('/api/version', { headers: { Cookie: cookie } });
  const h = r.headers;
  t('intestazioni di sicurezza presenti', h.get('x-content-type-options') === 'nosniff' && h.get('x-frame-options') === 'DENY' && h.get('referrer-policy') === 'no-referrer' && h.get('cross-origin-resource-policy') === 'same-origin', [...h.keys()]);
  r = await call('/api/stop', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base } , body: '{}' });
  t('POST senza cookie: 401', r.status === 401, r.status);
  console.log('RISULTATO: ' + ok + ' ok, ' + ko + ' ko');
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.log('ERRORE', e.message); process.exit(2); });
