// Punto d'ingresso del servizio Session: la sessione di lavoro con `claude` (processo, eventi in diretta, permessi, domande a margine, Demo)
// in un processo separato lanciato dal supervisore (vedi gateway/remote.js). Nel pacchetto distribuito è unito e offuscato in ui/services/session.js.
// Non legge lo stato dell'app: progetto, preferenze e Demo arrivano dal gateway in ogni richiesta (ctx.context). Il gateway sa se una sessione
// è in corso da un messaggio che questo servizio gli manda a ogni cambio (git e cambio progetto ne hanno bisogno).
const { runService } = require('../service-host');
const sessionRoutes = require('../areas/session/routes');
const { session } = require('../areas/session');

session.hooks.onRunning = (running) => { if (process.send) process.send({ type: 'running', running }); };

runService({
  name: 'session', pipe: process.env.NACP_PIPE, token: process.env.NACP_TOKEN, routes: sessionRoutes,
  controls: {
    reset: () => { session.reset(); return { ok: true }; }, // progetto o Demo cambiati
    status: () => ({ status: session.getStatus() }),
  },
  onShutdown: () => session.stop(), // ferma claude con i suoi figli
}).catch((e) => { console.error(e); process.exit(1); });
