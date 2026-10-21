// Interfaccia pubblica dell'area 'pipelines': gli altri moduli importano solo da qui, mai dai file interni.
module.exports = {
  pipelines: require('./pipelines'),
};
