// Interfaccia pubblica dell'area 'scm': gli altri moduli importano solo da qui, mai dai file interni.
module.exports = {
  git: require('./git'),
  repos: require('./repos'),
};
