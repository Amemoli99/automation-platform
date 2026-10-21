/* Disegno di una scheda MCP (descrizione di dati + tool del server). Condiviso da mcp.html (creazione) e dalla pagina principale (uso).
 * Non contiene logica del server: i tool si chiamano con /api/mcp/call, e quelli che possono modificare dati chiedono sempre conferma. */
(() => {
  'use strict';
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const callout = (kind, text) => mk('div', 'callout ' + kind, text);
  async function api(path, body) {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let j = {}; try { j = await r.json(); } catch { /* risposta non JSON */ }
    if (!r.ok) throw Object.assign(new Error(j.error || ('Errore ' + r.status)), { status: r.status, data: j });
    return j;
  }

  // Stili limitati a .mcpv: non toccano il resto della pagina che ospita la scheda.
  const CSS = `
  .mcpv .mbar { display:flex; gap:10px; align-items:center; margin-top:14px; flex-wrap:wrap; }
  .mcpv .mbar button { flex:none; width:auto; }
  .mcpv .chip { display:inline-block; padding:2px 9px; border-radius:99px; font-size:12px; background:var(--code); color:var(--muted); }
  .mcpv .chip.ok { background:var(--ok-soft); color:var(--ok); } .mcpv .chip.warn { background:var(--warn-soft); color:var(--warn); } .mcpv .chip.err { background:var(--err-soft); color:var(--err); }
  .mcpv p.sub { margin:8px 0 14px; color:var(--muted); }
  .mcpv small.hint { display:block; color:var(--muted); font-size:12px; margin-top:4px; }
  .mcpv .callout { padding:10px 13px; border-radius:10px; background:var(--code); margin:10px 0; font-size:13px; white-space:pre-wrap; }
  .mcpv .callout.err { background:var(--err-soft); color:var(--err); } .mcpv .callout.warn { background:var(--warn-soft); } .mcpv .callout.ok { background:var(--ok-soft); }
  .mcpv details.grp { border:1px solid var(--line); border-radius:10px; margin:12px 0; background:var(--subtle); }
  .mcpv details.grp > summary { cursor:pointer; padding:10px 14px; font-weight:600; }
  .mcpv .tool { border-top:1px solid var(--line); padding:14px; background:var(--panel); }
  .mcpv .tool:first-of-type { border-top:0; }
  .mcpv .tool h3 { margin:0; font-size:15px; display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
  .mcpv .tool .help { color:var(--muted); margin:2px 0 8px; }
  .mcpv .frm { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:4px 14px; }
  .mcpv .frm label { font-weight:600; font-size:12.5px; margin-top:6px; display:block; } .mcpv .frm .chk { display:flex; gap:8px; align-items:center; margin-top:22px; font-weight:400; } .mcpv .frm .chk input { width:auto; }
  .mcpv .res { margin-top:10px; }
  .mcpv table.t { width:100%; border-collapse:collapse; font-size:13px; } .mcpv table.t th { text-align:left; color:var(--muted); font-size:12px; padding:4px 8px; border-bottom:1px solid var(--line); } .mcpv table.t td { padding:5px 8px; border-bottom:1px solid var(--line); vertical-align:top; word-break:break-word; }
  .mcpv .li { padding:7px 10px; border:1px solid var(--line); border-radius:8px; margin:5px 0; } .mcpv .li b { display:block; } .mcpv .li small { color:var(--muted); }
  .mcpv pre { margin:0; padding:10px; background:var(--code); color:var(--fg); border-radius:8px; overflow:auto; font:12px var(--mono); white-space:pre-wrap; word-break:break-word; max-height:420px; }
  .mcpv .plan { border:1px solid var(--line-strong); background:var(--brand-soft); border-radius:10px; padding:14px 16px; margin:12px 0; }
  .mcpv .plan textarea { width:100%; min-height:64px; margin:8px 0; }
    .mcpv .term { background:#0c0c0c; color:#d4d4d4; font:12px var(--mono); padding:10px 12px; border-radius:8px; height:260px; max-height:none; overflow:auto; white-space:pre-wrap; word-break:break-word; margin:8px 0; }
  .mcpv .term .tc { color:#7dd3fc; } .mcpv .term .tr { color:#9ca3af; } .mcpv .term .tt { color:#e5e7eb; }
  .mcpv .term .cur { animation:mcptermblink 1s steps(2,start) infinite; } @keyframes mcptermblink { to { visibility:hidden; } }
  @media (prefers-reduced-motion: reduce) { .mcpv .term .cur { animation:none; } }
  .mcpv .termstat { font-size:12.5px; color:var(--muted); }
  .mcpv .answer { margin-top:10px; } .mcpv .answer .ptxt { white-space:pre-wrap; margin:8px 0; }
  .mcpv .codebox { position:relative; margin:8px 0; } .mcpv .codebox button { position:absolute; top:6px; right:6px; }
  .mcpv .empty { padding:30px; text-align:center; color:var(--muted); }`;
  function injectCss() {
    if (document.getElementById('mcpview-css')) return;
    const st = document.createElement('style'); st.id = 'mcpview-css'; st.textContent = CSS; document.head.append(st);
  }

  /* ---------- rendering dei risultati ---------- */
  const getPath = (o, p) => { if (!p) return o; let v = o; for (const k of p.split('.')) { if (v == null || typeof v !== 'object') return undefined; v = v[k]; } return v; };
  const scalar = (v) => (v == null ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v)));
  function parseResult(r) {
    const text = (r.content || []).map((c) => c.text).join('\n');
    let data = r.structured || null;
    if (data == null) { const t = text.trim(); if (/^[\[{]/.test(t)) { try { data = JSON.parse(t); } catch { data = null; } } }
    return { text, data };
  }
  function firstArray(d) { if (Array.isArray(d)) return d; if (d && typeof d === 'object') for (const v of Object.values(d)) if (Array.isArray(v)) return v; return null; }
  function renderResult(r, spec) {
    const box = mk('div', 'res');
    const { text, data } = parseResult(r);
    if (r.isError) { box.append(callout('err', text || 'Il tool ha restituito un errore.')); return box; }
    const type = (spec && spec.type) || 'json';
    const items = type === 'table' || type === 'list' ? (spec.itemsPath ? getPath(data, spec.itemsPath) : firstArray(data)) : null;
    if ((type === 'table' || type === 'list') && Array.isArray(items) && items.length) {
      if (type === 'table') {
        let cols = (spec.columns || []).filter((c) => c.path || c.label);
        if (!cols.length) cols = Object.keys(items[0] || {}).filter((k) => typeof items[0][k] !== 'object').slice(0, 6).map((k) => ({ path: k, label: k }));
        const t = mk('table', 't'); const h = mk('tr'); cols.forEach((c) => h.append(mk('th', '', c.label || c.path))); t.append(h);
        items.slice(0, 200).forEach((it) => { const tr = mk('tr'); cols.forEach((c) => tr.append(mk('td', '', scalar(getPath(it, c.path))))); t.append(tr); });
        box.append(t);
      } else {
        const pick = (it, p, alts) => { let v = p ? getPath(it, p) : undefined; if (v == null) for (const a of alts) if (it && it[a] != null) { v = it[a]; break; } return v; };
        items.slice(0, 200).forEach((it) => {
          const li = mk('div', 'li'); li.append(mk('b', '', scalar(pick(it, spec.titlePath, ['title', 'name', 'summary', 'key', 'id']) ?? '(senza titolo)')));
          const sub = pick(it, spec.subtitlePath, ['space', 'status', 'excerpt', 'description']); if (sub != null) li.append(mk('small', '', typeof sub === 'object' ? (sub.name || sub.title || JSON.stringify(sub)) : String(sub)));
          box.append(li);
        });
      }
      box.append(mk('small', 'hint', items.length + (items.length === 1 ? ' risultato' : ' risultati')));
    } else if (type === 'text' || data == null) {
      box.append(mk('pre', '', text || '(risposta vuota)'));
    } else {
      box.append(mk('pre', '', JSON.stringify(data, null, 2)));
    }
    if (data != null || text) { const d = mk('details'); d.append(mk('summary', 'hint', 'Risposta grezza'), mk('pre', '', text || JSON.stringify(data, null, 2))); box.append(d); }
    return box;
  }

  /* ---------- esecuzione di un tool (con conferma per quelli che possono modificare dati) ---------- */
  async function runTool(s, entry, tool, args, out, btn) {
    let confirm = false;
    if (tool.risk !== 'read') {
      if (!window.confirm('Questo strumento ' + (tool.risk === 'destructive' ? 'è segnalato come DISTRUTTIVO' : 'può modificare dati') + ' su "' + s.name + '".\n\nStrumento: ' + tool.name + '\nArgomenti: ' + JSON.stringify(args).slice(0, 300) + '\n\nEseguirlo?')) return;
      confirm = true;
    }
    btn.disabled = true; out.replaceChildren(mk('small', 'hint', 'In esecuzione…'));
    try { const r = await api('/api/mcp/call', { server: s.name, tool: tool.name, args, confirm }); out.replaceChildren(renderResult(r, entry.result)); }
    catch (e) { out.replaceChildren(callout('err', e.message)); }
    btn.disabled = false;
  }

  /* ---------- una card per tool ---------- */
  const RISK = { read: ['ok', 'sola lettura'], write: ['warn', 'può modificare dati'], destructive: ['err', 'distruttivo'] };
  function toolCard(s, entry, tool) {
    const card = mk('div', 'tool');
    const h = mk('h3', '', entry.label || tool.name); const rk = RISK[tool.risk] || RISK.write; h.append(mk('span', 'chip ' + rk[0], rk[1]));
    if (entry.hidden) h.append(mk('span', 'chip', 'tecnico'));
    card.append(h);
    const help = entry.help || (tool.description || '').split(/(?<=[.!?])\s/)[0];
    if (help) card.append(mk('div', 'help', help));
    const props = (tool.inputSchema && tool.inputSchema.properties) || {};
    const req = new Set((tool.inputSchema && tool.inputSchema.required) || []);
    const frm = mk('div', 'frm'); const getters = [];
    for (const [name, sc] of Object.entries(props)) {
      const f = (entry.fields && entry.fields[name]) || {};
      const lab = mk('label'); lab.textContent = (f.label || sc.title || name) + (req.has(name) ? ' *' : '');
      const wrap = mk('div'); let inp; const type = Array.isArray(sc.type) ? sc.type[0] : sc.type;
      if (Array.isArray(sc.enum)) { inp = mk('select'); if (!req.has(name)) inp.append(Object.assign(mk('option', '', '(nessuno)'), { value: '' })); sc.enum.forEach((o) => inp.append(Object.assign(mk('option', '', String(o)), { value: String(o) }))); if (f.default != null) inp.value = String(f.default); else if (sc.default != null) inp.value = String(sc.default); getters.push(() => { if (inp.value === '') return undefined; return type === 'number' || type === 'integer' ? Number(inp.value) : inp.value; }); }
      else if (type === 'boolean') { const l = mk('label', 'chk'); inp = mk('input'); inp.type = 'checkbox'; inp.checked = f.default === true || sc.default === true; l.append(inp, f.label || sc.title || name); wrap.append(l); const gb = () => (inp.checked ? true : undefined); gb.nm = name; getters.push(gb); frm.append(wrap); continue; }
      else if (type === 'number' || type === 'integer') { inp = mk('input'); inp.type = 'number'; inp.placeholder = f.placeholder || ''; if (f.default != null) inp.value = f.default; else if (sc.default != null) inp.value = sc.default; getters.push(() => (inp.value === '' ? undefined : Number(inp.value))); }
      else if (type === 'array' || type === 'object') { inp = mk('textarea'); inp.placeholder = f.placeholder || (type === 'array' ? '["valore1", "valore2"]' : '{"chiave": "valore"}'); inp.style.minHeight = '56px'; getters.push(() => { if (!inp.value.trim()) return undefined; try { return JSON.parse(inp.value); } catch { throw new Error('Il campo "' + (f.label || name) + '" deve essere JSON valido.'); } }); }
      else { inp = mk('input'); inp.type = 'text'; inp.placeholder = f.placeholder || ''; if (f.default != null) inp.value = f.default; else if (sc.default != null) inp.value = sc.default; getters.push(() => (inp.value === '' ? undefined : inp.value)); }
      const nm = name; getters[getters.length - 1].nm = nm;
      wrap.append(lab, inp); const hp = f.help || sc.description; if (hp) wrap.append(mk('small', 'hint', String(hp).slice(0, 200)));
      frm.append(wrap);
    }
    card.append(frm);
    const bar = mk('div', 'mbar'); const run = mk('button', 'primary sm', 'Esegui'); run.type = 'button'; bar.append(run); card.append(bar);
    const out = mk('div'); card.append(out);
    run.onclick = async () => {
      let args = {};
      try { for (const g of getters) { const v = g(); if (v !== undefined) args[g.nm] = v; } } catch (e) { out.replaceChildren(callout('err', e.message)); return; }
      for (const n of req) if (args[n] === undefined) { out.replaceChildren(callout('err', 'Compila il campo obbligatorio "' + (((entry.fields || {})[n] || {}).label || n) + '".')); return; }
      runTool(s, entry, tool, args, out, run);
    };
    return card;
  }

  /* ---------- "Descrivi cosa ti serve": Claude usa da solo gli strumenti del server per rispondere ---------- */
  const get = async (path) => {
    const r = await fetch(path, { cache: 'no-store' });
    let j = {}; try { j = await r.json(); } catch { /* risposta non JSON */ }
    if (!r.ok) throw new Error(j.error || ('Errore ' + r.status));
    return j;
  };
  // Risposta di Claude: i blocchi di codice (query, filtri, indirizzi) diventano riquadri con il pulsante Copia.
  function renderAnswer(text) {
    const box = mk('div', 'answer');
    const re = /```[A-Za-z0-9_+-]*\n?([\s\S]*?)```/g; let last = 0, m;
    const para = (t) => {
      t = t.trim(); if (!t) return;
      const d = mk('div', 'ptxt'); const rb = /\*\*([^*]+)\*\*/g; let p = 0, b;
      while ((b = rb.exec(t))) { d.append(document.createTextNode(t.slice(p, b.index)), mk('b', '', b[1])); p = b.index + b[0].length; }
      d.append(document.createTextNode(t.slice(p))); box.append(d);
    };
    while ((m = re.exec(text))) {
      para(text.slice(last, m.index)); last = m.index + m[0].length;
      const wrap = mk('div', 'codebox'); const code = m[1].replace(/\n$/, '');
      const cp = mk('button', 'sm', 'Copia'); cp.type = 'button';
      cp.onclick = async () => { try { await navigator.clipboard.writeText(code); cp.textContent = 'Copiato'; } catch { cp.textContent = 'Non copiabile'; } setTimeout(() => { cp.textContent = 'Copia'; }, 1500); };
      wrap.append(cp, mk('pre', '', code)); box.append(wrap);
    }
    para(text.slice(last));
    return box;
  }
  // Schermo tipo terminale: i passi (strumenti chiamati e risultati) e il testo che Claude sta scrivendo, aggiornati ogni mezzo secondo.
  async function watchAsk(id, out) {
    const stat = mk('div', 'termstat'), term = mk('pre', 'term'), cur = mk('span', 'cur', '▌');
    const stop = mk('button', 'sm', 'Annulla'); stop.type = 'button';
    const head = mk('div', 'mbar'); head.style.marginTop = '8px'; head.append(stat, stop);
    out.replaceChildren(head, term);
    let cancelled = false;
    stop.onclick = async () => { cancelled = true; stop.disabled = true; try { await api('/api/mcp/ask-cancel', { id }); } catch { /* già finito */ } };
    let sig = '';
    for (;;) {
      // Il lavoro continua anche se la schermata non è visibile (cambio scheda): si ferma solo con "Annulla" o quando finisce.
      const s = await get('/api/mcp/ask-status?id=' + encodeURIComponent(id));
      stat.textContent = s.state === 'running' ? 'Claude sta lavorando con gli strumenti del server… ' + s.elapsed + ' s' : '';
      const sg = s.log.length + ':' + s.live.length;
      if (sg !== sig) {
        sig = sg; const near = term.scrollHeight - term.scrollTop - term.clientHeight < 40;
        term.replaceChildren();
        for (const l of s.log) { term.append(mk('span', l.startsWith('▶') ? 'tc' : (l.startsWith('  ←') || l.startsWith('  ✗') ? 'tr' : 'tt'), l), document.createTextNode('\n')); }
        if (s.live) term.append(document.createTextNode(s.live));
        term.append(cur);
        if (near) term.scrollTop = term.scrollHeight;
      }
      if (s.state === 'done') return { answer: s.answer, log: s.log };
      if (s.state === 'error') throw new Error(s.error || 'Errore sconosciuto.');
      if (s.state === 'cancelled' || cancelled) throw new Error('Richiesta annullata.');
      await new Promise((ok) => setTimeout(ok, 500));
    }
  }
  // s = { name, mode }: mode = livello di autonomia scelto per il server (read | readonly | all).
  function askBox(s, desc, tools) {
    const entries = new Map(); for (const g of desc.groups) for (const e of g.tools) entries.set(e.tool, e);
    const byName = new Map(tools.map((x) => [x.name, x]));
    const mode = s.mode || 'read';
    const usable = tools.filter((x) => !(x.annotations && x.annotations.destructiveHint === true) && (mode !== 'read' || x.risk === 'read'));
    const card = mk('div', 'plan');
    card.append(mk('b', '', 'Descrivi cosa ti serve'));
    const req = mk('textarea'); req.placeholder = 'Scrivi con parole tue cosa vuoi sapere o fare, ad esempio: "mostrami le attività aperte assegnate a me"'; card.append(req);
    const bar = mk('div', 'mbar'); bar.style.marginTop = '0';
    const go = mk('button', 'primary', 'Chiedi a Claude'); go.type = 'button';
    const act = mk('button', '', 'Proponi un\'azione'); act.type = 'button'; act.title = 'Per richieste che modificano dati: Claude propone UNA chiamata e tu la confermi';
    bar.append(go, act); card.append(bar);
    card.append(mk('small', 'hint', 'Chiedi a Claude: usa da solo gli strumenti di questo server (' + usable.length + ' consentiti' + (mode === 'read' ? ', solo quelli di lettura' : mode === 'readonly' ? ', server dichiarato di sola lettura' : ', anche quelli che modificano dati') + ') per rispondere, e vedi i passi in diretta. Proponi un\'azione: Claude sceglie UNA chiamata, compila i campi e aspetta il tuo "Esegui". Entrambe usano un po\' della quota del tuo abbonamento Claude (modello Sonnet, nessun altro strumento oltre a quelli del server).'));
    if (!usable.length) { go.disabled = true; card.append(mk('small', 'hint', 'Claude non può usare da solo nessuno strumento di questo server: scegli un livello di autonomia nella scheda del server ("Credenziali e scheda…"). Puoi comunque usare "Proponi un\'azione".')); }
    const out = mk('div'); card.append(out);
    let curId = null, working = false;
    const lock = (v) => { working = v; go.disabled = v || !usable.length; act.disabled = v; };
    // Segue un lavoro (nuovo, o già in corso sul server) fino alla risposta.
    const follow = async (id) => {
      curId = id;
      try {
        const r = await watchAsk(id, out);
        if (r) {
          out.replaceChildren();
          if (r.log.length) { const d = mk('details'); d.append(mk('summary', 'hint', 'Cosa ha fatto Claude (' + r.log.filter((l) => l.startsWith('▶')).length + ' chiamate agli strumenti)'), mk('pre', '', r.log.join('\n'))); out.append(d); }
          out.append(renderAnswer(r.answer));
        }
      } catch (e) { out.replaceChildren(callout('err', e.message)); }
      lock(false);
    };
    go.onclick = async () => {
      lock(true); out.replaceChildren(mk('small', 'hint', 'Avvio di Claude e del server…'));
      let j;
      try { j = await api('/api/mcp/ask', { server: s.name, request: req.value }); } catch (e) { out.replaceChildren(callout('err', e.message)); lock(false); return; }
      follow(j.id);
    };
    // Dopo un F5, "Ricarica" o un cambio di schermata: se il server ha una richiesta in corso (o appena conclusa) per questo server, ci si riaggancia.
    get('/api/mcp/ask-active?server=' + encodeURIComponent(s.name)).then((a) => {
      if (!a || !a.id) return;
      if (a.request) req.value = a.request;
      lock(true); out.replaceChildren(mk('small', 'hint', 'Riaggancio alla richiesta in corso…'));
      follow(a.id);
    }).catch(() => { /* nessun lavoro da riagganciare */ });
    act.onclick = async () => {
      lock(true); out.replaceChildren(mk('small', 'hint', 'Claude sta capendo la richiesta… può richiedere fino a un minuto.'));
      try {
        const p = await api('/api/mcp/plan', { server: s.name, request: req.value });
        out.replaceChildren();
        if (!p.tool) { out.append(callout('warn', p.message)); }
        else {
          const tool = byName.get(p.tool), entry = entries.get(p.tool) || {};
          const rk = RISK[p.risk] || RISK.write;
          const box = mk('div', 'callout ok'); box.style.whiteSpace = 'normal';
          const t = mk('b', '', 'Claude propone: ' + (entry.label || tool.name) + ' '); t.append(mk('span', 'chip ' + rk[0], rk[1])); box.append(t);
          if (p.why) box.append(mk('div', '', p.why));
          for (const [k, v] of Object.entries(p.args)) { const row = mk('div'); row.append(mk('b', '', (((entry.fields || {})[k] || {}).label || k) + ': '), document.createTextNode(typeof v === 'object' ? JSON.stringify(v) : String(v))); box.append(row); }
          out.append(box);
          const res = mk('div'); const b2 = mk('div', 'mbar'); const ex = mk('button', 'primary', 'Esegui'); ex.type = 'button'; const no = mk('button', '', 'Annulla'); no.type = 'button'; b2.append(ex, no); out.append(b2, res);
          ex.onclick = () => runTool(s, entry, tool, p.args, res, ex);
          no.onclick = () => out.replaceChildren();
        }
      } catch (e) { out.replaceChildren(callout('err', e.message)); }
      lock(false);
    };
    card.isBusy = () => working;
    card.discard = async () => { if (curId) { try { await api('/api/mcp/ask-cancel', { id: curId }); } catch { /* già finito */ } curId = null; } };
    return card;
  }

  // s = { name }, desc = descrittore della scheda, tools = elenco dei tool letti dal server.
  function panelView(s, desc, tools) {
    injectCss();
    const wrap = mk('div', 'mcpv');
    const showHidden = { v: false };
    const body = mk('div');
    const draw = () => {
      body.replaceChildren();
      const byName = new Map((tools || []).map((t) => [t.name, t]));
      for (const g of desc.groups) {
        const list = g.tools.filter((e) => byName.has(e.tool) && (showHidden.v || !e.hidden));
        if (!list.length) continue;
        const d = mk('details', 'grp'); d.open = true; d.append(mk('summary', '', g.title + ' (' + list.length + ')'));
        list.forEach((e) => d.append(toolCard(s, e, byName.get(e.tool))));
        body.append(d);
      }
      if (!body.childNodes.length) body.append(mk('div', 'empty', 'Nessuno strumento da mostrare.'));
    };
    const head = mk('div', 'mbar'); head.style.marginTop = '0';
    head.append(mk('span', 'chip ' + (desc.source === 'claude' ? 'ok' : ''), desc.source === 'claude' ? 'scritta da Claude' : (desc.source === 'auto' ? 'automatica' : 'manuale')));
    const hid = desc.groups.some((g) => g.tools.some((e) => e.hidden));
    if (hid) { const l = mk('label'); l.style.cssText = 'display:flex;gap:6px;align-items:center;font-size:12.5px'; const c = mk('input'); c.type = 'checkbox'; c.style.width = 'auto'; c.onchange = () => { showHidden.v = c.checked; draw(); }; l.append(c, 'Mostra anche gli strumenti tecnici'); head.append(l); }
    const ask = tools && tools.length ? askBox(s, desc, tools) : null;
    const clean = mk('button', 'sm', 'Pulisci'); clean.type = 'button'; clean.style.marginLeft = 'auto';
    clean.title = 'Svuota la richiesta, la risposta e i risultati di questa scheda';
    clean.onclick = async () => {
      if (ask && ask.isBusy() && !window.confirm('Claude sta ancora lavorando: pulendo la pagina la richiesta viene annullata.\n\nContinuare?')) return;
      if (ask) await ask.discard();
      wrap.replaceWith(panelView(s, desc, tools));
    };
    head.append(clean);
    wrap.append(head);
    if (ask) wrap.append(ask);
    if (desc.description) wrap.append(mk('p', 'sub', desc.description));
    wrap.append(body); draw();
    return wrap;
  }

  window.NXMcpView = { panelView };
})();
