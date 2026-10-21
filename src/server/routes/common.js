// Segnale "questa area non gestisce la richiesta": il router passa alla successiva. Qualunque altro valore (anche undefined) vuol dire gestita.
const NOT_HANDLED = Symbol('not-handled');

module.exports = { NOT_HANDLED };
