// Profili e permessi: ogni rotta richiede un permesso del profilo (licenza).

// La prima regola che corrisponde vince; ciò che non è elencato è leggibile da tutti (GET) o riservato all'Administrator (POST e altro):
// così una funzione nuova nasce chiusa. Un test (test/unit/caps-test.js) blocca ogni cambiamento involontario.
const CAP_RULES = [
  ['*', /^\/api\/(license|license\/import|steps|events|shutdown)$/, null],
  ['*', /^\/api\/claude\//, null],
  ['GET', /^\/api\/demo$/, null],
  ['POST', /^\/api\/demo$/, 'demo'],
  ['POST', /^\/api\/(start|send|allow|stop|btw)$/, 'run'],
  ['POST', /^\/api\/(pipeline\/preview|tests\/existing|jira\/search|jira\/issue)$/, 'view'],
  ['GET', /^\/api\/jira\/(state|verify)$/, 'view'],
  ['POST', /^\/api\/ide\/open$/, 'ide.open'],
  ['POST', /^\/api\/git\/push$/, 'git.push'],
  ['POST', /^\/api\/git\//, 'git.write'],
  ['POST', /^\/api\/config\//, 'config.edit'],
  ['POST', /^\/api\/pipelines\//, 'config.edit'], // l'editor modifica .claude/ del progetto: come la configurazione
  ['POST', /^\/api\/mcp\/(env|mode|panel\/(draft|auto|save|delete))$/, 'config.edit'], // credenziali e schede dei server MCP: come la configurazione
  ['POST', /^\/api\/mcp\/(tools|call|stop|plan|ask|ask-cancel)$/, 'run'], // avviano il server MCP del progetto e ne chiamano i tool
  ['POST', /^\/api\/tools\/add$/, 'config.edit'], // modifica il progetto (.mcp.json, .claude): come la configurazione, solo Administrator
  ['*', /^\/api\/jira\//, 'jira.connect'],
  ['GET', /^\/api\/(project|project\/inspect|project\/pipeline|repos\/sources|git\/status|config|diagnostics)$/, 'view'],
  ['*', /^\/api\/(project|repos|m2)\//, 'project.select'], // la creazione di un NUOVO progetto è controllata nel gestore (project.create)
];
function capFor(method, url) {
  const u = url.split('?')[0];
  if (!u.startsWith('/api/')) return null; // pagina e file statici
  for (const [m, re, cap] of CAP_RULES) if ((m === '*' || m === method) && re.test(u)) return cap;
  return method === 'GET' ? 'view' : 'admin';
}
function denyMessage(st, cap) {
  if (!st.licensed && st.configured) return 'Nessuna licenza valida: sono disponibili solo le funzioni Demo. ' + (st.message || '') + ' Importa la licenza dalla scheda Licenza.';
  const what = { run: 'di lanciare la pipeline', 'git.write': 'di modificare il repository (commit, branch, merge)', 'git.push': 'di pubblicare le modifiche', 'project.select': 'di cambiare il progetto', 'jira.connect': 'di collegare Jira', 'config.edit': 'di modificare la configurazione', 'ide.open': 'di aprire i file in IntelliJ', demo: 'la modalità Demo' }[cap];
  return 'Il tuo profilo (' + st.roleLabel + ') non consente ' + (what || 'questa operazione') + '.';
}

module.exports = { CAP_RULES, capFor, denyMessage };
