// finto claude per la bozza della scheda: risponde con un descrittore (con difetti da ripulire: tool inventato, campo inesistente)
// con --slow risponde dopo 5 secondi (per vedere la barra di avanzamento)
let inp = '';
process.stdin.on('data', (d) => (inp += d)).on('end', () => {
  const wait = process.argv.includes('--slow') ? 5000 : 0;
  setTimeout(() => {
    const draft = {
      title: 'Confluence', description: 'Cerca e leggi le pagine del wiki.',
      groups: [
        { title: 'Cerca', tools: [{ tool: 'confluence_search', label: 'Cerca pagine', help: 'Trova le pagine che contengono un testo.', fields: { query: { label: 'Testo da cercare', placeholder: 'es. rilascio' }, inventato: { label: 'x' } }, result: { type: 'list', itemsPath: 'results', titlePath: 'title', subtitlePath: 'space.name' } }] },
        { title: 'Leggi', tools: [{ tool: 'confluence_get_page', label: 'Leggi una pagina', help: 'Mostra una pagina dal suo id.', fields: { page_id: { label: 'Id della pagina' } }, result: { type: 'json' } }, { tool: 'tool_che_non_esiste', label: 'Fantasma' }] },
      ],
    };
    process.stdout.write(JSON.stringify({ result: 'Ecco la scheda:\n' + JSON.stringify(draft), is_error: false }));
  }, wait);
});
