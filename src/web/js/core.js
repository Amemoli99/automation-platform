const $ = (id) => document.getElementById(id);
const log = $('log');
const PERM_MODE = 'acceptEdits'; // fisso: i comandi passano dalle regole dei permessi, il resto viene fermato e chiesto
const DESC = {
  profile: 'Legge project-profile.md', branch: 'Crea o seleziona il branch', fetch: 'Recupera il ticket',
  analyzer: 'Scenario e mappa Reuse/Gap', explorer: "Naviga l'app dal vivo", coder: 'Scrive page, actions, test',
  compile: 'Compila il progetto', validator: 'Review sul contratto', run: 'Esegue il test',
};
let STEPS = [], DEFAULT_STEPS = [], lastStatus = 'idle', lastSteps = {}, evtSrc = null, projOk = false;
const proj = { info: null, insp: null }; // progetto agganciato e suo stato (usato anche dall'avvio)
const btw = { open: false, busy: false, items: [] }; // Ask Claude: pannello e domande (solo in memoria, mai rimandate come contesto)

/* ---------- helper DOM locale (disponibile da subito) ---------- */
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const clock = () => new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

/* ---------- markdown sicuro: si esegue l'escape PRIMA di generare i tag ---------- */
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}
const isSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
const codebox = (lang, code) => '<div class="codebox"><div class="ch"><span>' + esc(lang || 'codice') + '</span><button type="button" class="cp">Copia</button></div><pre>' + esc(code) + '</pre></div>';
const mdTable = (head, rows) => '<div class="tw"><table class="mdt"><thead><tr>' + head.map((c) => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>' +
  rows.map((r) => '<tr>' + r.map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
function md(src) {
  const lines = String(src).split('\n');
  let html = '', list = null, i = 0, m;
  const close = () => { if (list) { html += '</' + list + '>'; list = null; } };
  while (i < lines.length) {
    const raw = lines[i];
    if ((m = raw.match(/^```\s*([\w+#.-]*)/))) { close(); const code = []; i++; while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]); i++; html += codebox(m[1], code.join('\n')); continue; }
    if (!raw.trim()) { i++; continue; }
    if (raw.trim().startsWith('|') && i + 1 < lines.length && isSep(lines[i + 1])) {
      close(); const head = cells(raw); i += 2; const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(cells(lines[i++]));
      html += mdTable(head, rows); continue;
    }
    if (/^\s*>/.test(raw)) { close(); const q = []; while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, '')); html += '<blockquote>' + md(q.join('\n')) + '</blockquote>'; continue; }
    if (/^\s*([-*_])\1{2,}\s*$/.test(raw)) { close(); html += '<hr>'; i++; continue; }
    if ((m = raw.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== 'ol') { close(); html += '<ol>'; list = 'ol'; } html += '<li>' + inline(m[1]) + '</li>'; i++; continue; }
    if ((m = raw.match(/^\s*[-*]\s+(.*)/))) { if (list !== 'ul') { close(); html += '<ul>'; list = 'ul'; } html += '<li>' + inline(m[1]) + '</li>'; i++; continue; }
    close();
    if ((m = raw.match(/^(#{1,4})\s+(.*)/))) { const h = m[1].length <= 2 ? 'h3' : 'h4'; html += '<' + h + '>' + inline(m[2]) + '</' + h + '>'; i++; continue; }
    html += '<p>' + inline(raw) + '</p>'; i++;
  }
  close();
  return html;
}

