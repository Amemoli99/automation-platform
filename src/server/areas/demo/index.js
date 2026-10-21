// Interfaccia pubblica dell'area 'demo': gli altri moduli importano solo da qui, mai dai file interni. I moduli si caricano al primo uso (un servizio non trascina l'intera area).
module.exports = {
  get demo() { return require('./demo'); },
  get mode() { return require('./mode'); },
};
