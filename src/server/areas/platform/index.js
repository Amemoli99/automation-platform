// Interfaccia pubblica dell'area 'platform': gli altri moduli importano solo da qui, mai dai file interni.
module.exports = {
  appinfo: require('./appinfo'),
  report: require('./report'),
  ide: require('./ide'),
};
