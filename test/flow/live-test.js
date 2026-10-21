// Prova del flusso in diretta (server): mascheramento, messaggi parziali, output, ricollegamento.
const base = process.argv[2];
const h = { 'Content-Type': 'application/json', Origin: base };
const post = async (p, b) => { const r = await fetch(base + p, { method: 'POST', headers: h, body: JSON.stringify(b || {}) }); let j = {}; try { j = await r.json(); } catch { /* non json */ } return [r.status, j]; };
let ok = 0, ko = 0;
const t = (n, c, x) => { if (c) { ok++; console.log('  ok  ', n); } else { ko++; console.log('  KO  ', n, x !== undefined ? '-> ' + JSON.stringify(x).slice(0, 240) : ''); } };
async function capture(ms) {
  const r = await fetch(base + '/api/events', { headers: h }); const rd = r.body.getReader(); let buf = ''; const t0 = Date.now();
  while (Date.now() - t0 < ms) { const c = await Promise.race([rd.read(), new Promise((res) => setTimeout(() => res({ value: null }), 500))]); if (c.done) break; if (c.value) buf += Buffer.from(c.value).toString('utf8'); }
  try { rd.cancel(); } catch { /* chiusura */ }
  return buf.split('\n\n').map((b) => b.replace(/^data: /, '')).filter(Boolean).map((x) => { try { return JSON.parse(x); } catch { return null; } }).filter(Boolean);
}
(async () => {
  const SECRETS = ['abcdefghijklmnopqrstuvwxyz0123456789', 'Segr3toDiProva99', 'abcdefghijklmnopqrstuvwxyz012345'];
  // si apre l'ascolto PRIMA di avviare, come fa la pagina
  const capP = capture(9000);
  await new Promise((r) => setTimeout(r, 600));
  let [s, j] = await post('/api/start', { ticket: 'NX-1 prova diretta', permissionMode: 'acceptEdits' });
  t('avvio della pipeline', s === 200, [s, j.error]);
  const ev = await capP;
  const raw = JSON.stringify(ev);
  const live = ev.filter((e) => e.type === 'live'), outs = ev.filter((e) => e.type === 'toolout');
  console.log('  eventi:', ev.length, '| live:', live.length, '| live-end:', ev.filter((e) => e.type === 'live-end').length, '| toolout:', outs.length);
  t('arrivano messaggi in diretta (testo e azioni)', live.some((e) => e.data.kind === 'text') && live.some((e) => e.data.kind === 'tool'), live.length);
  t('il testo cresce a pezzi (più istantanee)', live.filter((e) => e.data.kind === 'text').length >= 3, live.filter((e) => e.data.kind === 'text').length);
  t('NESSUN segreto in nessun evento (diretta, azioni, output, conversazione)', !SECRETS.some((x) => raw.includes(x)), SECRETS.filter((x) => raw.includes(x)));
  const PART = ['abcdefg', 'Segr3to'];
  t('NESSUN pezzo incompleto di segreto in nessun evento', !PART.some((x) => raw.includes(x)), PART.filter((x) => raw.includes(x)));
  const texts = live.filter((e) => e.data.kind === 'text').map((e) => e.data.text);
  t('token spezzato: mai visibile nemmeno in parte oltre il prefisso', !texts.some((x) => /ghp_[A-Za-z0-9]{4,}/.test(x)), texts.filter((x) => /ghp_[A-Za-z0-9]{4,}/.test(x)).slice(0, 2));
  const cmdSnaps = live.filter((e) => e.data.kind === 'tool' && e.data.name === 'Bash').map((e) => e.data);
  t('comando Bash in diretta con segreti mascherati', cmdSnaps.length >= 3 && /^curl /.test(cmdSnaps[cmdSnaps.length - 1].title) && /Authorization: \*\*\*/.test(cmdSnaps[cmdSnaps.length - 1].title), cmdSnaps[cmdSnaps.length - 1]);
  const wr = live.filter((e) => e.data.name === 'Write').map((e) => e.data);
  t('Write in diretta: percorso e codice a pezzi', wr.length >= 2 && wr[wr.length - 1].title === 'src/A.java' && /class A/.test(wr[wr.length - 1].body), wr[wr.length - 1]);
  const o1 = outs.find((e) => e.data.id === 'tu1');
  t('output del comando: mascherato, senza codici colore, limitato', !!o1 && !/\u001b/.test(o1.data.text) && o1.data.text.length <= 8100 && /APP_PASSWORD=\*\*\*/.test(o1.data.text) && o1.data.size > 15000, o1 && { len: o1.data.text.length, size: o1.data.size, head: o1.data.text.slice(0, 80) });
  t('del lungo output si tiene la parte finale', !!o1 && /riga 399/.test(o1.data.text) && !/riga 0 /.test(o1.data.text));
  const tools = ev.filter((e) => e.type === 'tool');
  t('gli eventi azione hanno ora l\'id (per abbinare l\'output)', tools.length === 2 && tools.every((e) => !!e.data.id), tools.map((e) => e.data.id));
  t('il comando nella conversazione è mascherato', !/Segr3to|abcdefghijklmnopqrstuvwxyz/.test(JSON.stringify(tools)), tools[0] && tools[0].data.detail);
  const asst = ev.find((e) => e.type === 'assistant');
  t('il testo completo di Claude nella conversazione è mascherato', !!asst && !/Segr3to|abcdefghijklmnopqrstuvwxyz0123456789/.test(asst.data.text), asst && asst.data.text);
  // ricollegamento a esecuzione conclusa: i messaggi completi e gli output si ripresentano, le istantanee no
  await new Promise((r) => setTimeout(r, 800));
  const re = await capture(2500);
  t('al ricollegamento tornano azioni e output', re.filter((e) => e.type === 'tool').length === 2 && re.filter((e) => e.type === 'toolout').length === 2, re.map((e) => e.type));
  t('al ricollegamento non restano istantanee "in corso"', re.filter((e) => e.type === 'live').length === 0, re.filter((e) => e.type === 'live').length);
  t('la diretta si chiude a fine processo', ev.some((e) => e.type === 'live-clear'), ev.map((e) => e.type).slice(-6));
  console.log('\nRISULTATO: ' + ok + ' ok, ' + ko + ' ko');
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.log('ERRORE', e.message); process.exit(2); });
