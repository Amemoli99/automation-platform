// Permessi concessi dall'utente (riavvio con --resume e file di impostazioni) e domande a margine (Ask Claude, copia della sessione).
//   node test/flow/allow-test.js <base> <progetto> <log-del-finto-claude>
'use strict';
const fs = require('fs');
const path = require('path');
const [base, proj, logFile] = process.argv.slice(2);
let ok = 0, ko = 0;
const t = (n, c, x) => { if (c) { ok++; console.log('  ok  ', n); } else { ko++; console.log('  KO  ', n, x !== undefined ? '-> ' + JSON.stringify(x).slice(0, 220) : ''); } };
const h = { 'Content-Type': 'application/json', Origin: base };
const post = async (p, b) => { const r = await fetch(base + p, { method: 'POST', headers: h, body: JSON.stringify(b || {}) }); let j = {}; try { j = await r.json(); } catch { /* non json */ } return [r.status, j]; };
const lines = () => { try { return fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const waitFor = async (fn, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 150)); } return null; };
// legge gli eventi già emessi (il server li rimanda a chi si collega) per un po'
async function events(ms) {
  const r = await fetch(base + '/api/events', { headers: h }); const rd = r.body.getReader(); let buf = ''; const t0 = Date.now();
  while (Date.now() - t0 < ms) { const c = await Promise.race([rd.read(), new Promise((res) => setTimeout(() => res({ value: null }), 300))]); if (c.done) break; if (c.value) buf += Buffer.from(c.value).toString('utf8'); }
  try { rd.cancel(); } catch { /* chiusura */ }
  return buf.split('\n\n').map((b) => b.replace(/^data: /, '')).filter(Boolean).map((x) => { try { return JSON.parse(x); } catch { return null; } }).filter(Boolean);
}

(async () => {
  let [s, j] = await post('/api/allow', { rules: ['Bash(x)'] });
  t('senza sessione: nessuna regola da concedere', s === 400 && /Nessuna sessione/.test(j.error || ''), [s, j]);
  [s, j] = await post('/api/btw', { question: 'ciao' });
  t('domanda a margine senza sessione: rifiutata', s === 400 && /no session|start a run/i.test(j.error || ''), [s, j]);
  [s, j] = await post('/api/start', { ticket: 'NX-9 prova permessi', permissionMode: 'acceptEdits' });
  t('avvio della sessione', s === 200, [s, j]);
  const waiting = await waitFor(async () => { const ev = await events(600); const r = ev.filter((e) => e.type === 'result').pop(); return r && ev.filter((e) => e.type === 'status').pop().data.status === 'waiting' ? r : null; });
  t('la sessione si ferma in attesa con la regola negata', !!waiting && waiting.data.denials.length === 1 && waiting.data.denials[0].rule === 'Bash(mvn test)', waiting && waiting.data);
  [s, j] = await post('/api/allow', { rules: ['Bash(rm -rf /)'] });
  t('una regola non proposta dal server non si concede', s === 400 && /Nessuna regola valida/.test(j.error || ''), [s, j]);
  [s, j] = await post('/api/btw', { question: 'a che punto sei?' });
  t('domanda a margine: risposta e copia della sessione', s === 200 && j.answer === 'Risposta di prova', [s, j]);
  const fork = lines().find((l) => l.args && l.args.includes('--fork-session'));
  t('la domanda usa --resume <id> --fork-session, sola lettura', !!fork && fork.args.includes('--resume') && fork.args.includes('sess1') && fork.args.includes('default'), fork);
  [s, j] = await post('/api/allow', { rules: ['Bash(mvn test)'] });
  t('concessione del permesso', s === 200, [s, j]);
  const resumed = await waitFor(() => lines().find((l) => l.args && l.args.includes('--resume') && !l.args.includes('--fork-session') && l.input));
  t('la sessione riparte con --resume e --settings', !!resumed && resumed.args.includes('sess1') && resumed.args.includes('--settings'), resumed);
  const settings = (() => { try { return JSON.parse(fs.readFileSync(path.join(proj, '.tmp', 'ui-allow.json'), 'utf8')); } catch { return null; } })();
  t('il permesso sta nel file delle impostazioni, non nella riga di comando', !!settings && settings.permissions.allow.includes('Bash(mvn test)') && !resumed.args.join(' ').includes('mvn test'), settings);
  const done = await waitFor(async () => { const ev = await events(600); const st = ev.filter((e) => e.type === 'status').pop(); return st && ['done', 'waiting', 'error'].includes(st.data.status) ? st.data.status : null; });
  t('la sessione ripresa si conclude', done === 'done' || done === 'waiting', done);
  console.log('RISULTATO: ' + ok + ' ok, ' + ko + ' ko');
  setTimeout(() => process.exit(ko ? 1 : 0), 250); // uscita differita: chiudere subito con connessioni aperte fa crashare libuv su Windows
})().catch((e) => { console.log('ERRORE', e.message); process.exit(2); });
