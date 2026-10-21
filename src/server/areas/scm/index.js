// Interfaccia pubblica dell'area 'scm': gli altri moduli importano solo da qui, mai dai file interni. I moduli si caricano al primo uso (un servizio non trascina l'intera area).
module.exports = {
  get git() { return require('./git'); },
  get repos() { return require('./repos'); },
};
