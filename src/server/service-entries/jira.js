// Punto d'ingresso del servizio Jira: avvia l'area 'jira' come processo separato (lo lancia il supervisore, vedi gateway/remote.js).
// Nel pacchetto distribuito questo file viene unito e offuscato in ui/services/jira.js.
const { runService } = require('../service-host');
const jiraRoutes = require('../areas/jira/routes');
const { jira } = require('../areas/jira');
const { demo } = require('../areas/demo');

// La modalità Demo sostituisce le funzioni di Jira con dati simulati nel processo che le esegue: qui il gateway lo chiede con un messaggio.
let restore = null;
const controls = {
  demo({ on }) {
    if (on && !restore) restore = demo.patchJira(jira);
    if (!on && restore) { restore(); restore = null; }
    return { demo: !!restore };
  },
};

runService({ name: 'jira', pipe: process.env.NACP_PIPE, token: process.env.NACP_TOKEN, routes: jiraRoutes, controls })
  .catch((e) => { console.error(e); process.exit(1); });
