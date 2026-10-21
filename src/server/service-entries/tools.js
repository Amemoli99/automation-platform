// Punto d'ingresso del servizio Tools: avvia l'area 'tools' come processo separato (lo lancia il supervisore, vedi gateway/remote.js).
// Nel pacchetto distribuito questo file viene unito e offuscato in ui/services/tools.js.
// Non legge lo stato dell'app: progetto, preferenze e Demo arrivano dal gateway in ogni richiesta (ctx.context).
const { runService } = require('../service-host');
const toolsRoutes = require('../areas/tools/routes');

runService({ name: 'tools', pipe: process.env.NACP_PIPE, token: process.env.NACP_TOKEN, routes: toolsRoutes })
  .catch((e) => { console.error(e); process.exit(1); });
