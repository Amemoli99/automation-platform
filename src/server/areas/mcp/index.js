// Interfaccia pubblica dell'area 'mcp': gli altri moduli importano solo da qui, mai dai file interni.
module.exports = {
  client: require('./client'),
  env: require('./env'),
  panels: require('./panels'),
  ask: require('./ask'),
};
