'use strict';
// Modalità Demo: un progetto di prova in una cartella temporanea + Jira simulato + Claude simulato (demo/sim.js).
// Nulla di reale viene toccato: niente rete, niente credenziali, niente file del progetto vero.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SIM = path.join(__dirname, 'demo', 'sim.js');
const PROJECT_NAME = 'Demo Portal';
const ORIGIN = 'https://demo.atlassian.net';
const BLOCKED = new Set([
  '/api/project/activate', '/api/project/create', '/api/project/pick-folder', '/api/project/pipeline',
  '/api/repos/clone', '/api/repos/sources', '/api/ide/open',
]);

/* ---------- ticket simulati ---------- */
const TEMPLATES = [
  ['Login con credenziali valide', 'Verificare che un utente registrato acceda al portale e veda la propria area personale.', ['Aprire la pagina di login', 'Inserire utente e password validi', 'Premere Accedi'], 'Compare la home con il nome dell\'utente.'],
  ['Login con password errata', 'Verificare il messaggio di errore quando la password non è corretta.', ['Aprire la pagina di login', 'Inserire utente valido e password errata', 'Premere Accedi'], 'Resta sulla pagina di login e compare "Credenziali non valide".'],
  ['Creazione di una prenotazione', 'Prenotare due postazioni nella stanza Brontolo dal portale.', ['Accedere al portale', 'Aprire Prenotazioni → Crea', 'Scegliere la stanza Brontolo e due postazioni', 'Confermare'], 'La prenotazione compare nell\'elenco con stato Confermata.'],
  ['Cancellazione di una prenotazione', 'Cancellare una prenotazione esistente dall\'elenco.', ['Aprire l\'elenco delle prenotazioni', 'Selezionare la prima prenotazione', 'Premere Cancella e confermare'], 'La prenotazione sparisce dall\'elenco.'],
  ['Filtro elenco prenotazioni per data', 'Filtrare l\'elenco per intervallo di date.', ['Aprire l\'elenco delle prenotazioni', 'Impostare data da e data a', 'Premere Filtra'], 'Sono visibili solo le prenotazioni dell\'intervallo.'],
  ['Modifica dei dati del profilo', 'Aggiornare numero di telefono e lingua del profilo.', ['Aprire Profilo', 'Modificare telefono e lingua', 'Salvare'], 'I nuovi valori sono mostrati dopo il salvataggio.'],
  ['Esportazione elenco in CSV', 'Esportare l\'elenco delle prenotazioni in un file CSV.', ['Aprire l\'elenco', 'Premere Esporta CSV'], 'Viene scaricato un file con tutte le righe visibili.'],
  ['Ricerca di una stanza per capienza', 'Cercare le stanze con almeno 6 posti.', ['Aprire Stanze', 'Impostare capienza minima 6', 'Premere Cerca'], 'Compaiono solo stanze con 6 o più posti.'],
  ['Notifica di conferma prenotazione', 'Controllare che dopo la prenotazione compaia la notifica di conferma.', ['Creare una prenotazione', 'Osservare la notifica in alto'], 'La notifica "Prenotata!" è visibile per qualche secondo.'],
  ['Logout dal portale', 'Uscire dal portale e verificare che le pagine protette non siano raggiungibili.', ['Premere Esci', 'Tornare indietro con il browser'], 'Si viene riportati alla pagina di login.'],
  ['Recupero password', 'Richiedere il link di recupero password.', ['Aprire Password dimenticata', 'Inserire l\'email', 'Inviare'], 'Compare il messaggio "Ti abbiamo inviato un\'email".'],
  ['Cambio lingua dell\'interfaccia', 'Passare da italiano a inglese e controllare le etichette del menu.', ['Aprire il selettore lingua', 'Scegliere English'], 'Le voci del menu sono in inglese.'],
  ['Paginazione dell\'elenco prenotazioni', 'Navigare tra le pagine di un elenco lungo.', ['Aprire l\'elenco con più di 20 righe', 'Premere pagina 2'], 'Si vedono le righe dalla 21 in poi.'],
];
const STATES = [['To Do', 'new'], ['In Progress', 'indeterminate'], ['Done', 'done']];
const PEOPLE = ['', 'Mario Rossi', 'Anna Verdi', 'Luca Bianchi'];
const PRIOS = ['High', 'Medium', 'Low'];

function dataset() {
  const now = Date.now();
  return Array.from({ length: 26 }, (_, n) => {
    const tp = TEMPLATES[n % TEMPLATES.length];
    const st = STATES[n % 3];
    return {
      key: 'DEMO-' + (101 + n),
      summary: tp[0] + (n >= TEMPLATES.length ? ' (variante ' + (Math.floor(n / TEMPLATES.length) + 1) + ')' : ''),
      type: n % 5 === 4 ? 'Task' : 'Test',
      status: st[0], statusCategory: st[1],
      priority: PRIOS[n % 3], assignee: PEOPLE[n % 4],
      updated: new Date(now - n * 3.1 * 3600 * 1000).toISOString(),
      url: ORIGIN + '/browse/DEMO-' + (101 + n),
      tp,
    };
  });
}
const QUERIES = [
  { id: 'demo-test', name: 'Test da automatizzare (demo)', jql: 'project = DEMO AND issuetype = Test ORDER BY updated DESC', projects: ['DEMO'], types: ['Test'], statuses: [], dashboardUrl: '', filterId: '', sprint: '', boardName: '', createdAt: new Date().toISOString() },
  { id: 'demo-open', name: 'Tutti i ticket aperti (demo)', jql: 'project = DEMO AND statusCategory != Done ORDER BY updated DESC', projects: ['DEMO'], types: [], statuses: [], dashboardUrl: '', filterId: '', sprint: '', boardName: '', createdAt: new Date().toISOString() },
];

function patchJira(jira) {
  const orig = {};
  const set = (name, fn) => { orig[name] = jira[name]; jira[name] = fn; };
  const no = () => { throw new Error('Non disponibile in modalità Demo: i dati di Jira sono simulati.'); };
  const pub = (t) => { const { tp, ...x } = t; return x; };
  set('publicState', () => ({ configured: true, linked: true, source: 'local', target: '', baseUrl: ORIGIN, email: 'demo@nexsoft.it', displayName: 'Utente Demo', queries: QUERIES }));
  set('verifyConnection', async () => ({ configured: true, ok: true, displayName: 'Utente Demo' }));
  set('autoConnect', async () => ({ used: false }));
  // In Demo la connessione a Jira è simulata e sempre attiva: il controllo "collegato?" non deve bloccare le chiamate finte.
  set('requireLinked', () => {});
  set('link', () => jira.publicState());
  set('unlink', no);
  set('getQuery', (id) => { const q = QUERIES.find((x) => x.id === String(id)); if (!q) throw new Error('Query non trovata.'); return q; });
  set('search', async ({ jql, nextPage, max }) => {
    const open = /statusCategory\s*!=\s*Done/i.test(jql || '');
    const tests = /issuetype\s*=\s*Test/i.test(jql || '');
    const all = dataset().filter((t) => (open ? t.statusCategory !== 'done' : true) && (tests ? t.type === 'Test' : true));
    const off = /^s:\d+$/.test(nextPage || '') ? Number(nextPage.slice(2)) : 0;
    const size = Math.min(100, Math.max(1, Number(max) || 50));
    const page = all.slice(off, off + size);
    return { issues: page.map(pub), nextPage: off + page.length < all.length ? 's:' + (off + page.length) : null, total: all.length, jql: jql || '' };
  });
  set('issueDetail', async (key) => {
    const t = dataset().find((x) => x.key === String(key).toUpperCase());
    if (!t) throw new Error('Ticket non trovato nella demo.');
    const [, obj, steps, esito] = t.tp;
    const description = ['Obiettivo', obj, '', 'Passi', ...steps.map((s, i) => (i + 1) + '. ' + s), '', 'Esito atteso', esito].join('\n');
    return { ...pub(t), description, reporter: 'Anna Verdi', labels: ['regression', 'portale'], components: ['Prenotazioni'], created: t.updated, attachments: [] };
  });
  for (const n of ['saveConfig', 'removeConfig', 'useWindowsCredential', 'saveQuery', 'deleteQuery', 'analyzeDashboard', 'analyzeSource', 'projectMeta']) set(n, no);
  return () => { for (const [k, v] of Object.entries(orig)) jira[k] = v; };
}

/* ---------- progetto di prova ---------- */
const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=Demo', '-c', 'user.email=demo@nexsoft.it', ...a], { cwd, stdio: 'ignore', windowsHide: true });

function makeProject(projects) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'developerTest-demo-'));
  const dir = path.join(base, PROJECT_NAME);
  fs.mkdirSync(path.join(dir, 'src', 'test', 'java', 'demo'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'pom.xml'), '<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><groupId>demo</groupId><artifactId>demo-portal</artifactId><version>1.0</version></project>\n');
  fs.writeFileSync(path.join(dir, 'src', 'test', 'java', 'demo', 'DEMO_103.java'), '// Test di esempio già presente nel progetto demo\npublic class DEMO_103 {}\n');
  try {
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'Progetto demo');
    projects.configureExisting({ dir, prefs: {}, addKit: true });
    git(dir, 'checkout', '-q', '-b', 'feature/demo');
    git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'Pipeline di Aletheia');
  } catch { /* senza git la demo funziona lo stesso: la scheda Git mostrerà "non è un repository" */ }
  return { base, dir };
}

function create({ projects, jira }) {
  const made = makeProject(projects);
  const restore = patchJira(jira);
  return { dir: made.dir, base: made.base, restore };
}
function cleanup(base) { try { fs.rmSync(base, { recursive: true, force: true }); } catch { /* cartella temporanea: il sistema la ripulisce */ } }

module.exports = { SIM, BLOCKED, create, cleanup };
