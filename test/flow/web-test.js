// Pagine e risorse della UI: ogni script e foglio di stile citato dalle pagine viene servito col tipo giusto; niente uscite dalla cartella web.
//   node test/flow/web-test.js <base>
'use strict';
const base = process.argv[2];
let ok = 0, ko = 0;
const t = (n, c, x) => { if (c) { ok++; console.log('  ok  ', n); } else { ko++; console.log('  KO  ', n, x !== undefined ? '-> ' + JSON.stringify(x).slice(0, 200) : ''); } };
const get = (p) => fetch(base + p, { headers: { Origin: base } });
const TYPES = { js: 'text/javascript', css: 'text/css', webp: 'image/webp' };

(async () => {
  for (const page of ['/', '/mcp.html', '/pipelines.html']) {
    const r = await get(page); const html = await r.text();
    const csp = r.headers.get('content-security-policy') || '';
    t('GET ' + page + ': 200, HTML, CSP con nonce e style-src self', r.status === 200 && /text\/html/.test(r.headers.get('content-type')) && /script-src 'nonce-/.test(csp) && /style-src 'self'/.test(csp), [r.status, csp.slice(0, 80)]);
    const refs = [...html.matchAll(/<(?:script[^>]*\ssrc|link[^>]*\shref)="([^"]+)"/g)].map((m) => m[1]).filter((u) => u.startsWith('/') || !/^https?:/.test(u));
    for (const u of refs) {
      const url = u.startsWith('/') ? u : '/' + u;
      const x = await get(url); const buf = Buffer.from(await x.arrayBuffer());
      const ext = url.split('.').pop();
      t('  ' + page + ' -> ' + url + ' (' + buf.length + ' B)', x.status === 200 && buf.length > 0 && (x.headers.get('content-type') || '').startsWith(TYPES[ext] || ''), [x.status, x.headers.get('content-type')]);
    }
    if (page === '/') {
      const inline = [...html.matchAll(/<script(?![^>]*\ssrc)[^>]*>([\s\S]*?)<\/script>/g)].filter((m) => m[1].trim());
      t('la pagina principale non ha più script né stili incorporati', inline.length === 0 && !/<style[\s>]/.test(html), inline.length);
      t('script e stile esterni citati', refs.filter((u) => u.startsWith('/js/')).length >= 10 && refs.includes('/css/app.css'), refs);
    }
  }
  const x = await get('/js/core.js');
  t('risposta senza cache per gli script (dopo un aggiornamento non restano file vecchi)', /no-store/.test(x.headers.get('cache-control') || ''), x.headers.get('cache-control'));
  for (const bad of ['/..%2f..%2fpackage.json', '/js/../../../package.json', '/%2e%2e/package.json', '/js/%2e%2e/%2e%2e/package.json', '/.env', '/js/.hidden', '/js%5c..%5c..%5cpackage.json', '/js/', '/js']) {
    const y = await get(bad);
    const body = await y.text();
    t('percorso non consentito: ' + bad, y.status === 404 && !/"name": "automation-platform"/.test(body), [y.status, body.slice(0, 40)]);
  }
  console.log('RISULTATO: ' + ok + ' ok, ' + ko + ' ko');
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.log('ERRORE', e.message); process.exit(2); });
