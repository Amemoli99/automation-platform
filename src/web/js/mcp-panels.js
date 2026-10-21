/* ---------- schede dei server MCP: una voce nel menu laterale per ogni scheda salvata ---------- */
const MCPV = { key: null, servers: [], tools: {}, views: {}, cur: null };
const MCP_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3v4M15 3v4M7 7h10v4a5 5 0 0 1-10 0V7zM12 16v5"/></svg>';
async function refreshMcpNav() {
  let list = [];
  try { list = (await call('/api/mcp/servers')).servers.filter((s) => s.hasPanel && s.supported); } catch { list = []; }
  MCPV.servers = list;
  const key = list.map((s) => s.name + ':' + (s.mode || 'read')).join('|');
  if (key === MCPV.key) return;
  MCPV.key = key; MCPV.tools = {}; MCPV.views = {};
  document.querySelectorAll('nav button.mcpnav').forEach((x) => x.remove());
  let prev = document.querySelector('nav button[data-tab="tools"]');
  for (const s of list) {
    const b = mk('button', 'mcpnav' + (curTab === 'mcp:' + s.name ? ' active' : '')); b.type = 'button'; b.dataset.tab = 'mcp:' + s.name; b.title = 'Scheda ' + s.name;
    b.insertAdjacentHTML('afterbegin', MCP_ICON); b.append(mk('span', 'lbl', s.name), mk('i', 'ndot'));
    bindNav(b); prev.after(b); prev = b;
  }
  if (curTab.startsWith('mcp:') && !list.some((s) => 'mcp:' + s.name === curTab)) gotoTab('tools');
}
async function showMcp(name, reload) {
  // La schermata di ogni scheda si conserva: tornandoci si ritrova com'era, anche con una richiesta a Claude ancora in corso.
  MCPV.cur = name;
  const box = $('mcp-card');
  if (reload) delete MCPV.views[name];
  if (MCPV.views[name]) { box.replaceChildren(MCPV.views[name]); return; }
  const view = mk('div'); MCPV.views[name] = view; box.replaceChildren(view);
  const head = mk('div', 'sec-head'); const ttl = mk('div'); ttl.append(mk('h3', '', name), mk('p', '', 'Scheda del server MCP. Gli strumenti che possono modificare dati chiedono sempre conferma.'));
  const acts = mk('div', 'row'); acts.style.cssText = 'margin-left:auto;flex:none';
  const re = mk('button', '', 'Ricarica'); re.type = 'button'; re.title = 'Rilegge strumenti e impostazioni (una richiesta in corso non viene interrotta, ma la sua schermata viene sostituita)'; re.onclick = () => { delete MCPV.tools[name]; showMcp(name, true); };
  const ed = mk('button', '', 'Credenziali e scheda…'); ed.type = 'button'; ed.title = 'Si apre in una nuova scheda del browser'; ed.onclick = () => window.open('/mcp.html?server=' + encodeURIComponent(name), 'nx-mcp');
  acts.append(re, ed); head.append(ttl, acts); view.append(head);
  const body = mk('div'); view.append(body);
  if (!MCPV.tools[name]) body.append(nxLoader('Avvio di ' + name + '…', 'La prima volta il server può scaricare il suo pacchetto'));
  try {
    const sv = (await call('/api/mcp/servers')).servers.find((x) => x.name === name) || {}; // livello di autonomia aggiornato (si cambia in mcp.html)
    const t = MCPV.tools[name] || (MCPV.tools[name] = (await call('/api/mcp/tools', { server: name })).tools);
    const d = (await call('/api/mcp/panel?server=' + encodeURIComponent(name))).descriptor;
    if (!d) { delete MCPV.views[name]; body.replaceChildren(mk('div', 'callout warn', 'La scheda non esiste più. Creala di nuovo da "Credenziali e scheda…".')); return; }
    body.replaceChildren(window.NXMcpView.panelView({ name, mode: sv.mode }, d, t));
  } catch (e) {
    delete MCPV.tools[name]; delete MCPV.views[name]; // al prossimo ingresso si riprova
    body.replaceChildren(mk('div', 'callout err', e.message + '\n\nSe mancano le credenziali impostale da "Credenziali e scheda…", poi premi Ricarica.'));
  }
}
window.addEventListener('focus', () => { refreshMcpNav(); }); // tornando dalla scheda di creazione compaiono subito le schede nuove (o spariscono quelle eliminate)

