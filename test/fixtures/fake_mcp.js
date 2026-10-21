// Finto server MCP (stdio, JSON-RPC su righe) per le prove: nessun pacchetto da installare.
const PAGES = [
  { id: '101', title: 'Guida al rilascio', space: { name: 'Team QA' }, excerpt: 'Passi per il rilascio' },
  { id: '102', title: 'Test plan 2026', space: { name: 'Team QA' }, excerpt: 'Piano dei test' },
  { id: '103', title: 'Architettura', space: { name: 'Dev' }, excerpt: 'Schema dei servizi' },
];
const TOOLS = [
  { name: 'confluence_search', description: 'Cerca pagine Confluence con una query di testo. Restituisce un elenco di pagine.', inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Testo da cercare' }, limit: { type: 'number' } }, required: ['query'] }, annotations: { readOnlyHint: true } },
  { name: 'confluence_get_page', description: 'Legge una pagina per id.', inputSchema: { type: 'object', properties: { page_id: { type: 'string' } }, required: ['page_id'] } },
  { name: 'confluence_create_page', description: 'Crea una nuova pagina.', inputSchema: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' }, draft: { type: 'boolean' } }, required: ['title'] } },
  { name: 'confluence_delete_page', description: 'Elimina una pagina.', inputSchema: { type: 'object', properties: { page_id: { type: 'string' } }, required: ['page_id'] }, annotations: { destructiveHint: true } },
];
let buf = '';
const send = (o) => process.stdout.write(JSON.stringify(o) + '\n');
process.stdin.on('data', (d) => {
  buf += d; let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line) continue;
    const m = JSON.parse(line);
    if (m.method === 'initialize') send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fake-confluence', version: '0.1' } } });
    else if (m.method === 'tools/list') send({ jsonrpc: '2.0', id: m.id, result: { tools: TOOLS } });
    else if (m.method === 'tools/call') {
      const tok = process.env.FAKE_TOKEN || '';
      const a = m.params.arguments || {};
      if (!tok) return send({ jsonrpc: '2.0', id: m.id, result: { isError: true, content: [{ type: 'text', text: 'Token mancante: imposta FAKE_TOKEN.' }] } });
      if (m.params.name === 'confluence_search') return send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: JSON.stringify({ results: PAGES.filter((p) => !a.query || p.title.toLowerCase().includes(String(a.query).toLowerCase())), tokenLen: tok.length }) }] } });
      if (m.params.name === 'confluence_get_page') { const p = PAGES.find((x) => x.id === a.page_id); return send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: p ? JSON.stringify(p) : 'Pagina non trovata' }], isError: !p } }); }
      return send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'Fatto: ' + m.params.name + ' ' + JSON.stringify(a) }] } });
    } else if (m.id != null) send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'metodo sconosciuto' } });
  }
});
process.stdin.on('end', () => process.exit(0));
