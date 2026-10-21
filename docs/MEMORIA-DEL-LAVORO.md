# Memoria del lavoro svolto su NACP

Aggiornata al 21/10/2026. Serve a riprendere il lavoro senza rileggere le conversazioni: cosa è stato fatto, perché, cosa è stato trovato per strada, cosa resta. Per la struttura attuale vedi [ARCHITETTURA.md](ARCHITETTURA.md).

## 1. Il prodotto e dove sta

**Nexsoft Automation Cockpit Platform (NACP)**: interfaccia locale (browser) che pilota Claude Code per sviluppare test automatici a partire da un ticket. Scritta in **JavaScript su Node.js** (server e pagine), con un launcher in **C#** (`.exe`); nessuna dipendenza a runtime.

| Cosa | Dove |
|---|---|
| Versione ufficiale (repository Git) | `C:\Users\hp\Documents\developerTest-UI` → GitHub `Amemoli99/automation-platform` (privato) |
| Esecuzioni parallele (git worktree) | `…\developerTest-UI-parallel`, porta 4175 |
| Versione generica (solo Claude + Jira) | `…\NexsoftClaudeCockpit`, porta 4176 |
| Dati dell'utente | `%APPDATA%\developerTest-UI` (nome storico, mantenuto per non perdere credenziali) |
| Pacchetto per i colleghi | `C:\Users\hp\Documents\NexsoftAutomationCockpit.zip` (offuscato, ricostruito il 21/10/2026) |

**Solo la versione ufficiale ha** finestre in diretta, narrazione in italiano, repository Git, riordino e architettura a servizi. Parallel e Generica sono rimaste com'erano.

## 2. Cronologia

### Prima di questo ciclo (sintesi)
- **Usabilità**: wizard di nuovo progetto in 4 passi, profilo «da compilare» spiegato in italiano, origini Git e Jira che partono **scollegate**, sgancio automatico del progetto alla chiusura (anche senza git).
- **Editor di pipeline**: modifica di skill e agent secondo le convenzioni di Claude Code, collegamento agent-skill con step, bozze scritte da Claude.
- **Tool e MCP**: scheda Tool, aggiunta di server MCP dal catalogo o dal registro ufficiale, credenziali cifrate con DPAPI, schede dei server generate da Claude.
- **Distribuzione**: zip con backend unito e offuscato (esbuild + javascript-obfuscator), exe, prova di fumo sul pacchetto estratto; zip separato per la versione generica. Rimossi tutti i riferimenti a clienti.
- **Correzioni**: Demo + Jira («Jira non è collegato»: la Demo deve sostituire ogni funzione di Jira che dipende dal collegamento).

### 21/10/2026 — Finestre in diretta e narrazione
- Scheda Esecuzione con due finestre stile terminale: *Claude sta scrivendo* e *azione* (comando, codice, output).
- `claude` lanciato con `--include-partial-messages`; eventi `live` come istantanee (non bufferizzati) + replay per chi si ricollega.
- **Mascheramento dei segreti** sull'intero testo accumulato (token spezzati su più pezzi), valori noti da `.env` e credenziali MCP, coda incompleta nascosta in diretta. Limite: segreti sconosciuti senza prefisso o nome riconoscibile non sono rilevabili.
- **Narrazione in italiano** costruita dall'app (nessun costo): «Sto leggendo il file X», «Sto modificando Y: tolgo 2 righe…», «Comando concluso in 8 s», «Sto aspettando una tua risposta».

### 21/10/2026 — Repository Git e riordino (passi 1–7)
Richiesta: un progetto ordinato da aprire in un IDE e con pattern chiari. Primo commit `034696b`.

| Passo | Cosa | Commit |
|---|---|---|
| 1 | `package.json`, `build/`, `test/` tracciati (prima vivevano in una cartella temporanea) | `f6b6a69` |
| 2 | un solo modulo per cartelle e dati (`infra/paths.js`) | `ba4d9b0` |
| 3 | un solo punto per lanciare `claude` e fermare i processi | `8c733f8` |
| 4–5 | spostamento in `src/server`, `src/web`, `launcher/` con `git mv` | `aca3bcc`, `7da562d` |
| 6 | `server.js` (976 righe) diviso: permessi, accesso, stato, sessione, rotte per area; `main.js` → 124 righe | `80b696e`…`65902ec` |
| 7 | `index.html` (4135 righe) → markup + CSS + 17 script per scheda | `e531f45` |

Prima di spezzare `server.js` sono stati scritti i test che non c'erano: registro di stato e messaggio di 72 rotte, permessi per rotta, accesso con token, sgancio alla chiusura, permessi concessi e domande a margine.

### 21/10/2026 — Launcher dal repository
`Launcher.cs` cerca `ui\server.js` (pacchetto) e poi `src\server\main.js` (repository); `npm run exe` lo compila; `npm run test:exe` lo prova (`25c85ac`).

### 21/10/2026 — Aree con confini imposti
Scelta dell'utente: **niente monolite**. Primo passo: 10 aree con interfaccia pubblica, test di architettura (`ALLOWED`), disaccoppiamento di sessione, progetto e origini con `state.running` ed evento `reset` (`f2bbddb`, `6ff73ac`).

### 21/10/2026 — Architettura a servizi (9 passi)
Canale scelto dall'utente: **pipe con nome**. Un servizio per volta, con un test dedicato, la suite in tre modalità e un confronto sui dati reali prima di renderlo predefinito.

| Passo | Servizio | Commit | Nota |
|---|---|---|---|
| 1 | infrastruttura | `60e208b` | pipe, token, supervisore, inoltro, 31 verifiche |
| 2 | **jira** | `83b4989` | Demo propagata con un controllo; ripiego in-process |
| 3 | **tools** | `8178b41` | nasce il *contesto della richiesta* |
| 4 | **pipelines** | `5e5e865` | |
| 5 | **git** | `4e3b866` | permessi e «sessione in corso» nel contesto |
| 6 | **mcp** | `dfbf32e` | cache credenziali per processo, `onShutdown` per i server MCP figli |
| 7 | **repos** | `086cd05` | origini in `sources.json` con migrazione; clone diviso servizio/gateway |
| 8 | **project** | `96ad166` | aggancio, preferenze e creazione restano nel gateway |
| 9 | **session** | `ee0731d` | `claude`, SSE, permessi; stato «in corso» al gateway via IPC |

La **licenza non è stata staccata**: il gateway la usa a ogni richiesta e in modo sincrono.

## 3. Problemi trovati e risolti (da non ripetere)

| Problema | Causa | Soluzione |
|---|---|---|
| `jdks is not defined` | import mancante dopo lo spostamento; il controllo dei nomi ignorava gli usi con spread (`...jdks.x`) | import aggiunto; `scope-test` permanente che vede anche lo spread |
| La pagina si rompeva dopo la divisione in script | l'*hoisting* delle funzioni vale solo dentro un file: `api.js` chiamava `updateBtw` di un file successivo | istruzioni di avvio in `js/boot.js`, caricato per ultimo |
| Test che falliva a caso senza messaggio | crash di libuv su Windows (`UV_HANDLE_CLOSING`) uscendo con `process.exit` dopo `fetch` | uscita differita nei test |
| **Origini Git perse al primo salvataggio dello stato** | `saveState` riscriveva `active-project.json` senza le origini prima della migrazione | `saveState` conserva le chiavi sconosciute; migrazione in `sources.json`, provata sui dati reali |
| Catalogo di Tools **vuoto nel pacchetto** (senza errori) | i bundle dei servizi stanno in `ui/services/`: `paths.js` cercava risorse e kit nella cartella sbagliata | `PKG_UI` in `paths.js`; il test controlla che il catalogo non sia vuoto |
| Report di diagnostica in errore | `.catch` su un valore non-promessa quando la sessione non è un servizio | uso di `safe()` |
| Test del servizio che passava per il motivo sbagliato | contesto falso e valori vuoti | ogni test di servizio verifica che un contesto falso sia ignorato e che le risorse non siano vuote |
| Backslash dimezzati negli script da shell | heredoc della shell | file con percorsi Windows scritti con l'editor |

## 4. Test

Oltre 500 verifiche automatiche, tutte verdi alla chiusura: `unit` (mascheramento 27, permessi 109 rotte, nomi, architettura, pipe e supervisore 31), `flow` (diretta 16, Demo+Jira 12, pagine e risorse 38, accesso 12, permessi e domande 11, sgancio 7, rotte 72 identiche al registro, un test per ogni servizio), `smoke` (35), `launcher` (8).

La suite gira in **tre modalità** e deve dare lo stesso risultato: servizi (default), processo unico (`--inproc`), pacchetto offuscato (`--dist`, anche su uno zip estratto in una cartella pulita).

Confronto «prima/dopo» sui dati reali dell'utente (copia in cartella temporanea): rotte di sola lettura, schede, stato git, origini, anteprima con le sue preferenze, server MCP: tutto identico tra processo unico e servizi.

## 5. Misure (pacchetto, 21/10/2026)

| | Processo unico | Servizi |
|---|---|---|
| Processi `node` | 2 | 10 |
| Memoria totale | circa 123 MB | circa 565 MB |
| Avvio fino alla pagina | da 0,6 a 2,2 s | da 1,0 a 2,7 s |

Il costo reale dei servizi è la **memoria (circa 4,5 volte)**; l'avvio varia da una misura all'altra e non mostra una differenza chiara.

## 6. Limiti noti e cose aperte

1. **Il `claude` vero non è mai stato provato dopo il riordino.** Tutta la sessione è stata verificata con finti `claude` e con la Demo: messaggi parziali reali, permessi veri e domande a margine con la CLI di Anthropic non sono stati visti.
2. **Segnalazione non riprodotta**: l'utente ha detto «l'app non funziona più come prima». Il confronto sulle rotte e sulle schede era identico; l'unico errore reale trovato è `jdks is not defined` (corretto). Servono l'azione e il messaggio d'errore (finestra nera di Node).
3. **Parallel e Generica** non hanno nessuna di queste modifiche; il passo «unificare le tre versioni come edizioni dello stesso codice» non è stato fatto (serve capire la differenza reale della Generica, circa 1800 righe sul server, e il via per toccare quelle cartelle).
4. I collegamenti delle origini Git si azzerano anche quando cade il servizio Repos (prima solo a ogni avvio).
5. `mcp.panels` chiede la bozza a Claude alla propria copia di `pipelines`: il blocco «una bozza alla volta» è per processo.
6. Non provati: elenco e clone da un GitHub/GitLab vero, push e merge verso un remoto vero, creazione di un progetto con git e Maven veri, server MCP reali avviati con `npx`.
7. Segreti sconosciuti (senza prefisso né nome riconoscibile) non si possono mascherare nell'output in diretta.
8. Il README che finisce nello zip è quello del repository.

## 7. Come riprendere

```
git pull                      # nel clone
npm install                   # serve solo per costruire il pacchetto
npm start                     # dai sorgenti → http://127.0.0.1:4173/ (l'indirizzo con ?t=… è nella console)
npm run exe                   # compila l'exe (poi doppio clic)
npm test                      # suite completa con i servizi
npm run test:inproc           # stessa suite con tutto in un processo
npm run dist:zip              # costruisce .tmp/NexsoftAutomationCockpit.zip (serve Python)
npm run test:dist -- .tmp/dist/NexsoftAutomationCockpit
```

Per tornare al processo unico in caso di problemi: variabile `NACP_INPROC=1`.

Prima mossa consigliata: provare l'exe con una **pipeline reale**; se qualcosa si rompe, il messaggio della finestra di Node dice dove.

## 8. Decisioni di fondo (e perché)

- **Niente monolite** (richiesta dell'utente) ma **niente microservizi su tutto**: un gateway unico e servizi per area, perché lo strumento è locale e a utente singolo; il costo accettato è memoria e numero di processi.
- **Pipe con nome**, non porte di rete: nessuna porta da scoprire; resta il limite dei programmi dello stesso utente.
- **Il gateway tiene lo stato** e lo passa come *contesto*; i servizi non lo leggono mai, il browser non può falsificarlo.
- **Via di fuga sempre disponibile**: `NACP_INPROC=1`, e ripiego in-process se un servizio non parte.
- **Ogni passo con rete di sicurezza**: prima il test, poi lo spostamento; ogni servizio provato in tre modalità e sui dati reali.
- **Un'area alla volta** e un commit per passo, per poter tornare indietro.
