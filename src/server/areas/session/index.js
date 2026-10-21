// Interfaccia pubblica dell'area 'session': gli altri moduli importano solo da qui, mai dai file interni. I moduli si caricano al primo uso (un servizio non trascina l'intera area).
module.exports = {
  get session() { return require('./session'); },
  get redact() { return require('./redact'); },
};
