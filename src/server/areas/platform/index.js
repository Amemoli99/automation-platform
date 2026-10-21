// Interfaccia pubblica dell'area 'platform': gli altri moduli importano solo da qui, mai dai file interni. I moduli si caricano al primo uso (un servizio non trascina l'intera area).
module.exports = {
  get appinfo() { return require('./appinfo'); },
  get report() { return require('./report'); },
  get ide() { return require('./ide'); },
};
