// Creazione e configurazione di progetti automation su Aletheia (Playwright), pensata per la UI.
// Genera i file da template (nessun LLM), mai sovrascrive file esistenti, mai logga segreti.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { exec } = require('child_process');

const KIT = require('./infra/paths').KIT_DIR; // radice dello strumento (developerTest-UI), non un progetto
const KIT_CLAUDE = path.join(KIT, 'kit', '.claude'); // agent e skill da copiare nei progetti: fonte unica
const TPL = require('./infra/paths').uiFile('templates');
const config = require('./config');
const PRESET = config.PRESET;
// Sorgente locale del common Aletheia (sola lettura), se presente nella posizione abituale.
const COMMON_SRC = (() => { const p = path.join(os.homedir(), 'IdeaProjects', 'Nexsoft', 'commonAletheia'); return fs.existsSync(p) ? p : null; })();

/* ---------- validazione ---------- */
function derive(p) {
  const name = String(p.name || '').trim();
  if (!/^[A-Za-z][A-Za-z0-9 _-]{1,40}$/.test(name)) throw new Error('Nome progetto non valido: 2-41 caratteri, deve iniziare con una lettera (lettere, numeri, spazio, - e _).');
  const parts = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const slug = parts.join('').toLowerCase();
  const pascal = parts.map((s) => s[0].toUpperCase() + s.slice(1)).join('');
  return { name, slug, pascal, artifactId: parts.join('-').toLowerCase(), pkg: 'com.nexsoft.automation.' + slug, pkgPath: ('com/nexsoft/automation/' + slug) };
}

function validEnvs(envs) {
  if (!Array.isArray(envs) || !envs.length) throw new Error('Inserisci almeno un ambiente (nome e URL).');
  if (envs.length > 10) throw new Error('Massimo 10 ambienti.');
  const seen = new Set();
  return envs.map((e) => {
    const n = String(e.name || '').trim();
    const u = String(e.url || '').trim();
    if (!/^[A-Za-z0-9_-]{1,30}$/.test(n)) throw new Error(`Nome ambiente non valido: "${n}" (lettere, numeri, - e _).`);
    if (seen.has(n.toLowerCase())) throw new Error(`Ambiente duplicato: ${n}`);
    seen.add(n.toLowerCase());
    if (!/^https?:\/\/[^\s"`\\]+$/.test(u)) throw new Error(`URL non valido per ${n}: deve iniziare con http:// o https://`);
    return { name: n, url: u };
  });
}

function validDir(dir, { mustBeEmptyOrMissing }) {
  const d = String(dir || '').trim().replace(/^["']+|["']+$/g, ''); // "Copia come percorso" di Windows aggiunge le virgolette
  if (!path.isAbsolute(d)) throw new Error('Indica un percorso completo (es. C:\\Users\\nome\\IdeaProjects\\progetto).');
  if (d.split(/[\\/]/).includes('..')) throw new Error('Percorso non valido.');
  const full = path.resolve(d);
  if (path.dirname(full) === full) throw new Error('Non puoi usare la radice di un disco.');
  if (!/^[\w.\- ()\\/:À-ÿ]+$/.test(full)) throw new Error('Il percorso contiene caratteri non supportati.');
  if (!fs.existsSync(path.dirname(full))) throw new Error('La cartella superiore non esiste: ' + path.dirname(full));
  if (mustBeEmptyOrMissing && fs.existsSync(full)) {
    if (!fs.statSync(full).isDirectory()) throw new Error('Il percorso esiste ed è un file.');
    if (fs.readdirSync(full).length) throw new Error('La cartella esiste e non è vuota: scegli un nome nuovo oppure usa "Configura progetto esistente".');
  }
  return full;
}

function dotenvValue(v, label) {
  const s = String(v == null ? '' : v);
  if (/["\\\r\n]/.test(s)) throw new Error(`${label}: i caratteri " \\ e a capo non sono supportati nel file .env.`);
  return s;
}

/* ---------- template ---------- */
const render = (s, ctx) => s.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in ctx ? ctx[k] : '{{' + k + '}}'));

const T = {
  gitignore: `.idea
/target/
.DS_Store
.env
output.log
/logs/
/videos/
.tmp/
.claude/settings.local.json
.playwright-mcp/
`,
  envExample: `# Copia in .env (che NON va committato) e compila. Letto da Setup di Aletheia.
APP_USERNAME=
APP_PASSWORD=
`,
  baseTest: `package {{pkg}};

import com.nexsoft.automation.common.playwright.BaseTestPlayWright;

/**
 * Base type for the {{name}} Playwright tests.
 * <p>Subclasses implement {@link #run()} with the test steps.</p>
 */
public abstract class {{pascal}}Test extends BaseTestPlayWright {

    /** Default timeout for all Playwright operations (ms). */
    private static final double DEFAULT_TIMEOUT_MS = 60_000;

    public {{pascal}}Test() {
        page.setDefaultTimeout(DEFAULT_TIMEOUT_MS);
    }
}
`,
  homePage: `package {{pkg}}.page;

import com.microsoft.playwright.Locator;
import com.nexsoft.automation.common.playwright.WebPagePlayWright;

/**
 * Page object of the {{name}} home. Exposes {@link Locator}s only: clicks and typing live in the actions layer.
 */
public class HomePage extends WebPagePlayWright {

    public HomePage() {
        super("Home Page");
    }

    public Locator getBody() {
        return getPage().locator("body");
    }
}
`,
  homeActions: `package {{pkg}}.actions;

import com.microsoft.playwright.assertions.LocatorAssertions;
import com.nexsoft.automation.common.configuration.Setup;
import com.nexsoft.automation.common.playwright.WebActionPlayWright;
import {{pkg}}.page.HomePage;

import static com.microsoft.playwright.assertions.PlaywrightAssertions.assertThat;

/**
 * Business actions on the {{name}} home page.
 */
public class HomeActions extends WebActionPlayWright<HomePage> {

    private static final double TIMEOUT_MEDIUM_MS = 15_000;

    public HomeActions() {
        super(new HomePage());
    }

    /** Opens the application URL of the selected environment (-DEnv) and checks the page is rendered. */
    public HomeActions openHome() {
        page.navigate(Setup.getResourceValue("server.url"));
        assertThat(pageObject.getBody())
                .isVisible(new LocatorAssertions.IsVisibleOptions().setTimeout(TIMEOUT_MEDIUM_MS));
        return this;
    }
}
`,
  smokeTest: `package {{pkg}}.testcases.ui.smoke;

import {{pkg}}.{{pascal}}Test;
import {{pkg}}.actions.HomeActions;

/**
 * <b>SMOKE-1</b> &mdash; Apertura della home dell'applicazione. Test d'esempio: serve a verificare che
 * ambiente, browser e framework siano configurati. Sostituiscilo con i test reali.
 */
public class SMOKE_1 extends {{pascal}}Test {

    @Override
    public void run() {
        reportLogInfo("STEP 1: Open the application home");
        new HomeActions().openHome();
    }
}
`,
  regression: `package {{pkg}}.testcases.ui;

import com.nexsoft.automation.common.listeners.TestListener;
import {{pkg}}.testcases.ui.smoke.SMOKE_1;
import org.testng.annotations.Listeners;
import org.testng.annotations.Test;

/**
 * Entry point TestNG dei test UI di {{name}}: un metodo {@code @Test} per ogni test case,
 * che istanzia il test e ne avvia l'esecuzione tramite il framework.
 */
@Listeners(TestListener.class)
public class {{pascal}}Regression {

    private static final String CATEGORY = "{{name}} - Regression";

    @Test
    public void SMOKE_1() {
        new SMOKE_1().start("SMOKE_1", "Apertura della home dell'applicazione", CATEGORY);
    }
}
`,
  suite: `<!DOCTYPE suite SYSTEM "http://testng.org/testng-1.0.dtd" >

<suite name="{{name}}" verbose="1">
    <test name="Smoke">
        <classes>
            <class name="{{pkg}}.testcases.ui.{{pascal}}Regression">
                <methods>
                    <include name="SMOKE_1"/>
                </methods>
            </class>
        </classes>
    </test>

    <listeners>
        <listener class-name="com.nexsoft.automation.common.listeners.AnnotationTransformer"/>
    </listeners>

</suite>
`,
  env: `# Ambiente {{envName}} di {{name}}. I valori \${VAR} sono letti dal file .env nella root del progetto.
server.url={{url}}
auth.username=\${APP_USERNAME}
auth.password=\${APP_PASSWORD}
`,
  mcp: `{
  "mcpServers": {
    "playwright": {
      "command": "cmd",
      "args": [
        "/c", "npx",
        "@playwright/mcp@latest",
        "--browser", "chromium",
        "--viewport-size", "1920x1080",
        "--isolated"
      ]
    }
  }
}
`,
};

// Profilo precompilato con ciò che il wizard conosce; il resto resta TBD (la pipeline chiede quando serve).
function profileText(ctx) {
  const k = ctx || {};
  const v = (x) => (x == null ? 'TBD' : x);
  return `# Project Profile

Unico file da adattare per portare la pipeline su un nuovo progetto. Skill e agent sono generici e leggono i valori da qui. Le voci \`TBD\` vanno compilate prima del primo uso; se un valore necessario è \`TBD\`, la pipeline si ferma e lo chiede.

## 1. Ticket source (adapter)

- \`ticket_source\`: \`paste\` — uno tra: \`jira\` | \`azure-devops\` | \`file\` | \`paste\`
  - \`jira\` / \`azure-devops\`: richiede \`base_url\`, riferimento alle credenziali (es. file \`.env\`, MAI il valore qui), campo che contiene la descrizione/contratto e eventuale campo di raggruppamento (stream/area).
  - \`file\`: i ticket sono file in una cartella (\`ticket_dir\`).
  - \`paste\`: l'utente incolla il ticket in chat (default).
- \`ticket_id_pattern\`: \`TBD\` (es. \`ABC-123\`)
- \`ticket_contract_field\`: \`description\` (campo che è il contratto)
- \`ticket_group_field\`: \`TBD\` (campo usato per scegliere package/suite, opzionale)
- \`attachments\`: \`sì\` (salvati in \`.tmp/<ticket>/\`)
- \`ticket_transition_on_pass\`: \`no\` (se \`sì\`, stato di destinazione; sempre con conferma utente)

## 2. Build & run

- \`language\`: Java 11
- \`build_tool\`: Maven
- \`compile_cmd\`: \`mvn -q test-compile\`
- \`run_cmd\`: \`mvn test "-DsuiteFile=<suite>.xml" "-DEnv=${v(k.env)}"\` (suite in \`TestSuites/\`; gli apici sono obbligatori in PowerShell, altrimenti il punto spezza l'argomento; senza \`-DEnv\` il common cerca \`Environments/null/resources\`)
- \`test_runner\`: TestNG 6.14.3 (+ AspectJ)
- \`private_repos\`: \`commonAletheia\` (artifact Maven \`automation-common\`) dal repository Maven \`${v(k.repo)}\` — serve autenticazione Maven (\`~/.m2/settings.xml\`)

## 3. Framework e layout test

- \`shared_library\`: \`commonAletheia\`${COMMON_SRC ? ' — sorgente locale \`' + COMMON_SRC + '\`' : ''} (SOLA LETTURA, mai modificare senza permesso)
- \`test_root\`: \`${v(k.pkg && 'src/test/java/' + k.pkgPath + '/testcases')}\`
- \`page_pkg\`: \`${v(k.pkg && k.pkg + '.page')}\`
- \`actions_pkg\`: \`${v(k.pkg && k.pkg + '.actions')}\`
- \`base_class\`: \`${v(k.pkg && k.pkg + '.' + k.pascal + 'Test')}\` (estende \`BaseTestPlayWright\` di Aletheia)
- \`suite_dir\`: \`TestSuites/\`
- \`naming\`: \`${v(k.pkg && 'test: <ID>.java in testcases/ui/<area>/; page: <Nome>Page; actions: <Nome>Actions; un @Test per test in ' + k.pascal + 'Regression')}\`
- \`login_block\`: \`TBD\` (blocco di login, se è sempre la prima istruzione va copiato verbatim)
- \`title_rule\`: titolo test = summary del ticket verbatim (non tradurre, non accorciare)
- \`waits\`: usare le wait del framework, mai \`Thread.sleep\`

## 4. Ambiente ed esplorazione

- \`target_type\`: web
- \`explore_tool\`: Playwright MCP (server \`playwright\` in \`.mcp.json\`)
- \`base_url_source\`: \`src/main/resources/Environments/<Env>/resources.properties\` (\`server.url\`)
- \`credentials_source\`: \`.env\` (\`APP_USERNAME\`, \`APP_PASSWORD\`), referenziate come \`\${VAR}\` in \`resources.properties\` — leggere a runtime, non riportare mai nell'output
- \`environment\`: \`${v(k.env)}\` (solo non produzione)
- \`mutating_actions_allowed\`: no (salva/conferma/elimina/importa solo con conferma utente)
- \`locator_priority\`: id univoco > name/data-testid/aria-label > testo visibile > CSS > XPath

## 5. Git

- \`branching\`: \`TBD\` (sì/no)
- \`base_branch\`: \`main\`
- \`branch_pattern\`: \`TBD\` (es. \`feature/<ticket>\`)
- Mai commit, push o PR senza richiesta esplicita dell'utente.

## 6. Regole di progetto

- Test data: rispettare i valori vincolati dal ticket, mai sostituirli con random. Selezione dinamica solo entro la stessa categoria e solo se il test non vincola il valore.
- Un ticket alla volta.
- \`TBD\`: altre convenzioni del progetto.
`;
}

/* ---------- piano e scrittura ---------- */
function copyDirFiles(src, destRel, out) {
  if (!fs.existsSync(src)) return;
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const rel = destRel + '/' + e.name;
    if (e.isDirectory()) copyDirFiles(s, rel, out);
    else out.push({ path: rel, content: fs.readFileSync(s) });
  }
}

function kitFiles() {
  const out = [];
  copyDirFiles(path.join(KIT_CLAUDE, 'agents'), '.claude/agents', out);
  copyDirFiles(path.join(KIT_CLAUDE, 'skills'), '.claude/skills', out);
  return out;
}

/* ---------- scelta della pipeline di sviluppo ----------
 * default: il kit così com'è (/implementTest). base: copia del kit con la skill rinominata, da adattare. empty: scheletro minimo
 * (una skill + un agent) da far crescere. Nomi secondo la convenzione delle skill: minuscole, numeri e trattini.
 * Il file .claude/pipeline.json è il segnale che il progetto ha una pipeline propria (nome, base di partenza, step mostrati in UI). */
const PIPE_NAME_RE = /^[a-z][a-z0-9-]{1,40}$/;
const PIPE_RESERVED = new Set(['implementTest', 'run-test', 'implementtest']);
function validPipeline(x) {
  const mode = x && x.mode ? String(x.mode) : 'default';
  if (mode === 'default') return { mode };
  if (mode !== 'base' && mode !== 'empty') throw new Error('Tipo di pipeline non valido.');
  const name = String(x.name || '').trim();
  if (!PIPE_NAME_RE.test(name) || name.endsWith('-')) throw new Error('Nome della pipeline non valido: minuscole, numeri e trattini, deve iniziare con una lettera (2-41 caratteri), es. "implementa-test".');
  if (PIPE_RESERVED.has(name)) throw new Error('"' + name + '" è il nome della pipeline predefinita: scegline un altro.');
  return { mode, name };
}
function pipelineMarker(root) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'pipeline.json'), 'utf8'));
    if (!j || typeof j.name !== 'string' || !PIPE_NAME_RE.test(j.name)) return null;
    return { name: j.name, base: j.base === 'implementTest' ? 'implementTest' : null, steps: Array.isArray(j.steps) ? j.steps : null };
  } catch { return null; }
}
const jsonText = (o) => JSON.stringify(o, null, 2) + '\n';
function pipelineFiles(pl) {
  if (pl.mode === 'default') return kitFiles();
  const n = pl.name;
  if (pl.mode === 'base') {
    const skillRe = /^\.claude\/skills\/implementTest\//;
    const out = kitFiles().map((k) => {
      const isText = /\.md$/.test(k.path);
      const content = isText ? Buffer.from(k.content.toString('utf8').replace(/implementTest/g, n), 'utf8') : k.content;
      return { path: k.path.replace(skillRe, '.claude/skills/' + n + '/'), content };
    });
    out.push({ path: '.claude/pipeline.json', content: jsonText({ name: n, base: 'implementTest', createdFrom: 'Cockpit' }) });
    return out;
  }
  const agent = n + '-worker';
  const skill = `---
name: ${n}
description: Pipeline "${n}" creata dal Cockpit, da completare. Descrivi qui cosa fa e quando va usata (per esempio quando l'utente chiede di lavorare su un ticket).
---

# ${n}

Orchestratore. Gira nel contesto principale: tu coordini e chiedi conferma prima di ogni mossa ambigua o distruttiva; gli agent eseguono i compiti circoscritti.

## Input

Ticket (id, URL o testo). Se manca, chiedilo una volta e fermati. Un ticket alla volta.

## Step 0 — Profilo

Leggi \`.claude/project-profile.md\`. Se un valore necessario al prossimo step è \`TBD\`, chiedilo all'utente e non assumerlo.

## Step 1 — Da definire

Delega all'agent \`${agent}\` il compito descritto nel suo file. Verifica il risultato prima di proseguire.

## Come far crescere questa pipeline

Aggiungi uno step per ogni compito distinto e un agent per ogni step (\`.claude/agents/<nome>.md\`), con i soli tool che gli servono.
`;
  const ag = `---
name: ${agent}
description: Primo agent della pipeline ${n}, da completare. Descrivi in una frase che compito svolge e quando l'orchestratore deve delegarglielo.
tools: Read, Grep, Glob
model: sonnet
---

Sei un agent della pipeline ${n}. Rispondi in italiano. Sola lettura: non modificare file e non lanciare comandi.

Leggi prima \`.claude/project-profile.md\`. Valori \`TBD\` necessari: segnalali, non assumerli.

## Compito

Da definire: descrivi qui che cosa deve fare, cosa riceve in ingresso e cosa deve restituire.
`;
  const steps = [
    { id: 'profile', label: '0 Setup', desc: 'Lettura del profilo e del ticket' },
    { id: 'step1', label: '1 Primo step', agents: [agent], desc: 'Da definire' },
  ];
  return [
    { path: `.claude/skills/${n}/SKILL.md`, content: Buffer.from(skill, 'utf8') },
    { path: `.claude/agents/${agent}.md`, content: Buffer.from(ag, 'utf8') },
    { path: '.claude/pipeline.json', content: jsonText({ name: n, base: null, createdFrom: 'Cockpit', steps }) },
  ];
}

const settingsText = () => JSON.stringify({ permissions: { allow: PRESET }, enabledMcpjsonServers: ['playwright'] }, null, 2) + '\n';

// Indirizzo del repository Maven da cui il progetto scarica il framework di test: lo indica l'utente (non è scritto nel codice dell'applicativo).
function validFrameworkRepo(x) {
  const u = String(x || '').trim().replace(/\/+$/, '');
  if (!u) throw new Error('Indica l\'indirizzo del repository Maven del framework (es. https://maven.pkg.github.com/organizzazione/repository).');
  if (u.length > 200 || !/^https:\/\/[A-Za-z0-9.-]+(:\d{1,5})?(\/[A-Za-z0-9._~-]+)*$/.test(u)) throw new Error('Indirizzo del repository non valido: deve iniziare con https:// e non contenere spazi né parametri.');
  return u;
}
function planNew(p) {
  const d = derive(p);
  const dir = validDir(p.dir, { mustBeEmptyOrMissing: true });
  const envs = validEnvs(p.envs);
  const user = dotenvValue(p.username, 'Utente applicazione');
  const pass = dotenvValue(p.password, 'Password applicazione');
  const repo = validFrameworkRepo(p.frameworkRepo);
  const ctx = { ...d, name: d.name, frameworkRepo: repo };
  const pl = validPipeline(p.pipeline);
  const f = [];
  const add = (rel, content, secret) => f.push({ path: rel, content, secret: !!secret });
  const java = (sub, tpl) => add(`src/test/java/${d.pkgPath}/${sub}`, render(tpl, ctx));

  add('pom.xml', render(fs.readFileSync(path.join(TPL, 'pom.xml'), 'utf8'), ctx));
  add('.gitignore', T.gitignore);
  add('.env.example', T.envExample);
  add('.env', `APP_USERNAME=${user}\nAPP_PASSWORD=${pass}\n`, true);
  java(`${d.pascal}Test.java`, T.baseTest);
  java('page/HomePage.java', T.homePage);
  java('actions/HomeActions.java', T.homeActions);
  java('testcases/ui/smoke/SMOKE_1.java', T.smokeTest);
  java(`testcases/ui/${d.pascal}Regression.java`, T.regression);
  add(`TestSuites/${d.pascal}.xml`, render(T.suite, ctx));
  for (const e of envs) add(`src/main/resources/Environments/${e.name}/resources.properties`, render(T.env, { ...ctx, envName: e.name, url: e.url }));
  add('.mcp.json', T.mcp);
  add('.claude/settings.json', settingsText());
  add('.claude/project-profile.md', profileText({ ...d, env: envs[0].name, repo }));
  for (const k of pipelineFiles(pl)) add(k.path, k.content);
  return { dir, files: f, derived: d, firstEnv: envs[0].name, suite: d.pascal + '.xml' };
}

// Progetto esistente: aggiunge solo ciò che manca (profilo, permessi, MCP, kit). Non tocca mai il codice.
function planExisting(p) {
  const dir = validDir(p.dir, { mustBeEmptyOrMissing: false });
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error('La cartella non esiste.');
  const f = [];
  const add = (rel, content) => f.push({ path: rel, content });
  // Se il progetto ha già skill proprie non si aggiunge il kit di Aletheia (né il profilo): solo permessi e MCP. Il kit si aggiunge solo se richiesto.
  const r = resolvePipeline(dir, p.prefs);
  const useKit = !!p.addKit || !r.skills.length || r.ours;
  if (useKit) add('.claude/project-profile.md', profileText(null));
  add('.mcp.json', T.mcp);
  add('.claude/settings.json', settingsText());
  if (useKit) for (const k of kitFiles()) add(k.path, k.content);
  return { dir, files: f };
}

// Classifica ogni file: da creare / già presente (saltato). Nessuna scrittura.
function classify(plan) {
  return plan.files.map((x) => ({
    path: x.path,
    secret: !!x.secret,
    size: Buffer.byteLength(x.content),
    exists: fs.existsSync(path.join(plan.dir, x.path)),
  }));
}

function writePlan(plan) {
  const created = [], skipped = [];
  for (const x of plan.files) {
    const target = path.join(plan.dir, x.path);
    if (fs.existsSync(target)) { skipped.push(x.path); continue; }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, x.content);
    created.push(x.path);
  }
  return { created, skipped };
}

const run = (cmd, cwd, timeout) => new Promise((resolve) =>
  exec(cmd, { cwd, timeout, windowsHide: true, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) =>
    resolve({ ok: !err, out: (String(stdout || '') + String(stderr || '')).trim() })));

async function createProject(p) {
  const plan = planNew(p);
  fs.mkdirSync(plan.dir, { recursive: true });
  const res = writePlan(plan);
  // branch iniziale "main" (come base_branch del profilo); su git più vecchi senza -b si ripiega su git init
  let git = await run('git init -b main', plan.dir, 30000);
  if (!git.ok) git = await run('git init', plan.dir, 30000);
  // commit iniziale solo se l'utente l'ha scelto: senza almeno un commit non si possono creare branch. .env è in .gitignore.
  let initialCommit = false, commitNote = '';
  if (git.ok && p.initialCommit) {
    const add = await run('git add -A', plan.dir, 60000);
    const c = add.ok ? await run('git commit -m "Progetto iniziale"', plan.dir, 60000) : add;
    initialCommit = c.ok;
    if (!c.ok) commitNote = /Author identity unknown|tell me who you are|unable to auto-detect/i.test(c.out) ? 'identità Git non configurata (user.name e user.email)' : 'non riuscito';
  }
  return { dir: plan.dir, ...res, git: git.ok, initialCommit, commitNote, suite: plan.suite, env: plan.firstEnv };
}

function configureExisting(p) {
  const plan = planExisting(p);
  return { dir: plan.dir, ...writePlan(plan) };
}

// Compila il progetto con il comando del profilo. Può richiedere minuti (download dipendenze).
async function verify(dir) {
  const full = validDir(dir, { mustBeEmptyOrMissing: false });
  if (!fs.existsSync(path.join(full, 'pom.xml'))) throw new Error('pom.xml non trovato nella cartella del progetto.');
  const r = await run('mvn -q test-compile', full, 15 * 60 * 1000);
  const lines = r.out.split(/\r?\n/).filter((l) => /ERROR|BUILD|Could not|401|403|Unauthorized|not found/i.test(l));
  const tail = (lines.length ? lines : r.out.split(/\r?\n/)).slice(-15).join('\n').slice(0, 3000);
  let hint = '';
  if (!r.ok) {
    if (/401|403|Unauthorized|Forbidden|Could not transfer artifact com\.nexsoft/i.test(r.out)) hint = 'Accesso a GitHub Packages negato: controlla il token (deve avere il permesso read:packages) nel passo "Accesso".';
    else if (/Could not resolve dependencies/i.test(r.out)) hint = 'Dipendenze non risolte: controlla la connessione e il token GitHub Packages.';
    else if (/release version 11 not supported|invalid target release/i.test(r.out)) hint = 'JDK non compatibile con Java 11.';
  }
  return { ok: r.ok, output: tail, hint };
}

/* ---------- skill del progetto ---------- */
// Un progetto può avere già le sue skill (.claude/skills/<nome>/SKILL.md) o comandi (.claude/commands/<nome>.md): si usano quelle.
const SKILL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,60}$/;
function frontmatter(text) {
  const m = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const o = {};
  if (m) for (const l of m[1].split(/\r?\n/)) { const k = l.match(/^([A-Za-z][A-Za-z-]*):\s*(.*)$/); if (k) o[k[1].toLowerCase()] = k[2].trim().replace(/^["']|["']$/g, ''); }
  return o;
}
function listSkills(root) {
  const out = [];
  const seen = new Set();
  const push = (name, kind, text) => {
    if (!SKILL_NAME_RE.test(name) || seen.has(name)) return;
    seen.add(name);
    const fm = frontmatter(text);
    out.push({ name, kind, description: (fm.description || '').slice(0, 240), argHint: (fm['argument-hint'] || '').slice(0, 120) });
  };
  const sdir = path.join(root, '.claude', 'skills');
  if (fs.existsSync(sdir)) {
    for (const e of fs.readdirSync(sdir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const f = path.join(sdir, e.name, 'SKILL.md');
      if (!fs.existsSync(f)) continue;
      const text = fs.readFileSync(f, 'utf8').slice(0, 6000);
      const fm = frontmatter(text);
      push(SKILL_NAME_RE.test(fm.name || '') ? fm.name : e.name, 'skill', text);
    }
  }
  const cdir = path.join(root, '.claude', 'commands');
  if (fs.existsSync(cdir)) {
    for (const e of fs.readdirSync(cdir, { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith('.md')) push(e.name.slice(0, -3), 'command', fs.readFileSync(path.join(cdir, e.name), 'utf8').slice(0, 6000));
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
function kitAgentsPresent(root) {
  const dir = path.join(KIT_CLAUDE, 'agents');
  if (!fs.existsSync(dir)) return false;
  const want = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
  return want.length > 0 && want.every((f) => fs.existsSync(path.join(root, '.claude', 'agents', f)));
}
// Scelta automatica solo quando è ovvia: la skill di Aletheia, oppure l'unica skill chiamata implement[ing]-test[s].
function autoPick(skills, marker) {
  const s = skills.filter((x) => x.kind === 'skill');
  if (marker && s.some((x) => x.name === marker.name)) return marker.name; // pipeline propria creata dal Cockpit
  if (s.some((x) => x.name === 'implementTest')) return 'implementTest';
  const m = s.filter((x) => /^implement(ing)?[-_]?tests?$/i.test(x.name));
  return m.length === 1 ? m[0].name : null;
}
// Step personalizzati per la skill scelta, oppure null: si usano allora quelli del kit.
// Ordine: file del progetto (.claude/pipeline-steps.json, scritto dall'editor) > pipeline.json del wizard > ui/skill-steps.json (file dello strumento, solo lettura).
function customSteps(skill, marker, root) {
  if (root && skill) {
    try {
      const map = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'pipeline-steps.json'), 'utf8'));
      const list = map && Object.prototype.hasOwnProperty.call(map, skill) ? map[skill] : null;
      if (Array.isArray(list) && list.length && list.every((x) => x && typeof x.id === 'string' && typeof x.label === 'string')) {
        return list.map((x) => ({ id: x.id, label: x.label, desc: x.desc || '', agents: x.agents || [], skills: x.skills || [] }));
      }
    } catch { /* file assente o non valido: si passa alla fonte successiva */ }
  }
  if (marker && skill === marker.name && marker.steps && marker.steps.every((x) => x && typeof x.id === 'string' && typeof x.label === 'string')) {
    return marker.steps.map((x) => ({ id: x.id, label: x.label, desc: x.desc || '', agents: x.agents || [], skills: x.skills || [] }));
  }
  try {
    const all = JSON.parse(fs.readFileSync(require('./infra/paths').uiFile('skill-steps.json'), 'utf8'));
    const list = skill && Object.prototype.hasOwnProperty.call(all, skill) ? all[skill] : null;
    if (!Array.isArray(list) || !list.every((x) => x && typeof x.id === 'string' && typeof x.label === 'string')) return null;
    return list.map((x) => ({ id: x.id, label: x.label, desc: x.desc || '', agents: x.agents || [], skills: x.skills || [] }));
  } catch { return null; }
}
function resolvePipeline(root, prefs) {
  const skills = listSkills(root);
  const pr = prefs || {};
  const marker = pipelineMarker(root);
  const chosen = pr.skill && skills.some((s) => s.name === pr.skill) ? pr.skill : autoPick(skills, marker);
  const steps = customSteps(chosen, marker, root);
  const kitAgents = kitAgentsPresent(root);
  const stepsMeaningful = !!steps || kitAgents; // gli step 0-8 del kit hanno senso solo con gli agent di Aletheia; altrimenti servono step propri della skill
  const ours = (chosen === 'implementTest' || !!(marker && marker.base === 'implementTest' && marker.name === chosen)) && kitAgents;
  const args = typeof pr.args === 'string' && pr.args.trim() ? pr.args.trim() : (ours ? '{text}' : '{key}');
  const sel = skills.find((s) => s.name === chosen);
  return { skills, chosen, auto: !(pr.skill && pr.skill === chosen), ours, stepsMeaningful, steps, args, argHint: sel ? sel.argHint : '', description: sel ? sel.description : '' };
}
function validArgs(a) {
  const s = String(a == null ? '' : a).trim();
  if (!s || s.length > 200 || /[\u0000-\u001f]/.test(s)) throw new Error('Argomenti non validi: 1-200 caratteri, su una sola riga.');
  return s;
}
// {key} = chiave del ticket (es. NX-2), {summary} = titolo, {text} = chiave, titolo e descrizione.
function renderArgs(tpl, ticket) {
  const first = String(ticket).split(/\r?\n/)[0].trim();
  const m = first.match(/^([A-Z][A-Z0-9_]*-\d+)\s*(?:[—–-]\s*(.*))?$/);
  const key = m ? m[1] : first;
  const summary = m && m[2] ? m[2].trim() : first;
  return String(tpl).replace(/\{(key|summary|text)\}/g, (_, k) => (k === 'key' ? key : k === 'summary' ? summary : String(ticket)));
}
function buildCommand(root, prefs, ticket) {
  const r = resolvePipeline(root, prefs);
  if (!r.chosen) throw new Error('Scegli quale skill lanciare: scheda Progetto → "Come si lancia la pipeline".');
  const t = String(ticket || '').trim();
  return '/' + r.chosen + ' ' + (t ? renderArgs(r.args, t) : '(nessun ticket: usa gli input allegati)');
}

/* ---------- controllo di prontezza di un progetto agganciato ---------- */
// `claude` carica da solo agents/ e skills/ dalla cartella in cui parte. Se il progetto ha già le sue skill si usano quelle;
// il kit di Aletheia serve solo quando mancano. Sola lettura.
function inspect(root, prefs) {
  const items = [];
  const add = (id, label, status, detail, hint, fixable) => items.push({ id, label, status, detail, hint: hint || '', fixable: !!fixable });
  const has = (rel) => fs.existsSync(path.join(root, rel));
  const FIX = 'Premi "Prepara il progetto": copia dal kit solo ciò che manca.';
  const r = resolvePipeline(root, prefs);
  const useKit = !r.skills.length || r.ours; // profilo e controlli del kit hanno senso solo con la pipeline di Aletheia

  has('pom.xml')
    ? add('pom', 'Progetto Maven', 'ok', 'pom.xml presente')
    : add('pom', 'Progetto Maven', 'fail', 'pom.xml non trovato', 'I progetti Aletheia sono Maven: aggancia la cartella che contiene pom.xml.');

  if (r.chosen) add('pipeline', 'Skill da lanciare', 'ok', '/' + r.chosen + (r.auto ? ' (scelta automatica)' : '') + (r.ours ? ' · pipeline di Aletheia' : ' · skill del progetto') + ' · ' + r.skills.length + (r.skills.length === 1 ? ' skill trovata' : ' skill trovate'));
  else if (r.skills.length) add('pipeline', 'Skill da lanciare', 'fail', r.skills.length + ' skill nel progetto, nessuna scelta', 'Scegli qui sotto quale lanciare con Automatizza e Avvia, oppure aggiungi la pipeline di Aletheia.');
  else add('pipeline', 'Skill da lanciare', 'fail', 'Nessuna skill nel progetto', FIX, true);

  if (r.ours) {
    const kitAgents = fs.existsSync(path.join(KIT_CLAUDE, 'agents')) ? fs.readdirSync(path.join(KIT_CLAUDE, 'agents')).filter((f) => f.endsWith('.md')) : [];
    const badAgents = kitAgents.filter((f) => {
      const pth = path.join(root, '.claude', 'agents', f);
      return !fs.existsSync(pth) || !/^---[\s\S]*?\bname:/.test(fs.readFileSync(pth, 'utf8').slice(0, 600));
    });
    badAgents.length
      ? add('agents', 'Agent della pipeline', 'fail', 'Mancanti o non validi: ' + badAgents.map((f) => f.replace(/\.md$/, '')).join(', '), FIX, true)
      : add('agents', 'Agent della pipeline', 'ok', kitAgents.length + ' agent presenti in .claude/agents');
    const skillsDir = path.join(KIT_CLAUDE, 'skills');
    const kitSkills = fs.existsSync(skillsDir) ? fs.readdirSync(skillsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) : [];
    const badSkills = kitSkills.filter((s) => !fs.existsSync(path.join(root, '.claude', 'skills', s, 'SKILL.md')));
    badSkills.length
      ? add('skills', 'Skill della pipeline', 'fail', 'Mancanti: ' + badSkills.join(', '), FIX, true)
      : add('skills', 'Skill della pipeline', 'ok', kitSkills.join(', ') + ' presenti in .claude/skills');
  }

  if (useKit) {
    const prof = config.readProfile(root);
    if (!prof.exists) add('profile', 'Profilo progetto', 'fail', 'project-profile.md mancante', 'Gli agent leggono tutte le convenzioni da qui. ' + FIX, true);
    else {
      const tbd = prof.entries.filter((e) => e.tbd);
      tbd.length
        ? add('profile', 'Profilo progetto', 'warn', tbd.length + (tbd.length === 1 ? ' voce da compilare' : ' voci da compilare'), 'Compilale in Configurazione → Profilo: la pipeline si ferma e le chiede se servono.')
        : add('profile', 'Profilo progetto', 'ok', 'Nessuna voce da compilare');
    }
  }

  const cfg = config.readConfig(root);
  const rules = [...cfg.permissions.allow, ...cfg.permissions.local];
  const noBash = ['mvn -q test-compile', 'mvn test -DsuiteFile=Suite.xml -DEnv=X'].filter((c) => !config.covers(rules, c));
  const noMcp = !rules.some((x) => x === 'mcp__playwright' || x.startsWith('mcp__playwright__'));
  if (!cfg.permissions.exists && !cfg.permissions.local.length) add('perm', 'Permessi', 'warn', 'Nessuna regola configurata', useKit ? FIX : 'Senza regole i comandi della skill vengono fermati e chiesti uno per uno ("Consenti e riprendi"). Apri Configurazione → Permessi.', useKit);
  else if (noBash.length || noMcp) add('perm', 'Permessi', 'warn', 'Non coperti: ' + [...(noBash.length ? ['mvn compile/test'] : []), ...(noMcp ? ['Playwright MCP'] : [])].join(', '), 'Apri Configurazione → Permessi e applica il preset (oppure consenti i comandi quando vengono chiesti).');
  else add('perm', 'Permessi', 'ok', 'mvn e Playwright consentiti');

  const mcp = (() => { try { return JSON.parse(fs.readFileSync(path.join(root, '.mcp.json'), 'utf8')); } catch { return null; } })();
  mcp && mcp.mcpServers && mcp.mcpServers.playwright
    ? add('mcp', 'Playwright MCP', 'ok', 'server "playwright" in .mcp.json')
    : add('mcp', 'Playwright MCP', useKit ? 'fail' : 'warn', '.mcp.json mancante o senza server playwright', useKit ? 'Serve all\'Explorer per navigare l\'app. ' + FIX : 'Serve solo se la skill del progetto naviga l\'app con Playwright.', useKit);

  has('.env')
    ? add('env', 'File .env', 'ok', 'presente')
    : add('env', 'File .env', 'warn', '.env mancante', 'Aletheia lo richiede per eseguire i test (credenziali e variabili): crealo dalla root del progetto.');
  has('.git') ? add('git', 'Repository git', 'ok', 'presente') : add('git', 'Repository git', 'warn', 'Non è un repository git', 'Lo step Branch potrebbe fallire.');

  return { items, ready: !items.some((i) => i.status === 'fail'), fixable: items.some((i) => i.fixable && i.status !== 'ok'), pipeline: r };
}

/* ---------- ~/.m2/settings.xml (token GitHub Packages) ---------- */
const m2File = () => path.join(os.homedir(), '.m2', 'settings.xml');

function m2Status() {
  const f = m2File();
  if (!fs.existsSync(f)) return { exists: false, hasGithub: false };
  const x = fs.readFileSync(f, 'utf8');
  return { exists: true, hasGithub: /<server>\s*<id>\s*github\s*<\/id>/.test(x) };
}

const xmlEsc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

// Aggiunge il server "github" senza toccare il resto. Non sovrascrive un server github già presente.
function saveM2Token(username, token) {
  const u = String(username || '').trim();
  const t = String(token || '').trim();
  if (!/^[A-Za-z0-9-]{1,39}$/.test(u)) throw new Error('Username GitHub non valido.');
  if (!/^(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|gh[ousr]_[A-Za-z0-9]{20,})$/.test(t)) throw new Error('Il token non ha un formato GitHub valido (ghp_… o github_pat_…).');
  const f = m2File();
  const server = `    <server>\n      <id>github</id>\n      <username>${xmlEsc(u)}</username>\n      <password>${xmlEsc(t)}</password>\n    </server>\n`;
  fs.mkdirSync(path.dirname(f), { recursive: true });
  if (!fs.existsSync(f)) {
    fs.writeFileSync(f, `<?xml version="1.0" encoding="UTF-8"?>\n<settings>\n  <servers>\n${server}  </servers>\n</settings>\n`, { mode: 0o600 });
    return { action: 'creato' };
  }
  const x = fs.readFileSync(f, 'utf8');
  if (/<server>\s*<id>\s*github\s*<\/id>/.test(x)) throw new Error('In ~/.m2/settings.xml esiste già un server "github": non lo sovrascrivo. Modificalo a mano se il token è scaduto.');
  fs.copyFileSync(f, f + '.bak-ui');
  let y;
  if (/<\/servers>/.test(x)) y = x.replace(/<\/servers>/, () => server + '  </servers>');
  else if (/<settings[^>]*>/.test(x)) y = x.replace(/(<settings[^>]*>)/, (m) => `${m}\n  <servers>\n${server}  </servers>`);
  else throw new Error('~/.m2/settings.xml ha un formato inatteso: aggiungi il server a mano.');
  fs.writeFileSync(f, y);
  return { action: 'aggiornato', backup: '~/.m2/settings.xml.bak-ui' };
}

/* ---------- selettore cartella nativo (Windows) ---------- */
function pickFolder() {
  // owner TopMost: senza, il dialogo può aprirsi dietro al browser e sembrare che non succeda nulla
  const ps = "Add-Type -AssemblyName System.Windows.Forms; $o=New-Object System.Windows.Forms.Form; $o.TopMost=$true; $f=New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description='Scegli la cartella'; if($f.ShowDialog($o) -eq 'OK'){ $f.SelectedPath }";
  return run(`powershell -NoProfile -STA -Command "${ps}"`, KIT, 180000).then((r) => (r.ok ? r.out.split(/\r?\n/).pop().trim() : ''));
}

module.exports = { validFrameworkRepo, KIT, listSkills, resolvePipeline, buildCommand, renderArgs, validArgs, inspect, derive, planNew, planExisting, classify, createProject, configureExisting, verify, m2Status, saveM2Token, pickFolder, validDir };
