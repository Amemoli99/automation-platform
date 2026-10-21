# Architettura di NACP

Documento per chi sviluppa o mantiene il Cockpit. Per l'uso dell'app vedi il [README](../README.md); per la storia delle scelte e dei problemi incontrati vedi [MEMORIA-DEL-LAVORO.md](MEMORIA-DEL-LAVORO.md).

## In una frase

Un **gateway** unico (l'unica porta verso il browser) controlla accesso e permessi e smista le richieste a **otto servizi** separati, che comunicano con lui tramite **pipe con nome**. Ogni servizio è un'**area** del codice con confini imposti da un test. Se un servizio non parte, l'area gira dentro il gateway: l'app non si ferma.

```
 browser ──HTTP──▶  GATEWAY (main.js)  ──pipe con nome──▶  servizi (un processo per area)
                    · token e cookie                          jira · tools · pipelines · git
                    · Origin / Host / CSP                     mcp · repos · project · session
                    · permessi per rotta
                    · stato dell'app (progetto, recenti, preferenze)
                    · licenza
```

## Cartelle

```
src/server/main.js          gateway: server HTTP, controlli comuni, smistamento
src/server/http/            auth.js (token, cookie, Origin/Host) · caps.js (permessi per rotta) · static.js · route.js (NOT_HANDLED, needRoot, requireCap, prefsOf)
src/server/gateway/         punti di collegamento tra aree: system.js, project.js, repos.js, remote.js (servizi)
src/server/state.js         stato dell'app per utente (progetto agganciato, recenti, preferenze) in %APPDATA%
src/server/supervisor.js    avvia i servizi come processi figli, li controlla, li riavvia, li ferma
src/server/service-host.js  espone su pipe le rotte di un'area; service-entries/<area>.js è il punto d'ingresso di ogni servizio
src/server/infra/           paths.js · claude.js (unico punto che lancia claude) · proc.js (kill dell'albero) · ipc.js (pipe, token, contesto)
src/server/areas/<area>/    index.js (interfaccia pubblica) + file interni + routes.js
src/server/assets/          catalog.json, skill-steps.json, version.json, templates/
src/web/                    index.html (solo markup) · css/app.css · js/*.js (uno per scheda, boot.js per ultimo)
launcher/                   Launcher.cs, build-exe.ps1
kit/                        skill e agent forniti ai progetti
build/                      build-dist.js (pacchetto offuscato) · zip.py
test/                       unit · flow · smoke · fixtures (finti Jira, MCP, claude)
tools/license.js            strumento di chi emette le licenze (la chiave privata non sta nel repository)
```

## Le aree

| Area | Contenuto | Dipende da |
|---|---|---|
| `license` | licenza firmata, profili e permessi | – |
| `jira` | connessione, query, ticket | – |
| `pipelines` | editor di skill e agent | – |
| `project` | wizard, controlli sui file del progetto, configurazione, accesso a Claude | – |
| `platform` | versione, report di diagnostica, apertura in IntelliJ | – |
| `scm` | git e origini GitHub/GitLab (`sources.json`), clone | project |
| `tools` | scheda Tool: rilevati, catalogo, registro MCP | project |
| `mcp` | server MCP del progetto: credenziali, tool, schede, domande a Claude | pipelines, project |
| `demo` | modalità Demo e simulatore (`sim.js`) | project, jira |
| `session` | sessione con `claude`: processo, eventi SSE, in diretta, permessi, Ask Claude | project, mcp, demo |

Le dipendenze consentite stanno in `test/unit/architecture-test.js` (`ALLOWED`): ogni voce è un debito consapevole e una voce non più usata fa fallire il test.

### Regole imposte dal test di architettura

1. Tra aree si importa solo `areas/<area>/index.js` (il gateway e i servizi possono importare anche le rotte: `routes.js`, `<parte>-routes.js`).
2. Un'area dipende solo dalle aree elencate in `ALLOWED`; nessun ciclo.
3. Le aree non importano il gateway; il nucleo (`infra/`, `state.js`) non importa aree.
4. Gli indici delle aree caricano i moduli al primo uso: un servizio non trascina l'intera area.

Altri controlli permanenti: `scope-test` (nomi usati e non dichiarati, anche con spread) e `caps-test` (permesso richiesto da ciascuna delle 109 rotte).

## Servizi

Processi figli del gateway, uno per area, lanciati dal supervisore (`supervisor.js`). Default: `jira, tools, pipelines, git, mcp, repos, project, session`.

| Variabile | Effetto |
|---|---|
| `NACP_SERVICES=a,b` | aree da avviare come servizi (vuoto = nessuna) |
| `NACP_INPROC=1` | tutto in un solo processo (via di fuga) |

Nel gateway restano **licenza** (serve a ogni richiesta, in modo sincrono), **stato dell'app** e i punti di collegamento (`gateway/`).

### Pipe con nome (`infra/ipc.js`)

HTTP su `\\.\pipe\nacp-<id casuale>-<servizio>` (socket di dominio Unix altrove), senza porte di rete. Nome casuale a ogni avvio, **token obbligatorio** in `x-nacp-token` (passato ai figli solo via ambiente), diritti della pipe limitati all'utente. Un programma dello stesso utente che conosca nome e token può comunque collegarsi: è lo stesso limite della porta locale, ma qui non c'è nessuna porta da scoprire. Un test verifica che i servizi non ascoltino su nessuna porta TCP.

### Contesto della richiesta

I servizi **non leggono mai lo stato dell'app**. A ogni richiesta inoltrata il gateway scrive l'intestazione `x-nacp-context` (base64 di un JSON):

```
{ root, prefs, allPrefs, demo, running, caps, role, roleLabel }
```

- `root`/`prefs`: progetto agganciato e sue preferenze (skill, JDK); `allPrefs`: preferenze di tutte le cartelle (il wizard lavora su cartelle non ancora agganciate).
- `demo`: modalità Demo attiva. `running`: una sessione `claude` è in corso. `caps`/`role`/`roleLabel`: permessi del profilo dalla licenza.
- Il browser **non può falsificarlo**: `ipc.forward` cancella ogni `x-nacp-context` in arrivo e scrive il proprio. Ogni test di servizio verifica che un contesto falso venga ignorato.
- Le rotte dei servizi usano `ctx.context`, `needRoot(ctx)`, `requireCap(ctx, cap, cosa)`, `prefsOf(ctx, dir)` (da `http/route.js`).

### Quando una rotta cambia lo stato dell'app

Resta nel gateway (`gateway/*.js`): `GET /api/project`, aggancio, scelta di skill e JDK, creazione di un progetto, clone con aggancio. Per **creazione** e **clone** vale lo schema *il servizio lavora sui file, il gateway aggancia*: il gateway chiama un **controllo** del servizio (`/_nacp/control/<op>`), poi aggiorna lo stato.

### Messaggi e controlli

- **Controlli** (`controls` in `runService`): `demo` (Jira), `clone` (repos), `create-project` e `configure-existing` (project), `reset` e `status` (session).
- **Demo**: il gateway invia `demo` a tutti i servizi; chi non ha il controllo lo ignora. Dopo ogni riavvio di un servizio la Demo viene ripristinata.
- **Messaggi del figlio** (canale IPC del supervisore): `ready` all'avvio; il servizio Session manda `{type:'running'}` a ogni cambio, e il gateway ne tiene una copia in `state.running` (la consultano git, progetto e cambio progetto).

### Ciclo di vita

- Avvio: il gateway ascolta solo dopo aver avviato i servizi; un servizio che non parte lascia l'area in-process.
- Caduta: riavvio con attesa crescente, fino a 4 cadute in 60 s, poi `failed`.
- Chiusura del gateway: richiesta di chiusura ordinata, poi terminazione dell'albero. Se il gateway muore, i servizi si chiudono da soli (canale IPC).
- `onShutdown` per i processi figli dei servizi (server MCP, `claude`).

## Pacchetto distribuito

`npm run dist` produce `.tmp/dist/NexsoftAutomationCockpit` con un file offuscato per processo: `ui/server.js` (gateway), `ui/demo/sim.js`, `ui/services/<area>.js`. Il layout `ui/` è quello che si aspetta l'exe. `infra/paths.js` riconosce sia i sorgenti sia il pacchetto (e i bundle dei servizi in `ui/services/`: un test sul pacchetto ha scoperto che prima cercavano le risorse nella cartella sbagliata). `Launcher.cs` cerca `ui\server.js` e, se manca, `src\server\main.js`.

## Test

| Comando | Cosa fa |
|---|---|
| `npm test` | tutta la suite con i servizi attivi (default) |
| `npm run test:inproc` | stessa suite con tutto in un processo |
| `npm run test:dist -- <pacchetto>` | stessa suite sul pacchetto offuscato (o su uno zip estratto) |
| `npm run test:exe` | l'exe avvia il server, pubblica la chiave, si chiude senza orfani |
| `node test/run.js flow --only "<testo>"` | un solo scenario |
| `node test/run.js flow --record` | rigenera `test/flow/routes-golden.json` (da fare in modalità `--inproc`) |

Il lanciatore (`test/run.js`) prepara da solo licenza di prova (chiave creata al volo), progetto creato dall'app, finti Jira, MCP e `claude`, in `.tmp/test`. Non tocca i dati reali.

Rete di sicurezza del riordino: `routes-golden.json` registra stato e messaggio di 72 rotte e deve restare identico in tutte le modalità; `caps-golden.json` blocca i permessi per rotta.

## Come aggiungere una funzione

1. Rotta nell'area giusta (`areas/<area>/routes.js`), usando `ctx.context` e non `state`.
2. Logica nell'area; se serve un'altra area, dichiaralo in `ALLOWED` (e giustifica la riga).
3. Permesso in `http/caps.js` (se manca, la rotta nasce riservata all'Administrator); aggiorna `caps-golden.json` solo se voluto.
4. Se tocca lo stato dell'app: rotta nel gateway (`gateway/*.js`), non nel servizio.
5. Test: `npm test` e `npm run test:inproc`; se cambia un'area-servizio, `npm run test:dist` dopo `npm run dist`.

## Trappole note

- **Windows e `process.exit`**: uscire subito dopo `fetch` fa crashare libuv (`UV_HANDLE_CLOSING`): i test escono con ritardo.
- **Script della pagina**: sono script classici in un solo ambito globale, ma l'*hoisting* delle funzioni vale solo dentro un file: le istruzioni eseguite al caricamento stanno in `js/boot.js`.
- **Backslash in shell**: negli script lanciati da heredoc i `\\` si dimezzano; per file con percorsi Windows usare l'editor e non la shell.
- **Stato salvato**: `saveState` conserva le chiavi che non gestisce (le origini Git vecchie), altrimenti si perderebbero prima della migrazione in `sources.json`.
