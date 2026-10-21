// Interfaccia pubblica dell'area 'tools': gli altri moduli importano solo da qui, mai dai file interni. I moduli si caricano al primo uso (un servizio non trascina l'intera area).
module.exports = {
  get tools() { return require('./tools'); },
  get registry() { return require('./registry'); },
};
