// Punto d'ingresso del servizio Repos: origini Git (GitHub/GitLab), elenco dei repository e clone, in un processo separato
// lanciato dal supervisore (vedi gateway/remote.js). Nel pacchetto distribuito è unito e offuscato in ui/services/repos.js.
// Le origini salvate sono dell'area (sources.json): il servizio non legge lo stato dell'app. L'aggancio del progetto clonato lo fa il gateway.
const { runService } = require('../service-host');
const reposRoutes = require('../areas/scm/repos-routes');

runService({
  name: 'repos', pipe: process.env.NACP_PIPE, token: process.env.NACP_TOKEN, routes: reposRoutes,
  controls: { clone: (body) => reposRoutes.cloneOnly(body) }, // il gateway chiede il clone e poi aggancia il progetto
}).catch((e) => { console.error(e); process.exit(1); });
