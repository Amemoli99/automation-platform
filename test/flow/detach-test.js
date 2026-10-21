// Sgancio alla chiusura: se il progetto è sistemato, alla chiusura l'app si sgancia e il progetto resta tra i recenti.
//   node test/flow/detach-test.js <base> <cartella-dati> <progetto>
'use strict';
const fs = require('fs');
const path = require('path');
const [base, data, proj] = process.argv.slice(2);
let ok = 0, ko = 0;
const t = (n, c, x) => { if (c) { ok++; console.log('  ok  ', n); } else { ko++; console.log('  KO  ', n, x !== undefined ? '-> ' + JSON.stringify(x).slice(0, 220) : ''); } };
const h = { 'Content-Type': 'application/json', Origin: base };
const state = () => JSON.parse(fs.readFileSync(path.join(data, 'active-project.json'), 'utf8'));
const same = (a, b) => path.resolve(a || '').toLowerCase() === path.resolve(b).toLowerCase();

(async () => {
  let r = await (await fetch(base + '/api/project', { headers: h })).json();
  t('progetto agganciato prima della chiusura', r.attached === true && same(r.root, proj), r);
  t('lo stato su disco ha il progetto attivo', same(state().root, proj), state());
  await fetch(base + '/api/shutdown', { method: 'POST', headers: h, body: '{}' });
  await new Promise((res) => setTimeout(res, 2500));
  const s = state();
  t('dopo la chiusura il progetto è sganciato', !s.root, s);
  t('e resta tra i recenti', (s.recent || []).some((d) => same(d, proj)), s.recent);
  t('le origini salvate non si perdono', Array.isArray(s.sources) && s.sources.length === 2, s.sources);
  let down = false; try { await fetch(base + '/api/version', { headers: h }); } catch { down = true; }
  t('il server si è fermato', down);
  console.log('RISULTATO: ' + ok + ' ok, ' + ko + ' ko');
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.log('ERRORE', e.message); process.exit(2); });
