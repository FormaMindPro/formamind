// The entry point: fetching the data snapshot, live updates, the panel layout.

let latestData = null;

// --- The working dashboard's panels: the data is generate.js's shared snapshot (data.json / SSE) ---
const LX_PANELS = ["dash","interview","nodes","docs","economy","graphs"];
function renderPanels(d) {
  latestData = d;
  document.getElementById('interview').innerHTML = interviewHtml(d.interview);
  document.getElementById('nodes').innerHTML = formaHtml(d.formaCatalog);
  document.getElementById('docs').innerHTML = docsHtml(d);
  docsBind();
  document.getElementById('chain').innerHTML = chainHtml(d.chain);
  document.getElementById('structure').innerHTML = structureHtml(d.structure);
  document.getElementById('schema').innerHTML = schemaHtml(d.schema);
  document.getElementById('project').innerHTML = projectSettingsHtml(d.settings && d.settings.project);
  document.getElementById('engine').innerHTML = engineSettingsHtml(d.settings && d.settings.engine);
  // Economy: on top - the former main view (tiles, statuses, the arsenal and node spend...), below - the former "Economy"
  renderEconomy(d);
  // Graphs: the tab is drawn once - an open graph is not reloaded on every update
  if (!graphShown) {
    document.getElementById('graphs').innerHTML = `<nav class="side-tabs">${[['goals','app.graph.goals'],['arsenal','app.graph.arsenal'],['structure','app.graph.structure'],['resources','app.graph.resources'],['board','app.graph.board'],['manual','app.graph.manual'],['project','app.graph.project'],['central','app.graph.central']].map(([c,k]) => `<button class="side-tab" data-c="${c}">${t(k)}</button>`).join('')}</nav><div id="gp"></div>`;
    showGraph(graphShown = 'goals');
  }
}
function renderAll(d) { renderPanels(d); boardInit(d.board); dashInit(d); }
i18nInit().then(() => fetch('./data.json')).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(renderAll)
  .catch(err => { document.getElementById('main').textContent = t('app.loadFail', {err: String(err)}); });
// A language switch - redrawing the last data snapshot in the new language.
document.addEventListener('i18n', () => { if (latestData) renderAll(latestData); });
// Live updates: serve.js pushes the full snapshot on every card edit. The first message is the same data fetch gave.
if (window.EventSource) {
  let first = true;
  new EventSource('/events').onmessage = e => { if (first) { first = false; return; } renderAll(JSON.parse(e.data)); };
}

(function(){var h=document.querySelector("header");function s(){document.documentElement.style.setProperty("--hh",h.offsetHeight+"px")}s();new ResizeObserver(s).observe(h)})();
