/* --- Ask Claude (stile /btw) --- */
const BTW_CHIPS = ['What are you doing right now?', 'What is left to do?', 'Any problems so far?', 'Summarize the progress'];
function updateBtw() {
  const show = curTab === 'run' && lastStatus !== 'idle' && (typeof can !== 'function' || can('run'));
  $('btw-fab').hidden = !show || btw.open;
  $('btw-panel').hidden = !show || !btw.open;
}
function btwRender() {
  const log = $('btw-log');
  if (!btw.items.length) { log.replaceChildren(Object.assign(mk('div', 'btw-empty'), { textContent: 'Ask anything about the work in progress, for example how far it is or what it is doing now. Each question is independent.' })); return; }
  log.replaceChildren(...btw.items.map((it) => {
    const d = mk('div', 'btw-msg ' + it.role);
    if (it.role === 'a') { d.innerHTML = md(it.text); if (it.sim) d.append(mk('span', 'btw-sim', 'Simulated (Demo)')); } // md() esegue l'escape del testo
    else if (it.role === 'p') { d.append(mk('i'), mk('i'), mk('i'), document.createTextNode(' Claude is thinking…')); }
    else d.textContent = it.text;
    return d;
  }));
  log.scrollTop = log.scrollHeight;
}
function btwOpen(on) {
  btw.open = on; updateBtw();
  if (on) { btwRender(); setTimeout(() => $('btw-q').focus(), 50); }
}
async function btwAsk(text) {
  const q = String(text || '').trim();
  if (!q || btw.busy) return;
  btw.busy = true; $('btw-send').disabled = true; $('btw-q').value = '';
  btw.items.push({ role: 'q', text: q }, { role: 'p' }); btwRender();
  let item;
  try { const r = await call('/api/btw', { question: q }); item = { role: 'a', text: r.answer, sim: !!r.simulated }; }
  catch (e) { item = { role: 'e', text: e.message }; }
  btw.items[btw.items.length - 1] = item;
  btw.busy = false; $('btw-send').disabled = false; btwRender(); $('btw-q').focus();
}
$('btw-fab').onclick = () => btwOpen(true);
$('btw-close').onclick = () => btwOpen(false);
$('btw-form').onsubmit = (e) => { e.preventDefault(); btwAsk($('btw-q').value); };
$('btw-q').onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); btwAsk($('btw-q').value); } else if (e.key === 'Escape') btwOpen(false); };
$('btw-chips').replaceChildren(...BTW_CHIPS.map((c) => { const b = mk('button', '', c); b.type = 'button'; b.onclick = () => btwAsk(c); return b; }));

