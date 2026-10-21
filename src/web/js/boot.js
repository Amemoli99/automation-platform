// Avvio della pagina: gira per ultimo, quando tutte le funzioni degli altri script sono già dichiarate.
// (In un unico script le funzioni sono disponibili fin dall'inizio; con più script un'istruzione di avvio può usare solo ciò che è già stato caricato.)
clearLog();
setUi('idle');
fetch('/api/steps').then((r) => r.json()).then((s) => {
  DEFAULT_STEPS = s;
  renderSteps({});
  evtSrc = new EventSource('/api/events');
  evtSrc.onmessage = (m) => onEvent(JSON.parse(m.data));
});

call('/api/demo').then((d) => {
  demoOn = !!d.on;
  $('demo-btn').classList.toggle('on', demoOn);
  $('demo-btn').querySelector('span').textContent = demoOn ? 'Demo attiva' : 'Demo';
  $('demo-bar').hidden = !demoOn;
  let go = ''; try { go = sessionStorage.getItem('goDash'); sessionStorage.removeItem('goDash'); } catch { /* storage non disponibile */ }
  if (demoOn && go) gotoTab('dash');
}).catch(() => { /* server non raggiungibile: resta la UI normale */ }).then(loadLicense);
loadProject().then(() => { if (proj.info && !proj.info.attached) gotoTab('project'); });
