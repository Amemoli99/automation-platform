// Interfaccia pubblica dell'area 'project': gli altri moduli importano solo da qui, mai dai file interni.
module.exports = {
  projects: require('./projects'),
  config: require('./config'),
  jdks: require('./jdks'),
  activate: require('./activate').activate,
  projectInfo: require('./project-routes').projectInfo,
};
