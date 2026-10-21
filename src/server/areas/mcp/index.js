// Interfaccia pubblica dell'area 'mcp': gli altri moduli importano solo da qui, mai dai file interni. I moduli si caricano al primo uso (un servizio non trascina l'intera area).
module.exports = {
  get client() { return require('./client'); },
  get env() { return require('./env'); },
  get panels() { return require('./panels'); },
  get ask() { return require('./ask'); },
};
