// Punto d'ingresso del servizio MCP: i server MCP del progetto (credenziali, tool, chiamate, schede, domande a Claude) in un processo separato,
// lanciato dal supervisore (vedi gateway/remote.js). Nel pacchetto distribuito è unito e offuscato in ui/services/mcp.js.
// Non legge lo stato dell'app: progetto e preferenze arrivano dal gateway in ogni richiesta (ctx.context).
const { runService } = require('../service-host');
const mcpRoutes = require('../areas/mcp/routes');
const { client } = require('../areas/mcp');

// I server MCP avviati dal servizio sono suoi processi figli: alla chiusura vanno fermati, altrimenti restano in giro.
runService({ name: 'mcp', pipe: process.env.NACP_PIPE, token: process.env.NACP_TOKEN, routes: mcpRoutes, onShutdown: () => client.closeAll() })
  .catch((e) => { console.error(e); process.exit(1); });
