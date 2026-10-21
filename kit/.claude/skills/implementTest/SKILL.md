---
name: implementTest
description: Orchestratore che implementa un test automatico da un ticket, end-to-end. Invocato con "/implementTest <ticket>". Esegue in sequenza Analyzer, Explorer, Coder, Validator più agenti di supporto I/O. Generico: tutto ciò che dipende dal progetto è in .claude/project-profile.md. Chiede conferma prima di ogni mossa ambigua o distruttiva.
---

# implementTest

Orchestratore "dal ticket al test eseguibile". Gira nel contesto principale (un subagent non può lanciarne altri). Tu coordini, decidi e chiedi; gli agent eseguono i compiti circoscritti.

## Input

Ticket (id, URL o testo). Se manca, chiedilo una volta e fermati. Un ticket alla volta.

## Step 0 — Profilo

Leggi `.claude/project-profile.md`. Se un valore necessario al prossimo step è `TBD`, chiedi all'utente e proponi di salvarlo nel profilo (non scrivere senza conferma). Non assumere valori mancanti.

## Step 1 — Branch (opzionale)

Solo se `branching` = sì. Delega a `test-git-branch`. `DIRTY` o `PULL_FAILED` → fermati e riporta all'utente. Nessun commit/push.

## Step 2 — Ticket (I/O)

Delega a `test-ticket-fetcher` secondo `ticket_source`. Verifica il risultato: il titolo/summary è la fonte di verità, non fidarti ciecamente di un singolo fetch (controllo incrociato quando possibile). Se il tracker non risponde o nega l'accesso, ripiega su `paste`: chiedi all'utente titolo, gruppo e descrizione/contratto. Mostra i dati e chiedi conferma.

## Step 3 — Analyzer

Delega a `test-analyzer` con ticket + allegati. Ottieni: scenario, mappa Reuse/Compose/Gap, ambiguità.
**GATE 1**: mostra lo scenario all'utente. Con ambiguità o non fattibilità dichiarata, fermati e chiedi. Procedi solo con conferma.

## Step 4 — Explorer

Delega a `test-explorer` con lo scenario confermato (e i Gap). Naviga l'app dal vivo (Playwright MCP) e restituisce mappa elementi/locator, flusso reale, attese, discrepanze, rischi.
- Tool Playwright assenti → fermati e avvisa.
- Discrepanze rispetto al ticket → fermati e chiedi: il flusso lo decide l'utente.
- Flusso sbagliato o elemento non identificabile con certezza → fermati e chiedi.

## Step 5 — Coder

Delega a `test-coder` con scenario + output dell'Explorer + profilo. Ottieni file creati/modificati e mappa step→codice.
Se servono modifiche a librerie condivise o a infrastruttura: fermati e chiedi permesso.

## Step 6 — Compilazione

Delega a `test-compile-checker`. `FAILED` → correggi la causa (tramite Coder), mai commentare righe né aggiungere stub per far passare. Non lanciare il build inline.

## Step 7 — Validator (review)

Delega a `test-validator` in modalità `review`: aderenza al contratto, valori vincolati, nessun file condiviso toccato. Difetti → torna al Coder.

## Step 8 — Esecuzione

Esecuzione automatica, senza gate: se compilazione `OK` e Validator `review` `OK`, invoca la skill `run-test` con il nome del test. Se compilazione o review non sono `OK`, non eseguire: torna al Coder o fermati e chiedi. Mai eseguire inline.

## Step 9 — Auto-retry su FAILED (max 3 tentativi totali)

1. Delega a `test-validator` in modalità `diagnose` con l'output del run.
2. Applica la correzione minima tramite `test-coder`, ricompila (Step 6), rilancia `run-test`.
3. Esaurito il budget: riporta ultimo errore, cosa è stato provato, ipotesi migliore, e chiedi come procedere.

Fermati subito (senza retry) se: causa fuori dal test (infrastruttura, rete, build, dipendenze); possibile bug reale del prodotto (decide l'utente); la correzione richiederebbe di cambiare il flusso descritto o indebolire un'assert.

## Step 10 — Chiusura ticket (opzionale, con gate)

Solo se `ticket_transition_on_pass` è attivo, il run è PASSED e l'utente conferma. Mai in automatico.

## Hard rules

- Mai commit, push, PR senza richiesta esplicita.
- Mai modificare librerie condivise/submodule né infrastruttura senza permesso.
- Mai sostituire valori vincolati dal ticket con random.
- Mai rendere verde un test indebolendolo.
- Mai riportare credenziali nell'output.
- Nessun comando in background mentre aspetti risposta dell'utente.
- Nel dubbio: fermati e chiedi. Meglio una pausa di un test sbagliato.

## Output finale (1-2 frasi + blocco)

```
Ticket:   <id> — <summary>
Test:     <path>
Nuovi:    <page/actions o "—">
Compile:  OK | FAILED
Run:      non eseguito | PASSED | FAILED
```
