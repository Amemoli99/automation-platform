// Servizio di prova per il supervisore e le pipe: rotte semplici, un flusso SSE, una morte improvvisa e un errore di permesso.
// Modalità difettose (FLAKY_MODE): exit-at-start = esce subito; die-after-ready = dichiara di essere pronto e cade dopo 60 ms.
const { runService } = require('../../src/server/service-host');
const { NOT_HANDLED } = require('../../src/server/http/route');

let closedStreams = 0;
const mode = process.env.FLAKY_MODE || '';
if (mode === 'exit-at-start') { console.error('errore finto all\'avvio'); process.exit(2); }

runService({
  name: process.env.NACP_SERVICE, pipe: process.env.NACP_PIPE, token: process.env.NACP_TOKEN,
  routes: {
    async get({ req, res, json }) {
      if (req.url === '/api/echo/ping') return json(200, { pong: true, pid: process.pid });
      if (req.url === '/api/echo/stats') return json(200, { closedStreams });
      if (req.url === '/api/echo/die') { setTimeout(() => process.exit(3), 20); return json(200, { dying: true }); }
      if (req.url === '/api/echo/sse') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        let i = 0;
        const t = setInterval(() => { res.write('data: ' + (++i) + '\n\n'); if (i >= 50) { clearInterval(t); res.end(); } }, 80);
        res.on('close', () => { clearInterval(t); closedStreams++; });
        return;
      }
      return NOT_HANDLED;
    },
    async post({ req, json, body }) {
      if (req.url === '/api/echo/say') return json(200, { echo: body, bytes: JSON.stringify(body).length });
      if (req.url === '/api/echo/denied') throw Object.assign(new Error('non consentito'), { denied: true });
      if (req.url === '/api/echo/boom') throw new Error('errore del servizio');
      return NOT_HANDLED;
    },
  },
}).then(() => {
  if (mode === 'die-after-ready') setTimeout(() => process.exit(1), 60);
}).catch((e) => { console.error(e); process.exit(1); });
