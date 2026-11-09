// The "Bort" tab. Every UI string goes through t()/cnt() from the dictionaries, the keys are `bort.*`.
// Caution: do not name local variables `t` - that is the translate function.

/* ===================== BORT ==========================================
   What sits on the bort of each node and of the session. Three tiers, and they do not mix:
   the node's arsenal is edited by the role file, the MCP servers are declared for the whole session at once,
   the window floor is the engine's, and does not obey us. Nothing has an "disable" button:
   the screen names the ADDRESS of the edit, while the edit goes the usual way - a card, `Kit`, the sync.
   ==================================================================== */

// The labels are computed on access, not at load: the language changes without a reload.
const VD = {
  live:    {cls:'vd-live',    get label(){ return t('bort.vd.live'); }},
  dead:    {cls:'vd-dead',    get label(){ return t('bort.vd.dead'); }},
  unknown: {cls:'vd-unknown', get label(){ return t('bort.vd.unknown'); }},
};

function vdPill(kind, n){
  return `<span class="vd ${VD[kind].cls}">${VD[kind].label}: ${n}</span>`;
}

function bortNodeHtml(n){
  const head = `<div class="bort-node-head">
    <span class="node-name" style="--node-color:var(--accent)">${esc(n.node)}</span>
    <span class="mono-cell">${esc(n.model || t('bort.noModel'))}${n.effort ? ' · ' + esc(n.effort) : ''}</span>
    <span class="spacer" style="flex:1"></span>
    ${n.inherits ? '' :
      `<span class="mono-cell">${t('bort.declared', {n: n.toolCount, w: fmt(n.weightTokens)})}</span>`}
  </div>`;

  if (n.inherits) {
    return `<div class="bort-node">${head}
      <div class="bort-tools"><span class="node-empty">${t('bort.inherits')}</span></div>
      <div class="bort-addr">${t('bort.addr', {file: esc(n.file)})}</div>
    </div>`;
  }

  // The order: first what is in use, then the provably redundant, then the unknown.
  const order = {live:0, dead:1, unknown:2};
  const tools = [...n.tools].sort((a,b) =>
    order[a.verdict] - order[b.verdict] || b.calls - a.calls || a.decl.localeCompare(b.decl));

  const chips = tools.map(tl => `<span class="bort-tool ${tl.verdict}" title="${esc(VD[tl.verdict].label)}${
      tl.ambiguous ? ' — ' + esc(t('bort.ambiguous')) : ''}">
      ${esc(tl.decl)}<span class="c">${tl.verdict === 'unknown' ? '?' : '×' + tl.calls}</span>${tl.ambiguous ? '<span class="c">≈</span>' : ''}
    </span>`).join('');

  const counts = `<div class="bort-node-head" style="border-top:1px solid var(--border-soft);border-bottom:none;padding-top:10px">
    ${n.counts.live ? vdPill('live', n.counts.live) : ''}
    ${n.counts.dead ? vdPill('dead', n.counts.dead) : ''}
    ${n.counts.unknown ? vdPill('unknown', n.counts.unknown) : ''}
    <span class="mono-cell">${n.nodeInLog
      ? t('bort.inLog', {attempts: cnt('count.attempts', n.calls)})
      : t('bort.notInLog')}</span>
    ${n.counts.dead ? `<span class="spacer" style="flex:1"></span><span class="mono-cell">${t('bort.wasted', {w: fmt(n.deadWeight)})}</span>` : ''}
  </div>`;

  const undecl = n.undeclared.length
    ? `<div class="bort-addr">${t('bort.undeclared', {list: n.undeclared.map(u => `<code>${esc(u.tool)}</code> ×${u.calls}`).join(', ')})}</div>`
    : '';

  return `<div class="bort-node">${head}<div class="bort-tools">${chips}</div>${counts}${undecl}
    <div class="bort-addr">${t('bort.addrNoOff', {file: esc(n.file)})}</div>
  </div>`;
}

function bortNodesHtml(b, withNodes = true){
  if (!b.source) {
    return `<div class="nodata">${t('bort.noSource')}</div>`;
  }

  let banner = '';
  if (!b.log.alive) {
    banner = `<div class="nodata">${t('bort.log.none', {unknown: `<span class="vd vd-unknown">${t('bort.vd.unknown')}</span>`})}</div>`;
  } else if (!b.log.usable) {
    banner = `<div class="nodata">${t('bort.log.empty', {unknown: `<span class="vd vd-unknown">${t('bort.vd.unknown')}</span>`})}</div>`;
  } else {
    const missing = b.nodes.filter(n => !n.nodeInLog).map(n => n.node);
    banner = `<div class="cov">
      <h3>${t('bort.cov.title', {nodes: cnt('count.nodes', b.totals.nodesInLog), total: b.totals.nodeCount})}</h3>
      <p>${t('bort.cov.hint')}${missing.length ? ' ' + t('bort.cov.missing', {names: missing.map(m => `<b>${esc(m)}</b>`).join(', ')}) : ''}</p>
      <div class="cov-legend">
        ${vdPill('live', b.totals.live)} ${vdPill('dead', b.totals.dead)} ${vdPill('unknown', b.totals.unknown)}
        <span>${t('bort.cov.total', {n: b.totals.toolCount, w: fmt(b.totals.weightTokens), dead: fmt(b.totals.deadWeight)})}</span>
      </div>
    </div>`;
  }

  const errs = b.log.errorCount
    ? `<div class="nodata">${t('bort.log.errors', {calls: cnt('count.callsOn', b.log.errorCount)})}</div>`
    : '';

  return banner + errs + (withNodes ? b.nodes.map(bortNodeHtml).join('') : '');
}

function bortSessionHtml(b){
  const rows = b.servers.filter(s => !s.broken).map(s => `<tr>
    <td class="mono-cell"><b>${esc(s.name)}</b></td>
    <td class="dim">${esc(s.transport)}</td>
    <td class="ttl" title="${esc(s.target)}">${esc(s.target || '—')}</td>
    <td class="dim">${esc(s.level || '—')}</td>
    <td class="mono-cell dim">${esc(s.source)}</td>
  </tr>`).join('');

  const scanned = b.mcpScanned || [];
  const fileCount = b.servers.filter(s => !s.broken).length;
  const scannedLine = scanned.length
    ? scanned.map(s => `<code>${esc(s.source)}</code> — ${s.broken ? t('bort.mcp.unparsed') : (s.exists ? t('bort.mcp.count', {n: s.count}) : t('bort.mcp.noFile'))}`).join(' · ')
    : '';

  const broken = b.servers.filter(s => s.broken)
    .map(s => `<div class="nodata">${t('bort.mcp.broken', {file: esc(s.source)})}</div>`).join('');

  const refRows = b.referenced.map(r => `<tr>
    <td class="mono-cell"><b>${esc(r.server)}</b></td>
    <td class="n">${r.toolCount}</td>
    <td class="dim">${r.nodes.map(esc).join(', ')}</td>
    <td>${r.inProjectConfig
      ? `<span class="vd vd-live">${t('bort.mcp.declared')}</span>`
      : `<span class="vd vd-unknown">${t('bort.mcp.notFound')}</span>`}</td>
  </tr>`).join('');

  return `${broken}
    <div class="ebox">
      <h3>${t('bort.mcp.title', {n: fileCount})}</h3>
      <p class="hint">${t('bort.mcp.hint')}${scannedLine ? ' ' + t('bort.mcp.scanned', {list: scannedLine}) : ''}</p>
      ${rows ? `<table class="etable"><thead><tr><th>${t('bort.th.server')}</th><th>${t('bort.th.transport')}</th><th>${t('bort.th.address')}</th><th>${t('bort.th.level')}</th><th>${t('bort.th.file')}</th></tr></thead><tbody>${rows}</tbody></table>`
             : `<div class="nodata">${t('bort.mcp.noneDeclared')}</div>`}
      <div class="nodata" style="margin-top:12px">${t('bort.mcp.incomplete', {n: fileCount})}</div>
    </div>
    <div class="ebox">
      <h3>${t('bort.ref.title')}</h3>
      <p class="hint">${t('bort.ref.hint')}</p>
      ${refRows ? `<table class="etable"><thead><tr><th>${t('bort.th.server')}</th><th class="n">${t('bort.th.tools')}</th><th>${t('bort.th.whose')}</th><th>${t('bort.th.state')}</th></tr></thead><tbody>${refRows}</tbody></table>`
                : `<div class="nodata">${t('bort.ref.none')}</div>`}
    </div>`;
}

/* The floor line. Drawn as a line, not a number, on purpose: the value is almost entirely
   the engine's own prompt, and there is nothing to admire in it. What is read is the SLOPE. */
function floorChartHtml(f){
  if (!f) {
    return `<div class="nodata">${t('bort.fl.notMeasured')}</div>`;
  }
  if (f.unavailable || !f.byDate || f.byDate.length === 0) {
    return `<div class="nodata"><b>${esc(f.unavailable ? (t('bort.fl.u.' + f.unavailable) === 'bort.fl.u.' + f.unavailable ? f.unavailable : t('bort.fl.u.' + f.unavailable)) : t('bort.fl.noData'))}.</b>
      ${t('bort.fl.newProject')}</div>`;
  }

  const pts = f.byDate;
  const W = 1000, H = 200, PL = 64, PR = 16, PT = 14, PB = 26;
  const vals = pts.map(p => p.floor);
  // The scale does NOT start at zero: from zero a 70-thousand line looks straight, and the slope -
  // the very thing the chart exists for - becomes invisible. The field is +/-8% on top and bottom.
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = Math.max(1, (hi - lo) * 0.25 || hi * 0.02);
  const y0 = lo - pad, y1 = hi + pad;
  const x = i => PL + (pts.length === 1 ? (W-PL-PR)/2 : i * (W - PL - PR) / (pts.length - 1));
  const y = v => PT + (H - PT - PB) * (1 - (v - y0) / (y1 - y0));

  const line = pts.map((p,i) => `${x(i).toFixed(1)},${y(p.floor).toFixed(1)}`).join(' ');
  const dots = pts.map((p,i) => `<circle class="fl-dot" cx="${x(i).toFixed(1)}" cy="${y(p.floor).toFixed(1)}" r="3">
    <title>${esc(p.date)} — ${t('bort.fl.dot', {n: fmt(p.floor)})}${p.sessions > 1 ? ' ' + t('bort.fl.lowest', {n: p.sessions}) : ''}</title></circle>`).join('');
  const grid = [y0 + (y1-y0)*0.15, (y0+y1)/2, y1 - (y1-y0)*0.15].map(v =>
    `<line class="fl-grid" x1="${PL}" y1="${y(v).toFixed(1)}" x2="${W-PR}" y2="${y(v).toFixed(1)}"/>
     <text class="fl-lbl" x="${PL-8}" y="${(y(v)+3).toFixed(1)}" text-anchor="end">${fmt(Math.round(v))}</text>`).join('');
  // Exactly three date labels - the first, the middle, the last: on thirteen points everything
  // else clumps into a mush and keeps the line from being seen.
  const ticks = [0, Math.floor((pts.length-1)/2), pts.length-1].filter((v,i,a) => a.indexOf(v) === i)
    .map(i => `<text class="fl-lbl" x="${x(i).toFixed(1)}" y="${H-6}" text-anchor="middle">${esc(pts[i].date)}</text>`).join('');

  const drift = f.drift;
  const driftWord = drift == null ? t('bort.fl.oneDot')
    : (drift > 0 ? t('bort.fl.grew', {n: fmt(drift)}) : drift < 0 ? t('bort.fl.fell', {n: fmt(-drift)}) : t('bort.fl.same'));

  return `<div class="floor-chart">
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      ${grid}<polyline class="fl-line" points="${line}"/>${dots}${ticks}
    </svg>
  </div>
  <div class="cov" style="margin-top:14px">
    <p>${t('bort.fl.stats', {days: cnt('count.days', pts.length), min: fmt(f.min), max: fmt(f.max), drift: driftWord})}
    ${f.ageHours != null ? t('bort.fl.age', {age: relTime(f.ageHours * 60)}) : ''}</p>
    <p>${t('bort.fl.reading')}</p>
  </div>`;
}

// The "Forma" node <-> the "Bort" node by name, case-insensitive. The bort is computed for one engine (the one with a call log).
function bortFind(b, name){
  return b && b.nodes ? b.nodes.find(n => n.node.toLowerCase() === String(name).toLowerCase()) || null : null;
}

// The load bar on the node's card: what is declared and the verdict in one badge.
function bortStripHtml(n, idx){
  let body, cls;
  if (n.inherits) { cls = 'bs-none'; body = `<span class="bs-main">${t('bort.strip.inherits')}</span>`; }
  else {
    const main = `<span class="bs-main">${t('bort.strip.main', {n: n.toolCount, w: fmt(n.weightTokens)})}</span>`;
    if (!n.nodeInLog) { cls = 'bs-none'; body = `${main}<span class="bs-pill">${t('bort.strip.noLog')}</span>`; }
    else if (n.counts.dead) { cls = 'bs-warn'; body = `${main}<span class="bs-pill">${t('bort.strip.dead', {n: n.counts.dead, w: fmt(n.deadWeight)})}</span>`; }
    else { cls = 'bs-ok'; body = `${main}<span class="bs-pill">${t('bort.strip.clean')}</span>`; }
  }
  return `<button class="bort-strip ${cls}" data-bi="${idx}" title="${esc(t('bort.strip.title'))}">${body}<span class="bs-go">›</span></button>`;
}

// The summary under the roles: tiles of the totals and a bar-row per node (in use / redundant / unknown in tokens per step).
function bortSummaryHtml(b){
  if (!b || !b.totals) return '';
  const tot = b.totals, unit = b.toolTokenCost || 720;
  const rows = b.nodes.filter(n => !n.inherits).sort((a, c) => c.weightTokens - a.weightTokens);
  const max = Math.max(1, ...rows.map(n => n.weightTokens));
  const pct = tot.weightTokens ? Math.round(100 * tot.deadWeight / tot.weightTokens) : 0;
  const tile = (num, lbl, cls = '') => `<div class="bs-tile ${cls}"><b>${num}</b><span>${lbl}</span></div>`;
  const seg = (k, n) => n ? `<i class="bs-seg ${k}" style="flex:${n * unit}" title="${VD[k].label}: ${n} × ≈${unit} ${t('bort.tok')}"></i>` : '';
  const bar = n => `<div class="bs-row"><span class="bs-name">${esc(n.node)}</span>
    <span class="bs-track" style="width:${Math.max(8, Math.round(100 * n.weightTokens / max))}%">${seg('live', n.counts.live)}${seg('dead', n.counts.dead)}${seg('unknown', n.counts.unknown)}</span>
    <span class="bs-val">≈${fmt(n.weightTokens)}${n.counts.dead ? ` <u>−${fmt(n.deadWeight)}</u>` : ''}</span></div>`;
  const inh = b.nodes.filter(n => n.inherits).map(n => esc(n.node));
  return `<section class="forma-sec forma-sec--sum"><h2 class="forma-h">${t('bort.sum.title')}</h2>
    <div class="bs-tiles">
      ${tile(fmt(tot.weightTokens), t('bort.sum.weight'))}
      ${tile('−' + fmt(tot.deadWeight), t('bort.sum.save', {pct}), tot.deadWeight ? 'warn' : 'ok')}
      ${tile(tot.toolCount, t('bort.sum.declared'))}
      ${tile(tot.live + ' / ' + tot.dead + ' / ' + tot.unknown, t('bort.sum.split'))}
    </div>
    <div class="bs-bars">${rows.map(bar).join('')}</div>
    <div class="bs-legend"><span class="vd vd-live">${t('bort.vd.live')}</span><span class="vd vd-dead">${t('bort.vd.dead')}</span><span class="vd vd-unknown">${t('bort.vd.unknown')}</span>
      <span class="dim">${t('bort.sum.legend')}${inh.length ? '; ' + t('bort.sum.inherit', {list: inh.join(', ')}) : ''}</span></div>
  </section>`;
}

// The "Session" block of the "Forma" tab: the log's coverage (collapsed), the session's MCP servers, the window floor.
function bortSessionBlockHtml(b){
  if (!b) return '';
  return `<section class="forma-sec forma-sec--session"><h2 class="forma-h">${t('bort.session.title')}</h2>
    <details class="bs-fold"><summary>${t('bort.session.coverage')}</summary>${bortNodesHtml(b, false)}</details>
    <details class="bs-fold"><summary>${t('bort.session.mcp')}</summary>${bortSessionHtml(b)}</details>
    <details class="bs-fold"><summary>${t('bort.session.floor')}</summary>
      <p class="hint">${t('bort.session.floorHint')}</p>
      ${floorChartHtml(b.floor)}</details>
    <p class="dim">${t('bort.session.foot')}</p>
  </section>`;
}
