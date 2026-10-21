/* ---------- allegati ---------- */
const MAX_FILES = 10, MAX_TOTAL = 25 * 1024 * 1024;
const kb = (n) => n < 1048576 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
function makePicker(listEl) {
  const files = [];
  const render = () => listEl.replaceChildren(...files.map((f, i) => {
    const li = document.createElement('li');
    const n = document.createElement('span'); n.textContent = f.name; n.title = f.name;
    const s = document.createElement('small'); s.textContent = kb(f.size);
    const x = document.createElement('button'); x.type = 'button'; x.textContent = '×'; x.title = 'Rimuovi';
    x.onclick = () => { files.splice(i, 1); render(); };
    li.append(n, s, x);
    return li;
  }));
  return {
    files,
    add(list) {
      for (const f of list) {
        if (files.length >= MAX_FILES) { add('warn', `Massimo ${MAX_FILES} allegati.`); break; }
        if (files.reduce((a, p) => a + p.size, f.size) > MAX_TOTAL) { add('warn', `${f.name}: superato il limite di 25 MB totali.`); continue; }
        if (!files.some((p) => p.name === f.name)) files.push(f);
      }
      render();
    },
    clear() { files.length = 0; render(); },
    async encode() { return Promise.all(files.map(async (f) => ({ name: f.name, data: await toBase64(f) }))); },
  };
}
const toBase64 = (file) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(',')[1] || '');
  r.onerror = () => rej(r.error);
  r.readAsDataURL(file);
});
const startFiles = makePicker($('filelist'));
const replyFiles = makePicker($('replylist'));

$('drop').onclick = () => $('files').click();
$('drop').onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('files').click(); } };
$('files').onchange = (e) => { startFiles.add(e.target.files); e.target.value = ''; };
['dragover', 'dragenter'].forEach((t) => $('drop').addEventListener(t, (e) => { e.preventDefault(); $('drop').classList.add('over'); }));
['dragleave', 'drop'].forEach((t) => $('drop').addEventListener(t, (e) => { e.preventDefault(); $('drop').classList.remove('over'); }));
$('drop').addEventListener('drop', (e) => startFiles.add(e.dataTransfer.files));
$('attach').onclick = () => $('replyfiles').click();
$('replyfiles').onchange = (e) => { replyFiles.add(e.target.files); e.target.value = ''; };

