// Punto d'ingresso del servizio Project: controlli, piano e verifica del wizard, preparazione, test esistenti, configurazione e accesso a Claude,
// in un processo separato lanciato dal supervisore (vedi gateway/remote.js). Nel pacchetto distribuito è unito e offuscato in ui/services/project.js.
// Non legge lo stato dell'app: progetto, preferenze e permessi arrivano dal gateway in ogni richiesta (ctx.context).
// Aggancio, scelta di skill e JDK sono del gateway (gateway/project.js). La creazione di un progetto passa da qui con due controlli:
// il servizio scrive i file, il gateway poi aggancia il progetto e ricorda il repository del framework.
const { runService } = require('../service-host');
const projectRoutes = require('../areas/project/routes');
const { projects } = require('../areas/project');

runService({
  name: 'project', pipe: process.env.NACP_PIPE, token: process.env.NACP_TOKEN, routes: projectRoutes,
  controls: {
    'create-project': (body) => projects.createProject(body),
    'configure-existing': (body) => projects.configureExisting(body),
  },
}).catch((e) => { console.error(e); process.exit(1); });
