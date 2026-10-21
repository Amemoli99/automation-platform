// Interfaccia pubblica dell'area 'license': gli altri moduli importano solo da qui, mai dai file interni. I moduli si caricano al primo uso (un servizio non trascina l'intera area).
module.exports = {
  get license() { return require('./license'); },
};
