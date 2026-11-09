// The "Nodes" tab: a plain list of the nodes and their default arsenal.
// The source is generate.js -> nodeConfig (.forma/dashboard/data/nodes.cjs, the adapters' nodeModels, the tools - the adapter catalog's roles).
// The runner role sets and the tab's design are a separate task.

function nodesHtml(nodes) {
  if (!nodes || !nodes.length) {
    return `<div class="chain-clean">${t('nodes.none')}</div>`;
  }
  const rows = nodes.map(n => n.empty ? `<tr class="engine-empty"><td colspan="6"><b>${esc(n.engine)}</b> <span class="set-empty">${t('nodes.noTable')}</span></td></tr>` : `<tr>
    <td>${esc(n.engine || '—')}</td>
    <td><b>${esc(n.node)}</b></td>
    <td>${n.model ? esc(n.model) : `<span class="set-empty">${t('nodes.notSet')}</span>`}</td>
    <td>${n.effort ? esc(n.effort) : `<span class="set-empty">${t('nodes.notSetN')}</span>`}</td>
    <td>${n.toolCount}</td>
    <td>${n.externalModel ? t('nodes.yes') : '—'}</td>
  </tr>`).join('');
  return `<p class="chain-lead">${t('nodes.lead')}</p>
  <table class="chain-table"><thead><tr><th>${t('nodes.th.engine')}</th><th>${t('nodes.th.node')}</th><th>${t('nodes.th.model')}</th><th>${t('nodes.th.effort')}</th><th>${t('nodes.th.tools')}</th><th>${t('nodes.th.external')}</th></tr></thead>
  <tbody>${rows}</tbody></table>`;
}
