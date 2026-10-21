/* ---------- API ---------- */
async function api(path, body) {
  try {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const j = await r.json();
    if (!r.ok) { add('warn', j.error || 'Errore'); return false; }
    return true;
  } catch (e) { add('warn', 'Server non raggiungibile: ' + e.message); return false; }
}

function onEvent(ev) {
  const d = ev.data;
  if (ev.type === 'status') { lastSteps = d.steps; if (d.status !== lastStatus) setUi(d.status); else { renderSteps(d.steps); paintLive(); } }
  else if (ev.type === 'assistant') { lastAssistant = d.text; add('assistant', d.text); }
  else if (ev.type === 'user') {
    if (/^\/\S+/.test(d.text) && !runInfo.title) { runInfo.title = d.text.replace(/^\/\S+\s*/, '').split('\n')[0].slice(0, 140); live.t0 = ev.t || Date.now(); winReset(); }
    add('user', d.text);
    $('ch-ticket').textContent = runInfo.title || '';
  }
  else if (ev.type === 'tool') {
    addTool(d);
    winFallback(d);
    live.ops++;
    live.feed.push({ seq: ++live.seq, t: ev.t || Date.now(), kind: toolKind(d.name), name: d.name, file: d.file || '', verb: describe(d.name, '').replace(/:$/, ''), detail: d.detail || '', text: describe(d.name, d.detail) });
    if (live.feed.length > FEED_MAX) live.feed.shift();
    paintLive();
  }
  else if (ev.type === 'live') { if (d.kind === 'text') winText(d); else winAction(d); }
  else if (ev.type === 'live-end') winEnd(d);
  else if (ev.type === 'toolout') { winOut(d); toolOutput(d); }
  else if (ev.type === 'live-clear') winClear();
  else if (ev.type === 'log') add('sys', d.text.trim());
  else if (ev.type === 'result') {
    lastResult = { denials: d.denials, isError: d.isError, authError: !!d.authError };
    if (d.denials.length) addDenials(d.denials);
    if (d.isError) add('warn', 'Turno terminato con errore.');
  }
}

$('start').onclick = async () => {
  if (!$('ticket').value.trim() && !startFiles.files.length) { add('warn', 'Inserisci un ticket o allega almeno un file.'); return; }
  const g = proj.git;
  if (g && g.isRepo && g.branch && (PROTECTED.includes(g.branch) || g.branch === g.baseBranch)) {
    if (!(await askConfirm('Sei sul branch "' + g.branch + '" (principale).\n\nPuoi sviluppare comunque qui oppure creare prima un branch dedicato dalla scheda Git.', { title: 'Branch principale', ok: 'Sviluppa qui', cancel: 'Vai alla scheda Git' }))) { gotoTab('git'); return; }
  }
  emptyState();
  const ok = await api('/api/start', { ticket: $('ticket').value.trim(), permissionMode: PERM_MODE, attachments: await startFiles.encode() });
  if (ok) startFiles.clear();
};
$('stop').onclick = () => api('/api/stop');
$('reply').onsubmit = async (e) => {
  e.preventDefault();
  const t = $('text').value.trim();
  if (!t && !replyFiles.files.length) return;
  const ok = await api('/api/send', { text: t || '(vedi allegati)', attachments: await replyFiles.encode() });
  if (ok) { $('text').value = ''; $('text').style.height = ''; replyFiles.clear(); }
};
$('text').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('reply').requestSubmit(); } });
$('text').addEventListener('input', (e) => { const t = e.target; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 180) + 'px'; });
$('quick').onclick = (e) => { if (e.target.dataset.q) api('/api/send', { text: e.target.dataset.q }); };
