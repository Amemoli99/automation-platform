/* ---------- sezioni comprimibili ---------- */
// Ogni sezione "card sec" delle schede ha una freccia; lo stato (aperta/chiusa) si ricorda per sezione. Il contenuto non viene toccato:
// una sezione chiusa nasconde solo ciò che segue l'intestazione, quindi gli elementi e il codice che li usa restano gli stessi.
const SEC_VIEWS = ['view-config', 'view-git', 'view-tools', 'view-license', 'view-jira', 'view-project'];
// Chiuse alla prima visita: le sezioni secondarie. Quelle che mostrano stato o esito di un'azione restano aperte.
const SEC_CLOSED = new Set(['Permessi', 'Parametri di esecuzione', 'Profilo progetto', 'Cambia branch', 'Nuovo branch', 'Unisci (merge)', 'Skill', 'Agent', 'Hook e script', 'Aggiungi al progetto', 'Cerca altri server MCP', 'Cosa puoi fare', 'Attivazione', "Informazioni sull'applicazione"]);
const SEC_KEY = 'nx.sections';
const secLoad = () => { try { return JSON.parse(localStorage.getItem(SEC_KEY) || '{}') || {}; } catch { return {}; } };
const secSave = (m) => { try { localStorage.setItem(SEC_KEY, JSON.stringify(m)); } catch { /* storage non disponibile: lo stato non viene ricordato */ } };
function secSet(sec, open, persist) {
  if (!sec || !sec.classList.contains('sec-collapsible')) return;
  sec.classList.toggle('collapsed', !open);
  const b = sec.querySelector(':scope > .sec-head > .sec-toggle'); if (b) b.setAttribute('aria-expanded', String(open));
  if (persist !== false && sec.dataset.secKey) { const m = secLoad(); m[sec.dataset.secKey] = open ? 1 : 0; secSave(m); }
}
function initSections() {
  const saved = secLoad();
  const chevron = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
  for (const vid of SEC_VIEWS) {
    const view = $(vid); if (!view) continue;
    const seen = {};
    const secs = [...view.querySelectorAll('section.card.sec')].filter((x) => x.id !== 'proj-wiz' && x.querySelector(':scope > .sec-head h3'));
    for (const sec of secs) {
      const head = sec.querySelector(':scope > .sec-head'), h3 = head.querySelector('h3');
      const title = (h3.childNodes[0] ? h3.childNodes[0].textContent : h3.textContent).trim();
      seen[title] = (seen[title] || 0) + 1;
      sec.dataset.secKey = vid + '|' + title + (seen[title] > 1 ? '#' + seen[title] : '');
      sec.classList.add('sec-collapsible');
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'sec-toggle'; btn.innerHTML = chevron;
      btn.setAttribute('aria-label', 'Apri o chiudi la sezione ' + title); btn.title = 'Apri o chiudi';
      head.prepend(btn);
      const open = sec.dataset.secKey in saved ? !!saved[sec.dataset.secKey] : !SEC_CLOSED.has(title);
      secSet(sec, open, false);
      head.addEventListener('click', (ev) => {
        if (ev.target.closest('.actions')) { if (sec.classList.contains('collapsed')) secSet(sec, true); return; } // un'azione della sezione la apre per mostrarne l'esito
        if (ev.target.closest('a, input, select, textarea, label') || (ev.target.closest('button') && !ev.target.closest('.sec-toggle'))) return;
        secSet(sec, sec.classList.contains('collapsed'));
      });
    }
    if (secs.length > 1) {
      const bar = document.createElement('div'); bar.className = 'sec-tools';
      for (const [label, open] of [['Espandi tutto', true], ['Comprimi tutto', false]]) {
        const b = document.createElement('button'); b.type = 'button'; b.textContent = label;
        b.onclick = () => secs.forEach((x) => secSet(x, open));
        bar.append(b);
      }
      const host = view.querySelector('.cfg-inner') || view;
      const intro = host.querySelector(':scope > .cfg-intro');
      if (intro) intro.after(bar); else host.prepend(bar);
    }
  }
}
initSections();

/* ---------- versione dell'applicazione ---------- */
// Da /api/version: etichetta nella barra laterale (tooltip con build e data) e riquadro "Informazioni" nella scheda Licenza.
async function loadAppInfo() {
  try {
    const a = await call('/api/version');
    const label = 'v' + a.version + (a.edition ? ' · ' + a.edition : '');
    const built = a.builtAt ? new Date(a.builtAt).toLocaleString('it-IT') : '';
    const v = $('app-ver'); v.textContent = label; v.title = 'Build ' + a.build + (built ? ' · ultima modifica ' + built : ''); v.hidden = false;
    $('about-chip').replaceChildren(mk('span', 'chip', label));
    const rows = [['Versione', a.version], ['Edizione', a.edition || 'Ufficiale'], ['Build', a.build + ' (impronta dei file dell\'applicazione)'], ['Ultima modifica ai file', built || '—'], ['Node.js', a.node], ['Sistema', a.platform]];
    $('about-grid').replaceChildren(...rows.flatMap(([k, val]) => { const dt = mk('dt', '', k), dd = mk('dd', '', String(val)); return [dt, dd]; }));
  } catch { /* la versione è solo informativa */ }
}
loadAppInfo();

/* ---------- esporta il report di diagnostica ---------- */
// Scarica un file Markdown con versione, strumenti, progetto e tool (nessun token né credenziale: lo garantisce il server, vedi report.js).
$('diag-export').onclick = async () => {
  const b = $('diag-export'), old = b.textContent;
  b.disabled = true; b.textContent = 'Preparo il report…';
  try {
    const r = await fetch('/api/diagnostics/export', { credentials: 'same-origin' });
    if (!r.ok) { let m = 'Errore ' + r.status; try { m = (await r.json()).error || m; } catch { /* corpo non JSON */ } throw new Error(m); }
    const blob = await r.blob();
    const name = (/filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') || '') || [])[1] || 'nacp-diagnostica.md';
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('Report salvato: ' + name + ' (nella cartella Download). Non contiene token né credenziali.');
  } catch (e) { toast(e.message, true); }
  finally { b.disabled = false; b.textContent = old; }
};

/* ---------- tab ---------- */
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage non disponibile */ } },
};
let toastTimer;
// Finestra di conferma dell'app (al posto del confirm() del browser). Ritorna una Promise<boolean>.
// Esc o clic fuori = annulla. opts: title, ok, cancel, danger.
function askConfirm(message, opts = {}) {
  return new Promise((resolve) => {
    const prev = document.activeElement;
    const back = mk('div', 'modal-back');
    const box = mk('div', 'modal'); box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
    const body = mk('div', 'mbody', message);
    const no = mk('button', '', opts.cancel || 'Annulla'); no.type = 'button';
    const yes = mk('button', opts.danger ? 'danger' : 'primary', opts.ok || 'Conferma'); yes.type = 'button';
    const foot = mk('div', 'mfoot'); foot.append(no, yes);
    box.append(mk('h4', '', opts.title || 'Conferma'), body, foot);
    back.append(box);
    const done = (v) => { document.removeEventListener('keydown', onKey, true); back.remove(); if (prev && prev.focus) { try { prev.focus(); } catch { /* elemento rimosso */ } } resolve(v); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
      else if (e.key === 'Tab') { e.preventDefault(); (document.activeElement === yes ? no : yes).focus(); } // il focus resta nella finestra
    };
    document.addEventListener('keydown', onKey, true);
    back.onmousedown = (e) => { if (e.target === back) done(false); };
    no.onclick = () => done(false); yes.onclick = () => done(true);
    document.body.append(back);
    (opts.danger ? no : yes).focus(); // nelle azioni distruttive Invio non conferma per sbaglio
  });
}

function toast(msg, err) {
  const t = $('toast');
  t.textContent = msg; t.className = err ? 'err' : ''; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
}
async function call(path, body) {
  const r = await fetch(path, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let j = {};
  try { j = await r.json(); } catch { /* corpo non JSON */ }
  if (!r.ok) throw new Error(j.error || (r.status === 404 ? 'Funzione non disponibile: il server della UI non conosce questa richiesta. Chiudi la UI e riaprila per caricare l\'ultima versione.' : 'Errore ' + r.status));
  return j;
}
const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

let cfgLoaded = false;

/* ---------- indicatore di caricamento (riusabile) ---------- */
// Logo Nexsoft che lampeggia + messaggio + secondi trascorsi. Il contatore si ferma da solo quando l'elemento viene tolto dalla pagina.
function nxLoader(title, hint) {
  const box = mk('div', 'nx-loading'); box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite');
  const logo = mk('div', 'nx-logo'); const img = mk('img'); img.src = 'logo_nexsoft_squared-min.webp'; img.alt = ''; logo.append(img);
  const t = mk('div', 'nx-t'); const sub = mk('small', '', hint || '0 s'); t.append(mk('b', '', title), sub);
  box.append(logo, t);
  const t0 = Date.now();
  const iv = setInterval(() => {
    const s = Math.floor((Date.now() - t0) / 1000);
    if (!box.isConnected && s >= 1) { clearInterval(iv); return; }
    sub.textContent = (hint ? hint + ' · ' : '') + s + ' s';
  }, 1000);
  return box;
}

