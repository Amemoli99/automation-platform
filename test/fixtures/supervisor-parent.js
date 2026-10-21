// Processo "gateway" di prova: avvia un servizio, scrive il pid del figlio su stdout e resta in vita finché non viene ucciso.
const path = require('path');
const { createSupervisor } = require('../../src/server/supervisor');

const sup = createSupervisor({ services: { echo: { script: path.join(__dirname, 'echo-service.js') } } });
sup.start().then(() => {
  console.log(JSON.stringify(sup.status().echo));
  setInterval(() => {}, 1000);
}).catch((e) => { console.error(e.message); process.exit(1); });
