// Interfaccia pubblica dell'area 'project': gli altri moduli importano solo da qui, mai dai file interni. I moduli si caricano al primo uso (un servizio non trascina l'intera area).
module.exports = {
  get projects() { return require('./projects'); },
  get config() { return require('./config'); },
  get jdks() { return require('./jdks'); },
  get activate() { return require('./activate').activate; },
  get projectInfo() { return require('./project-routes').projectInfo; },
};
