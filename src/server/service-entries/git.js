// Punto d'ingresso del servizio Git: le rotte git del progetto (stato, commit, branch, merge, push) in un processo separato,
// lanciato dal supervisore (vedi gateway/remote.js). Nel pacchetto distribuito è unito e offuscato in ui/services/git.js.
// Non legge né stato né licenza: progetto, "sessione in corso" e permessi arrivano dal gateway in ogni richiesta (ctx.context).
const { runService } = require('../service-host');
const gitRoutes = require('../areas/scm/git-routes');

runService({ name: 'git', pipe: process.env.NACP_PIPE, token: process.env.NACP_TOKEN, routes: gitRoutes })
  .catch((e) => { console.error(e); process.exit(1); });
