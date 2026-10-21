// Interfaccia pubblica dell'area 'demo': gli altri moduli importano solo da qui, mai dai file interni.
module.exports = {
  demo: require('./demo'),
  mode: require('./mode'),
};
