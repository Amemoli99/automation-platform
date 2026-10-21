// Segnale "questa area non gestisce la richiesta": il router passa alla successiva. Qualunque altro valore (anche undefined) vuol dire gestita.
const NOT_HANDLED = Symbol('not-handled');

// Progetto agganciato per questa richiesta (ctx.context lo costruisce il gateway dallo stato e lo passa anche ai servizi).
const needRoot = (ctx) => {
  if (!ctx.context || !ctx.context.root) throw new Error('Nessun progetto agganciato: scegline uno dalla scheda Progetto.');
  return ctx.context.root;
};

module.exports = { NOT_HANDLED, needRoot };
