// Punto d'ingresso del servizio Pipelines (editor di skill e agent): processo separato lanciato dal supervisore (vedi gateway/remote.js).
// Nel pacchetto distribuito questo file viene unito e offuscato in ui/services/pipelines.js.
// Non legge lo stato dell'app: il progetto arriva dal gateway in ogni richiesta (ctx.context). I lavori in corso (bozze, correzioni) vivono qui.
const { runService } = require('../service-host');
const pipelinesRoutes = require('../areas/pipelines/routes');

runService({ name: 'pipelines', pipe: process.env.NACP_PIPE, token: process.env.NACP_TOKEN, routes: pipelinesRoutes })
  .catch((e) => { console.error(e); process.exit(1); });
