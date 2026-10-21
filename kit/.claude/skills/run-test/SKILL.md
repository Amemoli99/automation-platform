---
name: run-test
description: Esegue un singolo test automatico e ne riporta l'esito. Invocata da implementTest dopo conferma dell'utente, o direttamente con "/run-test <nome test>". Mai lanciare i test fuori da questa skill.
---

# run-test

Esegue il test e riporta l'esito. Non modifica codice.

## Procedura

1. Leggi `run_cmd` e la cartella suite da `.claude/project-profile.md`. Se `TBD`, chiedi all'utente e fermati.
2. Risolvi la suite che contiene il test (cerca il nome nei file di `suite_dir`). Se più suite lo contengono o nessuna, chiedi quale usare.
3. Esegui in foreground, mirato al solo test, con il comando del profilo. Non aggiungere flag non richiesti.
4. Salva l'output completo in un file nella cartella temporanea della sessione; non incollare log lunghi in chat.

## Esito

```
STATUS: PASSED | FAILED | CANCELLED
TEST: <nome>
FAILING_STEP: <classe:riga o "—">
SIGNAL: <eccezione + messaggio, 1-3 righe>
LOG: <path del log completo>
```

Per FAILED estrai: tipo di eccezione, messaggio, primo frame del codice di test, ultimo step eseguito. Distingui se la causa è nel test o fuori (infrastruttura, rete, dipendenze, ambiente).
