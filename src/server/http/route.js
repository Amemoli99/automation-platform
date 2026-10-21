// Segnale "questa area non gestisce la richiesta": il router passa alla successiva. Qualunque altro valore (anche undefined) vuol dire gestita.
const NOT_HANDLED = Symbol('not-handled');

// Progetto agganciato per questa richiesta (ctx.context lo costruisce il gateway dallo stato e lo passa anche ai servizi).
const needRoot = (ctx) => {
  if (!ctx.context || !ctx.context.root) throw new Error('Nessun progetto agganciato: scegline uno dalla scheda Progetto.');
  return ctx.context.root;
};

// Verifica un permesso del profilo dai dati del contesto (il gateway li ricava dalla licenza: i servizi non la leggono).
const requireCap = (ctx, cap, what) => {
  const c = ctx.context || {};
  const ok = cap === 'admin' ? c.role === 'admin' : (c.caps || []).includes(cap);
  if (!ok) throw Object.assign(new Error('Il tuo profilo (' + (c.roleLabel || 'sconosciuto') + ') non consente ' + what + '.'), { denied: true });
};

// Preferenze di una cartella qualsiasi (es. il wizard lavora su un progetto non ancora agganciato).
const prefsOf = (ctx, dir) => ((ctx.context && ctx.context.allPrefs) || {})[String(dir || '').toLowerCase()] || {};

module.exports = { NOT_HANDLED, needRoot, requireCap, prefsOf };
