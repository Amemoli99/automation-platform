# Nexsoft Automation Cockpit Platform (NACP)

Il "cockpit" da cui si pilota lo sviluppo di test automatici (framework Aletheia) a partire da un ticket, con la pipeline `/implementTest`.
È indipendente da qualsiasi progetto: lavora sul progetto che agganci dalla scheda **Progetto**.

> La cartella e i dati locali si chiamano ancora `developerTest-UI` (ad esempio `%APPDATA%\developerTest-UI`): il nome è rimasto per non perdere credenziali e impostazioni già salvate. Il nome `/implementTest` è quello della pipeline (skill), non della piattaforma.

## Avvio

- Doppio clic su `NexsoftAutomationCockpit.exe` (apre il server e il browser su http://127.0.0.1:4173/), oppure
- da terminale, in questa cartella: `node ui\server.js`
- **dal repository** (dopo `git clone`): `npm start`, oppure costruisci l'eseguibile una volta con `npm run exe` (serve solo Windows, usa il compilatore già presente) e poi doppio clic su `NexsoftAutomationCockpit.exe`: nel repository avvia `src\server\main.js`, nel pacchetto `ui\server.js`. L'exe non è nel repository (file binario): ogni clone lo costruisce con `npm run exe`. `npm run test:exe` ne verifica l'avvio.

Per chiudere usa il pulsante **Chiudi** nel menu laterale.

## Requisiti

Node.js, Claude Code (con login), Maven, Java e Git nel PATH. La scheda **Progetto** → "Nuovo progetto" li controlla e spiega cosa manca.

## Sezioni (menu laterale)

| Sezione | A cosa serve |
|---|---|
| **Esecuzione** | Nuova esecuzione → avanzamento (la conversazione resta chiusa) → conversazione, che si apre da sola solo quando la pipeline ha bisogno di te |
| **Dashboard Test** | I test ricavati dalle query JQL salvate; accanto a ciascuno **Automatizza** lancia `/implementTest` su quel ticket |
| **Progetto** | Aggancio di un progetto (da repository GitHub/GitLab o da cartella locale), controllo di prontezza, nuovo progetto guidato in 4 passi (con scelta della pipeline) e **Modifica pipeline e agent…**, un editor in una scheda a parte per skill e agent |
| **Git** | Branch corrente, commit, aggiorna, cambia/crea branch, merge, push |
| **Jira** | Connessione a Jira Cloud, lettura della **board** di progetto (o di una dashboard), scelta di tipi e stati, filtro della board e sprint, JQL generata e salvata |
| **Configurazione** | Diagnostica, permessi, parametri e profilo del progetto (voci spiegate in italiano, con filtro "da compilare") |
| **Tool** | Cosa c'è nel progetto (programmi, server MCP, skill, agent, hook); aggiunta di server MCP dal catalogo o dal registro ufficiale; per ogni server locale **Credenziali e scheda…** (si apre in una nuova scheda del browser) |
| **Licenza** | Importazione della licenza e profilo (Administrator, Tester, Viewer, Demo) |

### Ask Claude (domande a margine)
Nella scheda Esecuzione, con una sessione avviata, il pulsante **Ask Claude** apre una finestra per chiedere come procede il lavoro **senza sporcare il contesto**: ogni domanda è indipendente, viene risposta da una **copia** della sessione (`claude -p --resume <id> --fork-session`) e né la domanda né la risposta entrano nella conversazione principale né la interrompono. È l'equivalente di `/btw`, che esiste solo nel terminale interattivo. Sola lettura (nessun permesso concesso: i comandi vengono negati), budget e turni limitati, una domanda alla volta, Stop la annulla. Ogni domanda rilegge la storia della sessione, quindi consuma un po' di quota. In Demo la risposta è simulata. Richiede il permesso `run` del profilo.

### Modalità Demo
Il pulsante **Demo** (in basso nel menu) simula il prodotto senza toccare nulla di reale: un progetto di prova in una cartella temporanea, ticket Jira finti (DEMO-101…) e una pipeline simulata in due turni (analisi, domanda, esplorazione, codice, compilazione, test). Si esce con **Esci dalla Demo**. In Demo sono bloccati il cambio progetto, le origini e le credenziali Jira. La cartella temporanea viene rimossa all'uscita. Di default la simulazione va a metà del ritmo base (circa 1 minuto e mezzo in tutto); si regola con la variabile `DEMO_SPEED` (0.3 = più lenta, 1 = ritmo base, 2 = doppia).

## Chiusura e riapertura
Chiudendo la UI, se il lavoro sul progetto è tutto sistemato (nessuna modifica al codice, nessun commit non pubblicato, nessuna sessione in corso) la piattaforma **si sgancia**: alla riapertura riparte pulita dalla scheda Progetto e il progetto è tra i **Recenti**. Si sgancia anche se il progetto non ha git. I file di configurazione che scrive la piattaforma stessa (`.mcp.json`, `.claude\settings*.json`, `.claude\pipeline*.json`) non contano come lavoro in sospeso; codice, skill e agent sì, come commit o branch non pubblicati e HEAD staccato: in quel caso il progetto resta agganciato.

## Sicurezza dell'accesso
La UI pilota un agente con accesso al repository, quindi l'accesso è protetto:
- Ogni avvio genera una **chiave di sessione** (256 bit). `NexsoftAutomationCockpit.exe` la legge da `%APPDATA%\developerTest-UI\session-<porta>.json` e apre il browser su `/?t=<chiave>`; il server la mette in un cookie **HttpOnly, SameSite=Strict** e la toglie dall'indirizzo. Senza chiave tutte le pagine e le API rispondono 401. Avviando `node ui/server.js` a mano, l'indirizzo completo è stampato in console.
- Richieste da un'altra origine (altre pagine web) o con un host diverso (DNS rebinding) sono rifiutate.
- Intestazioni di sicurezza su ogni risposta e **CSP con nonce**: nessuno script inline non autorizzato, nessun frame, connessioni solo verso il server stesso.
- Il server ascolta solo su 127.0.0.1. `UI_AUTH=off` esiste solo per i test automatici e stampa un avviso.

## Licenze e profili
Ogni utente ha una **licenza**: un file firmato digitalmente (organizzazione, utente, profilo, PC, scadenza) che si importa dalla scheda **Licenza**. È legata al PC (la scheda mostra il codice da inviare a chi emette la licenza). Senza licenza valida o scaduta si può usare solo la **Demo**.

| Profilo | Cosa può fare |
|---|---|
| **Administrator** | tutto, compresi permessi della pipeline, profilo del progetto, nuovi progetti, git sui branch principali |
| **Tester** | vedere, lanciare Automatizza, commit/branch/push sui propri branch, agganciare il proprio progetto, collegare il proprio Jira, IntelliJ, Demo |
| **Viewer** | solo lettura: vedere, agganciare un progetto, collegare Jira, IntelliJ |
| **Demo** | solo modalità Demo |

I permessi sono applicati dal server a ogni richiesta (una funzione nuova nasce riservata all'Administrator); la UI disattiva i comandi non consentiti. Progetto e Jira sono personali (il repository e il token di chi usa il PC), per questo servono anche ai profili non amministratori.

**Per chi emette le licenze** (strumento solo tuo, non da distribuire): `node tools/license.js keygen --embed` (una volta: crea le chiavi e incorpora la pubblica; custodisci la privata fuori dal repo), poi `node tools/license.js issue --private <chiave> --org .. --user .. --email .. --role tester --machine <codice PC> --days 90`. Finché non si esegue `keygen --embed` l'app è in modalità sviluppo (nessun limite, con avviso). Senza server una licenza non si revoca prima della scadenza: usa scadenze brevi.

## Cartelle

| Cartella | Contenuto |
|---|---|
| `ui\` | server e interfaccia (nessuna dipendenza da installare) |
| `kit\.claude\` | agent e skill della pipeline: sono la **fonte unica** e vengono copiati nei progetti ("Prepara il progetto") |
| `ui\templates\` | template del progetto generato dal wizard |

## Note

- Per cambiare agent o skill modifica `kit\.claude\`, poi usa "Prepara il progetto" sui progetti che devono riceverli (non sovrascrive i file già presenti).
- Lo stato locale (progetto agganciato, recenti, origini Git salvate, repository Maven del framework) è in `%APPDATA%\developerTest-UI\active-project.json` (per utente, fuori dal kit).
- Cartella di lavoro predefinita per clone e nuovi progetti: `%USERPROFILE%\IdeaProjects` (variabile `UI_WORKSPACE` per cambiarla). Porta: `UI_PORT`.
- **Origini Git:** nella scheda Progetto scegli GitHub (organizzazione o utente) oppure GitLab (server + gruppo, anche sottogruppi). All'avvio **nessuna origine è collegata** e l'app non ne deduce dai progetti presenti sul computer: quelle che aggiungi restano salvate e si ricollegano con un clic ("Collega"), si scollegano con "Scollega", si eliminano con il cestino. L'elenco usa le credenziali già salvate da Git (Credential Manager); non vengono mai salvate né mostrate. Per GitLab possono servire credenziali con il permesso `read_api`; se il server usa una CA aziendale, deve essere nell'archivio certificati di Windows.
- **Jira Cloud:** all'avvio Jira è **scollegato**. La connessione salvata (email + API token, cifrato con Windows DPAPI in `%APPDATA%\developerTest-UI\jira.json`, fuori da qualsiasi repository) si riattiva con **Riconnetti**; "Scollega" la disattiva senza cancellarla, il cestino la dimentica. Le credenziali già presenti in Gestione credenziali di Windows si cercano solo se premi il pulsante dedicato e si leggono ogni volta da Windows (nessuna copia). Le query salvate sono personali e compaiono solo a Jira collegato. Ciò che è configurato viene **verificato** quando lo riconnetti.
- **Skill del progetto:** se il progetto ha già le sue skill o comandi (`.claude/skills`, `.claude/commands`) la UI li riconosce, propone quella giusta (es. `implement-test`, `implementing-tests`) e la lancia con gli argomenti scelti nella scheda Progetto (chiave, titolo o testo completo, o un modello tuo). Il kit di Aletheia viene aggiunto solo se il progetto non ha nulla di proprio, o su richiesta esplicita. Con skill diverse da quella di Aletheia gli step 0-8 non si mostrano: si vede l'attività.
- **Automatizza** non fa altro che avviare la stessa pipeline della scheda Esecuzione (la skill scelta) sul ticket (chiave, titolo, descrizione secondo gli argomenti). Gli allegati di Jira non vengono scaricati. Se nel progetto esiste già un test con quel nome (es. `NX_2.java` per NX-2) viene segnalato e chiesto di confermare.
- **Nuovo progetto:** il wizard chiede anche il **repository Maven del framework** (indirizzo `https://…` che ti dà il team che lo gestisce): l'app lo ricorda per i prossimi progetti (variabile `UI_FRAMEWORK_REPO` per forzarlo) e lo scrive nel `pom.xml` e nel profilo.
- **Server MCP:** dopo l'aggiunta di un server la UI propone di configurarlo. Nella scheda **Credenziali e scheda…** imposti le variabili richieste (cifrate con DPAPI, mai nel repository né nel `.mcp.json`) e puoi creare una **scheda** per usare i suoi tool dalla UI, scritta da Claude (una richiesta a Sonnet) o semplice. La scheda è un file di dati, non codice. I tool che possono modificare dati chiedono sempre conferma. Sono gestiti solo i server locali (stdio).
- **Editor pipeline:** da Progetto → **Modifica pipeline e agent…** si modificano skill e agent del progetto (controlli secondo le convenzioni di Claude Code, copia di sicurezza in `.tmp\pipeline-backup\`), se ne creano di nuovi anche con la bozza di Claude, si collega un agent a una skill con proposta da approvare e si definiscono gli step mostrati nell'avanzamento (salvati nel progetto, in `.claude\pipeline-steps.json`).
- Per ricompilare l'eseguibile (`NexsoftAutomationCockpit.exe`): `powershell -File ui\build-exe.ps1`.

## Sviluppo

Il prodotto gira solo con Node (nessuna dipendenza a runtime). `npm install` serve solo per costruire il pacchetto (esbuild e javascript-obfuscator).

| Comando | Cosa fa |
|---|---|
| `npm start` | avvia il server dai sorgenti |
| `npm test` | unit (mascheramento segreti), flow (finestre in diretta, Demo/Jira), prova di fumo |
| `npm run dist` | costruisce `.tmp/dist/NexsoftAutomationCockpit` (backend unito e offuscato) |
| `npm run dist:zip` | come sopra e crea `.tmp/NexsoftAutomationCockpit.zip` (serve Python) |
| `npm run test:dist -- .tmp/dist/NexsoftAutomationCockpit` | prova di fumo sul pacchetto costruito |

I test preparano da soli licenza di prova (chiave creata al volo), progetto, finto Jira, finto server MCP e finto `claude` in `.tmp/test`. Non toccano i dati reali in `%APPDATA%`.

### Struttura del repository

```
src/server/main.js        gateway: server HTTP, controlli comuni (accesso, permessi), smistamento alle aree
src/server/http/          auth.js (token, cookie, Origin/Host), caps.js (permessi per rotta), static.js, route.js
src/server/gateway/       system.js: rotte che mettono insieme più aree (versione, diagnostica, IDE, chiusura)
src/server/gateway/remote.js   aree che girano come servizi separati: avvio, inoltro, controlli (default: jira)
src/server/supervisor.js    avvia i servizi come processi figli, li controlla e li riavvia se cadono
src/server/service-host.js  espone su pipe con nome le rotte di un'area; service-entries/<area>.js è il punto d'ingresso del processo
src/server/state.js       stato per utente (progetto agganciato, recenti, origini, scelte) salvato in %APPDATA%
src/server/infra/         paths.js (cartelle e dati), claude.js (unico punto che lancia claude), proc.js (kill dell'albero)
src/server/areas/         un'area per ambito, ognuna con interfaccia pubblica (index.js) e le proprie rotte:
  license/                licenza e profili
  jira/                   connessione, query e ticket
  scm/                    git e origini (GitHub/GitLab), clone
  mcp/                    server MCP del progetto: credenziali, tool, schede, domande a Claude
  pipelines/              editor di skill e agent
  project/                progetto attivo, wizard, configurazione, JDK, cambio progetto
  tools/                  scheda Tool: rilevati, catalogo, registro MCP
  session/                sessione con claude: processo, eventi SSE, in diretta, permessi, Ask Claude, redact
  demo/                   modalità Demo e simulatore (sim.js)
  platform/               versione, report di diagnostica, apertura in IntelliJ
src/server/assets/        catalog.json, skill-steps.json, version.json, templates/
src/web/                  index.html (solo markup) + css/app.css + js/*.js (uno per scheda; boot.js per ultimo), pipelines.html, mcp.html
launcher/                 Launcher.cs e build-exe.ps1 (eseguibile)
kit/                      skill e agent forniti ai progetti
build/                    build-dist.js (pacchetto offuscato), zip.py
test/                     unit, flow, smoke, fixtures (finti Jira, MCP e claude)
tools/license.js          strumento di chi emette le licenze (la chiave privata non sta nel repository)
```

Gli script della pagina sono script classici che condividono lo stesso ambito globale: in un solo file le funzioni sono disponibili fin dall'inizio, con più file un'istruzione eseguita al caricamento può usare solo ciò che è già stato caricato. Per questo le istruzioni di avvio stanno in `js/boot.js`, l'ultimo script.

Servizi: le aree si possono eseguire come processi separati che comunicano con il gateway tramite **pipe con nome** (HTTP senza porte di rete, nome casuale a ogni avvio, token obbligatorio, diritti limitati all'utente). Oggi gira come servizio **Jira**; `NACP_SERVICES=` (vuoto) o `NACP_INPROC=1` riportano tutto in un solo processo, e se un servizio non parte l'area resta nel gateway. Se un servizio cade viene riavviato (la Demo viene ripristinata); se il gateway cade, i servizi si chiudono da soli. `npm test` prova la modalità a servizi, `npm run test:inproc` quella a processo unico.

Architettura (imposta da `test/unit/architecture-test.js`): tra aree si importa solo `areas/<area>/index.js` e solo lungo le dipendenze dichiarate nel test; nessun ciclo; le aree non importano il gateway; il nucleo (`infra`, `state`) non importa aree. Una nuova funzione = rotta nell'area giusta + logica nell'area. Le aree sono i punti in cui, se servisse, il server si potrebbe dividere in processi separati.

Regole: chi lancia `claude` usa `infra/claude.js`; percorsi e dati utente passano solo da `infra/paths.js`; un test (`test/unit/caps-test.js`) blocca ogni cambiamento involontario dei permessi per rotta e `test/flow/routes-golden.json` registra stato e messaggi delle rotte.
