// The "Economy" tab: five levels from the key metrics to the reference, by the approved layout.
// Level 1 - five tiles, level 2 - the dynamics and the structure, level 3 - where the tokens go,
// level 4 - the money/the engines/the subagents (collapsed), level 5 - the reference and the audit (collapsed).
// The level 3-5 blocks reuse the existing parsing functions without changing their bodies.
// All the interface strings - through t()/cnt() from the dictionaries locales/*.json, the `econ.*` keys.
// Caution: do not name local variables `t` - that is the translation.

function tilesHtml(tot, dialog){
  // The three spend items (AGENTS.md §3): the nodes by `## History`, the Intent <-> human dialog
  // by the main session's transcript (the work without the cache-read), and their sum.
  // The tokens by the nodes and the "total" do not stand here: they are summed across engines -
  // for the engines see the table above. The dialog - the transcript of the engine whose adapter declared the sheet (`dialog.sessionOwner`).
  const dlg = dialog && dialog.all ? dialog.all.work : 0;
  const tiles = [
    {num:tot.epicCount, lbl:t('econ.tile.epics')},
    {num:tot.cardCount, lbl:t('econ.tile.cards')},
    {num:tot.attemptCount, lbl:t('econ.tile.attempts'), pending:tot.attemptCount===0},
    ...(dialog ? [{num:dlg, lbl:t('econ.tile.dialog'), pending:!dlg}] : []),
  ];
  return `<section class="tiles">${tiles.map(x => `
    <div class="tile ${x.pending?'pending':''}">
      <div class="num">${x.pending ? '—' : fmt(x.num)}</div>
      <div class="lbl">${x.lbl}</div>
    </div>`).join('')}</section>`;
}

// The long `.hint` tooltip - it hid as a tile of text on the levels 3-4 (the card
// ballooned). Collapsed into "?"; on level 5 this wrapper is not used - there
// the tooltip inside an already expanded block fits as it is.
function hintFold(bodyHtml){
  return `<details class="hint-fold"><summary>?</summary>${bodyHtml}</details>`;
}

function barSegments(byStatus, total){
  return STATUS_ORDER.filter(s => byStatus[s]).map(s => {
    const pct = (byStatus[s] / total * 100).toFixed(2);
    return `<span style="width:${pct}%; background:var(${STATUS_VAR[s]})" title="${STATUS_LABEL[s]}: ${byStatus[s]}"></span>`;
  }).join('');
}

function globalBarHtml(totals){
  const legend = STATUS_ORDER.filter(s => totals.byStatus[s]).map(s => `
    <span><span class="dot" style="background:var(${STATUS_VAR[s]})"></span>${STATUS_LABEL[s]} <b>${totals.byStatus[s]}</b></span>
  `).join('');
  return `<section class="statusbar-card">
    <h2>${t('econ.statusAll')}</h2>
    <div class="bar">${barSegments(totals.byStatus, totals.cardCount)}</div>
    <div class="legend">${legend}</div>
  </section>`;
}

const NODE_COLORS = {
  Intent:"#2D7D8C", Spec:"#5B6FD6", Kit:"#B0562E", Run:"#A23B54", Core:"#6E8F3E",
};

function configHtml(nodeConfig){
  if (!nodeConfig || !nodeConfig.length) return '';
  const rows = nodeConfig.map(n => {
    if (n.empty) return `<tr class="engine-empty"><td colspan="6"><b>${esc(engineLabel(n.engine))}</b> <span class="dim">${t('econ.config.noTable')}</span></td></tr>`;
    const color = NODE_COLORS[n.node] || "#8891A2";
    const ext = n.externalModel
      ? `<span class="external-yes">${t('econ.yes')}</span>`
      : '<span class="external-no">—</span>';
    return `<tr>
      <td class="mono-cell">${esc(engineLabel(n.engine))}</td>
      <td><span class="node-name" style="--node-color:${color}">${n.node}</span></td>
      <td class="mono-cell">${n.model || '—'}</td>
      <td class="mono-cell">${n.effort || '—'}</td>
      <td class="mono-cell">${n.toolCount}</td>
      <td>${ext}</td>
    </tr>`;
  }).join('');
  return `<section class="config-card">
    <h2>${t('econ.config.title')}</h2>
    <table class="config-table">
      <thead><tr><th>${t('econ.speed.thEngine')}</th><th>${t('econ.th.node')}</th><th>${t('econ.config.model')}</th><th>${t('econ.config.effort')}</th><th>${t('econ.config.tools')}</th><th>${t('econ.config.external')}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </section>`;
}

function dialogRowHtml(dialog, maxTokens){
  const cur = dialog && dialog.current, all = dialog && dialog.all;
  if (!cur && !all) return '';
  const w = all ? all.work : 0;
  const pct = Math.min(100, Math.max(w / maxTokens * 100, w > 0 ? 1.5 : 0));
  const curTxt = cur && cur.sessions
    ? t('econ.dlg.cur', {work: fmt(cur.work), cache: fmt(cur.cacheRead), calls: cur.calls}) + (cur.sessions > 1 ? ' · ' + t('econ.dlg.live', {n: cur.sessions}) : '')
    : t('econ.dlg.curNone');
  const allTxt = all
    ? t('econ.dlg.all', {work: fmt(all.work), cache: fmt(all.cacheRead), sessions: all.sessions, usd: fmt(Math.round(all.usd || 0))}) + (all.ageHours != null && all.ageHours > 24 ? ' · ' + t('econ.dlg.age', {h: Math.round(all.ageHours)}) : '')
    : t('econ.dlg.allNone');
  return `<div class="node-row node-row-dialog" style="--node-color:${NODE_COLORS.Intent || '#8891A2'}" title="${esc(t('econ.dlg.title'))}">
      <span class="node-name">${t('econ.dlg.name')}</span>
      <span class="node-bar-track"><span class="node-bar-fill" style="width:${pct}%"></span></span>
      <span class="node-figures">${curTxt}<br>${allTxt}</span>
    </div>`;
}

function econNodesHtml(byNode, dialog){
  if ((!byNode || !byNode.length) && !(dialog && (dialog.current || dialog.all))) {
    return `<section class="nodes-card">
      <h2>${t('econ.nodesSpend')}</h2>
      <div class="node-empty">${t('econ.nodes.empty')}</div>
    </section>`;
  }
  byNode = byNode || [];
  const maxTokens = Math.max(...byNode.map(n => n.tokensTotal), dialog && dialog.all ? dialog.all.work : 0, 1);
  const rows = byNode.map(n => {
    const color = NODE_COLORS[n.node] || "#8891A2";
    const pct = Math.max((n.tokensTotal / maxTokens * 100), n.tokensTotal > 0 ? 1.5 : 0);
    const money = n.costUsdTotal > 0 ? ` · <b>$${n.costUsdTotal.toFixed(4)}</b> (${t('econ.ext', {n: n.externalAttemptCount})})` : '';
    return `<div class="node-row" style="--node-color:${color}">
      <span class="node-name">${n.node}</span>
      <span class="node-bar-track"><span class="node-bar-fill" style="width:${pct}%"></span></span>
      <span class="node-figures">${t('econ.nodes.figures', {tok: fmt(n.tokensTotal), att: n.attemptCount, cards: n.cardCount})}${money}</span>
    </div>`;
  }).join('');
  return `<section class="nodes-card">
    <h2>${t('econ.nodesSpend')}</h2>
    <div class="node-rows">${rows}${dialogRowHtml(dialog, maxTokens)}</div>
  </section>`;
}

// A compact panel modeled on the three Graphify panels (`graphifyPanelHtml`) - the resident
// subagents (they live across many tasks, not per one card, the `kit.md` task "accounting the spend
// of the resident subagents"). Without an exact day-by-day countdown - only a soft
// warning when idle longer than a SUBAGENT_STALE_DAYS equivalent (`entry.stale` is already
// computed in generate.js, the retention semantics is not confirmed by the documentation unambiguously).
function subagentsHtml(list, bare){
  const heading = bare ? '' : `<h2>${t('econ.subagents')}</h2>`;
  if (!list || !list.length) {
    return `<section class="config-card">
      ${heading}
      <div class="node-empty" style="padding:0 18px 16px">${t('econ.subagents.empty')}</div>
    </section>`;
  }
  const rows = list.map(a => {
    const badge = a.stale ? graphifyBadgeHtml(t('econ.subagents.stale', {days: 25})) : '';
    return `<div class="card-row" style="grid-template-columns:8px 1fr auto; align-items:start">
      <span class="status-dot" style="background:${a.stale ? 'var(--st-review)' : 'var(--st-done)'}; margin-top:5px"></span>
      <span>
        <span class="card-title" style="display:block" title="${(a.role||a.agent).replace(/"/g,'&quot;')}"><b class="mono">${a.agent}</b> — ${a.role || t('econ.subagents.noRole')}</span>
        ${badge}
      </span>
      <span class="card-tags mono" style="align-self:flex-start">${t('econ.subagents.figures', {calls: fmt(a.calls), tok: fmt(a.tokensTotal), hired: timeAgo(a.hiredAt), last: timeAgo(a.lastUsedAt)})}</span>
    </div>`;
  }).join('');
  return `<section class="config-card">
    ${heading}
    <div class="epic-list" style="margin-top:6px">${rows}</div>
  </section>`;
}

function moneyHtml(totals, byNode, bare){
  const heading = bare ? `<div class="e-sub-lbl">${t('econ.money')}</div>` : `<h2>${t('econ.money.title')}</h2>`;
  const externalNodes = (byNode || []).filter(n => n.costUsdTotal > 0);
  if (!totals.costUsdTotal) {
    return `<section class="money">
      <div class="money-head">
        ${heading}
        <span class="status-chip">${t('econ.off')}</span>
      </div>
      <div class="money-figure">—</div>
      <p>${t('econ.money.empty')}</p>
    </section>`;
  }
  const rows = externalNodes.map(n => `<div class="card-row" style="grid-template-columns:8px 1fr auto">
    <span class="status-dot" style="background:${NODE_COLORS[n.node] || '#8891A2'}"></span>
    <span class="card-title">${n.node}</span>
    <span class="card-tags mono">$${n.costUsdTotal.toFixed(4)} · ${cnt('count.calls', n.externalAttemptCount)}</span>
  </div>`).join('');
  return `<section class="money">
    <div class="money-head">
      ${heading}
      <span class="status-chip" style="color:var(--st-done); border-color:var(--st-done)">${t('econ.on')}</span>
    </div>
    <div class="money-figure">$${totals.costUsdTotal.toFixed(4)}</div>
    <div class="epic-list" style="margin-top:4px">${rows}</div>
    <p>${t('econ.money.note')}</p>
  </section>`;
}

/* --- Level 1: the key metrics -------------------------------------------------
   Five tiles, the main one - "tokens per closed card" (a measure of the benefit, not of the spend):
   the benefit - a closed card, the tokens - the price. The delta and the spark - by `efficiency.byDate`
   of the selected engine; one point or fewer - "-", not zero (`AGENTS.md` §5 item 2). */
function heroDeltaHtml(byDate){
  if (!byDate || byDate.length < 2) return '<span class="dim">—</span>';
  const prev = byDate[byDate.length - 2].perCard, last = byDate[byDate.length - 1].perCard;
  if (!prev) return '<span class="dim">—</span>';
  const diff = last - prev;
  if (diff === 0) return `<span class="dim">${t('econ.noChange')}</span>`;
  const p = Math.round(Math.abs(diff) / prev * 100);
  // Less is better: the same card cost less.
  return `<span class="delta ${diff < 0 ? 'good' : 'bad'}">${diff < 0 ? '▼' : '▲'} ${t('econ.delta', {p})}</span>`;
}

function sparkHtml(byDate){
  if (!byDate || byDate.length < 2) return '';
  const vals = byDate.slice(-10).map(d => d.perCard);
  const max = Math.max(...vals), min = Math.min(...vals), span = (max - min) || 1;
  const w = 200, h = 34;
  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * w;
    const y = h - 4 - ((v - min) / span) * (h - 8);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const [lx, ly] = pts[pts.length - 1].split(',');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <polyline points="${pts.join(' ')}" fill="none" stroke="var(--accent)" stroke-width="2"/>
    <circle cx="${lx}" cy="${ly}" r="3.5" fill="var(--accent)"/></svg>`;
}

function level1Html(d, view){
  const f = view.economy.efficiency || {};
  const tot = view.economy.totals || {};
  const cov = d.economy.coverage || {};
  const totalsAll = d.totals;
  const blind = cov.cardsWorked ? Math.max(0, cov.cardsWorked - cov.cardsWithAttempts) : null;
  const blindPct = cov.cardsWorked ? pct(blind, cov.cardsWorked) : null;
  const tiles = [
    { cls: 'hero', lbl: t('econ.l1.perCard'),
      num: f.cardsCounted ? fmt(f.perCard) : '—',
      sub: f.cardsCounted
        ? heroDeltaHtml(f.byDate) + sparkHtml(f.byDate)
        : `<div class="lbl">${t('econ.l1.perCardNone')}</div>` },
    { cls: '', lbl: t('econ.l1.total'), num: tot.tokens ? fmt(tot.tokens) : '—' },
    { cls: '', lbl: t('econ.l1.cost'),
      num: totalsAll.costUsdTotal ? '$' + totalsAll.costUsdTotal.toFixed(4) : '—',
      sub: `<div class="lbl">${totalsAll.costUsdTotal ? t('econ.l1.costExt') : t('econ.l1.costNone')}</div>` },
    { cls: '', lbl: t('econ.l1.accepted'), num: `${fmt(totalsAll.byStatus.done || 0)} / ${fmt(totalsAll.cardCount)}`,
      sub: `<div class="lbl">${t('econ.l1.attempts', {n: fmt(totalsAll.attemptCount)})}</div>` },
    { cls: 'alert', lbl: t('econ.blindSpots'), num: blindPct != null ? blindPct + '%' : '—',
      sub: `<div class="lbl">${t('econ.l1.blind')}</div>` },
  ];
  return `<div class="tier"><div class="tier-lab">${t('econ.l1.tier')}</div>
    <section class="tiles tiles-hero">${tiles.map(x => `
      <div class="tile kpi ${x.cls}">
        <div class="lbl">${x.lbl}</div>
        <div class="num mono">${x.num}</div>
        ${x.sub || ''}
      </div>`).join('')}</section>
  </div>`;
}

/* --- Level 2: the dynamics and the structure ----------------------------------
   On the left - the tokens by days (the columns) and the tokens per closed card by the closing
   date (the line); on the right - the instruction/work share (`totals.cacheRead`/`totals.work`) and
   the re-reads per a work token (`sessionEconomy.totals.ratio`), the trend - by `byWeek`. */
function trendChartHtml(byDate, effByDate){
  if (!byDate || !byDate.length) {
    return `<div class="nodata">${t('econ.trend.empty')}</div>`;
  }
  const w = 640, h = 170;
  const gap = (w - 20) / byDate.length;
  const barW = Math.max(6, Math.min(30, gap - 6));
  const maxTok = Math.max(...byDate.map(x => x.tokens), 1);
  const bars = byDate.map((x, i) => {
    const bh = Math.max(2, (x.tokens / maxTok) * (h - 30));
    return `<rect x="${(10 + i * gap).toFixed(1)}" y="${(h - 10 - bh).toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" fill="var(--accent)" opacity=".75"><title>${t('econ.trend.bar', {date: x.date, tok: fmt(x.tokens), att: x.attempts})}</title></rect>`;
  }).join('');
  const effMap = Object.fromEntries((effByDate || []).map(x => [x.date, x.perCard]));
  const known = byDate.map(x => effMap[x.date]).filter(v => v != null);
  let line = '';
  if (known.length > 1) {
    const maxL = Math.max(...known), minL = Math.min(...known), span = (maxL - minL) || 1;
    const pts = [];
    byDate.forEach((x, i) => {
      const v = effMap[x.date];
      if (v == null) return;
      const px = 10 + i * gap + barW / 2;
      const py = 10 + (h - 30) - ((v - minL) / span) * (h - 40);
      pts.push(`${px.toFixed(1)},${py.toFixed(1)}`);
    });
    const [lx, ly] = pts[pts.length - 1].split(',');
    line = `<polyline points="${pts.join(' ')}" fill="none" stroke="var(--st-progress)" stroke-width="2.5"/><circle cx="${lx}" cy="${ly}" r="4" fill="var(--st-progress)"/>`;
  }
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="${esc(t('econ.trend.aria'))}">
      <g stroke="var(--border)"><line x1="0" y1="20" x2="${w}" y2="20"/><line x1="0" y1="70" x2="${w}" y2="70"/><line x1="0" y1="120" x2="${w}" y2="120"/><line x1="0" y1="160" x2="${w}" y2="160"/></g>
      <g>${bars}</g>${line}
    </svg>
    <p class="hint">${t('econ.trend.bars', {days: cnt('count.days', byDate.length)})}
      ${known.length > 1 ? t('econ.trend.line') : t('econ.trend.noLine')}</p>`;
}

function weeksTrendText(se){
  const weeks = (se.byWeek || []).filter(w => w.ratio != null);
  if (weeks.length < 2) return t('econ.weeks.few');
  const first = weeks[0], last = weeks[weeks.length - 1];
  const vars = {a: first.ratio, wa: first.week, b: last.ratio, wb: last.week};
  return last.ratio > first.ratio ? t('econ.weeks.up', vars) : t('econ.weeks.down', vars);
}

function level2Html(view){
  const e = view.economy, tot = e.totals || {}, c = e.coverage || {};
  const trendCard = `<div class="e-card">
    <h3>${t('econ.l2.trend')}</h3>
    ${trendChartHtml(e.byDate, (e.efficiency || {}).byDate)}
  </div>`;
  const stack = c.attemptsWithCacheRead
    ? (() => {
        const inst = pct(tot.cacheRead, tot.cacheRead + tot.work);
        const work = 100 - inst;
        // A label inside a narrow segment would be clipped by the container (overflow:hidden
        // on `.stack`) - so the full labels stand as a legend under the bar, not inside it.
        return `<div class="stack">
            <span style="width:${inst}%;background:var(--st-review)" title="${t('econ.l2.instr')} ${inst}%"></span>
            <span style="width:${work}%;background:var(--st-done)" title="${t('econ.l2.work')} ${work}%"></span>
          </div>
          <div class="legend stack-legend">
            <span><span class="dot" style="background:var(--st-review)"></span>${t('econ.l2.instr')} <b>${inst}%</b></span>
            <span><span class="dot" style="background:var(--st-done)"></span>${t('econ.l2.work')} <b>${work}%</b></span>
          </div>`;
      })()
    : `<div class="nodata">${t('econ.l2.noInstr')}</div>`;
  const owner = sessionOwnerOf(view);
  const mine = view.econEngine != null && view.econEngine === owner;
  const seOk = mine && view.sessionEconomy && !view.sessionEconomy.error;
  const ratioCard = seOk
    ? `<div class="kpi-inline"><div class="lbl">${t('econ.l2.ratio')}</div><div class="num mono">${view.sessionEconomy.totals.ratio}</div><p class="hint">${weeksTrendText(view.sessionEconomy)}</p></div>`
    : `<div class="kpi-inline"><div class="lbl">${t('econ.l2.ratio')}</div><div class="num mono dim">—</div><p class="hint">${mine ? t('econ.l2.noLedger') : t('econ.l2.onlyCC', {engine: esc(owner || '—')})}</p></div>`;
  const workCard = `<div class="e-card">
    <h3>${t('econ.l2.workTitle')}</h3>
    ${stack}
    ${ratioCard}
  </div>`;
  return `<div class="tier"><div class="tier-lab">${t('econ.l2.tier')}</div>
    <div class="erow erow-2">${trendCard}${workCard}</div>
  </div>`;
}

/* --- Level 3: where the tokens go ---------------------------------------------
   Reuses nodesHtml (renamed econNodesHtml - a name collision with the global
   function nodesHtml in nodes.js, the same global scope, loaded later and clobbering it)/
   topCardsHtml/routesHtml unchanged - only the grid. */
function level3Html(view, dialog){
  return `<div class="tier"><div class="tier-lab">${t('econ.l3.tier')}</div>
    <div class="erow erow-3">
      ${econNodesHtml(view.byNode, dialog)}
      ${topCardsHtml(view.economy.topCards) || `<div class="e-card"><h3>${t('econ.top.title')}</h3><div class="nodata">${t('econ.top.empty')}</div></div>`}
      ${routesHtml(view.byRoute) || `<div class="e-card"><h3>${t('econ.routes.title')}</h3><div class="nodata">${t('econ.routes.empty')}</div></div>`}
    </div>
  </div>`;
}

/* --- Level 4: the money, the engines, the resident subagents - collapsed by default, open -- */
function accDetails(title, body, open){
  return `<details class="e-acc"${open ? ' open' : ''}><summary>${esc(title)}</summary><div class="e-acc-body">${body}</div></details>`;
}

function level4Html(d, view){
  const blocks = [
    [t('econ.l4.services'), servicesHtml(view.economy, true) + moneyHtml(d.totals, d.byNode, true)],
    [t('econ.l4.engines'), engineTableHtml(d.economy.byEngine, true)],
    [t('econ.subagents'), subagentsHtml(d.subagents, true)],
  ];
  return `<div class="tier"><div class="tier-lab">${t('econ.l4.tier')}</div>
    <div class="erow erow-3">${blocks.map(([ttl, b]) => accDetails(ttl, b, true)).join('')}</div>
  </div>`;
}

/* --- The economy: the body of the reused blocks of the levels 3 and 5 -------- */

const secText = s => s < 60 ? t('time.s', {s}) : hhmm(s);

function economyNodesHtml(byNode){
  const rows = byNode.filter(n => n.attemptCount).map(n => `<tr>
    <td><b>${n.node}</b></td>
    <td class="n">${n.attemptCount}</td>
    <td class="n">${fmt(n.tokensTotal)}</td>
    <td class="n">${n.avgTokens ? fmt(n.avgTokens) : '—'}</td>
    <td class="n">${n.withSeconds ? secText(n.secondsTotal) : '—'}${n.withSeconds && n.withSeconds < n.attemptCount ? ` <span class="dim">${t('econ.nodes.of', {a: n.withSeconds, b: n.attemptCount})}</span>` : ''}</td>
    <td class="n">${n.avgSeconds ? t('time.s', {s: n.avgSeconds}) : '—'}</td>
    <td class="n">${n.cardCount}</td>
  </tr>`).join('');
  return `<div class="ebox">
    <h3>${t('econ.nodesSpend')}</h3>
    <p class="hint">${t('econ.nodes.avgHint')}</p>
    <table class="etable">
      <thead><tr><th>${t('econ.th.node')}</th><th class="n">${t('econ.th.attempts')}</th><th class="n">${t('econ.th.tokens')}</th><th class="n">${t('econ.th.avgAttempt')}</th>
        <th class="n">${t('econ.th.time')}</th><th class="n">${t('econ.th.avgTime')}</th><th class="n">${t('econ.th.cards')}</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="7" class="dim">${t('econ.nodes.noAttempts')}</td></tr>`}</tbody>
    </table>
  </div>`;
}

function topCardsHtml(list){
  if (!list || !list.length) return '';
  const max = list[0].tokens || 1;
  // A card with zero tokens is not cheap but unrecorded: in the "costliest" list
  // it would read as an achievement. Its place is the blind spots, and only there.
  list = list.filter(c => c.tokens > 0);
  if (!list.length) return '';
  const rows = list.map(c => `<tr>
    <td class="ttl" title="${esc(c.title)}">${esc(c.title)}</td>
    <td class="n">${fmt(c.tokens)}</td>
    <td style="width:130px"><div class="bar" style="height:8px">
      <span style="width:${pct(c.tokens, max)}%;background:var(--accent)"></span></div></td>
    <td class="n">${c.attempts}</td>
    <td class="n">${hhmm(c.seconds)}</td>
    <td class="dim">${c.nodes.join(' · ')}</td>
  </tr>`).join('');
  return `<div class="e-card">
    <h3>${t('econ.top.title')}</h3>
    ${hintFold(`<p class="hint">${t('econ.top.hint')}</p>`)}
    <div class="etable-scroll"><table class="etable" style="min-width:480px">
      <thead><tr><th>${t('econ.th.card')}</th><th class="n">${t('econ.th.tokens')}</th><th></th><th class="n">${t('econ.th.attempts')}</th>
        <th class="n">${t('econ.th.time')}</th><th>${t('econ.th.nodes')}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </div>`;
}

function blindSpotsHtml(e){
  const b = e.blindSpots, c = e.coverage;
  if (!c.blindSpotCount) return `<div class="nodata">${t('econ.blind.none')}</div>`;
  const rows = b.map(x => `<tr>
    <td class="ttl" title="${esc(x.title)}">${esc(x.title)}</td>
    <td><span class="pill">${esc(x.status)}</span></td>
    <td class="dim">${esc(x.epic || '—')}</td>
  </tr>`).join('');
  return `<h3>${t('econ.blind.title', {cards: cnt('count.cards', c.blindSpotCount)})}</h3>
    <p class="hint">${t('econ.blind.hint')}
       ${b.length < c.blindSpotCount ? t('econ.blind.first', {n: b.length}) : ''}</p>
    <table class="etable">
      <thead><tr><th>${t('econ.th.card')}</th><th>${t('econ.th.status')}</th><th>${t('econ.th.epic')}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function daysHtml(byDate){
  if (!byDate.length) return '';
  const max = Math.max(...byDate.map(d => d.tokens)) || 1;
  const bars = byDate.map(d =>
    `<div class="d" style="height:${Math.max(3, pct(d.tokens, max))}%"
      title="${t('econ.days.bar', {date: d.date, tok: fmt(d.tokens), att: d.attempts, time: hhmm(d.seconds)})}"></div>`).join('');
  return `<div class="ebox">
    <h3>${t('econ.days.title')}</h3>
    <p class="hint">${t('econ.days.hint')}</p>
    <div class="days">${bars}</div>
    <div class="days-ax"><span>${byDate[0].date}</span><span>${byDate[byDate.length - 1].date}</span></div>
  </div>`;
}

/* The external services - the third kind of spend, next to the tokens and the money.
   Each counts in its own unit, so they do not and must not fold into one sum:
   "1740 credits and 12 minutes" is two different facts, not one number. */
function servicesHtml(e, bare){
  const heading = bare ? `<div class="e-sub-lbl">${t('econ.svc.sub')}</div>` : `<h3>${t('econ.svc.title')}</h3>`;
  const list = e.byService || [];
  if (!list.length) {
    return `${heading}
      <div class="nodata">${t('econ.svc.empty')}</div>`;
  }
  const blocks = list.map(s => {
    const max = s.operations[0] ? s.operations[0].amount : 1;
    const rows = s.operations.map(o => `<tr>
      <td class="ttl" title="${esc(o.operation)}">${esc(o.operation)}</td>
      <td class="n">${fmt(o.amount)}</td>
      <td style="width:120px"><div class="bar" style="height:8px">
        <span style="width:${pct(o.amount, max)}%;background:var(--st-review)"></span></div></td>
    </tr>`).join('');
    return `<div class="svc">
      <div class="svc-head">
        <span class="svc-name">${esc(s.service)}</span>
        <span class="svc-sum"><b>${fmt(s.amount)}</b> ${esc(s.unit)}</span>
        <span class="dim">${cnt('count.calls', s.calls)} · ${cnt('count.cards', s.cardCount)} · ${s.firstDate}${s.lastDate !== s.firstDate ? ' — ' + s.lastDate : ''}</span>
      </div>
      <table class="etable"><tbody>${rows}</tbody></table>
    </div>`;
  }).join('');
  return `${heading}
    ${hintFold(`<p class="hint">${t('econ.svc.hint')}</p>`)}
    ${blocks}`;
}

// The spend by the routes: the same count as `tally.cjs --routes`.
function routesHtml(r){
  if (!r) return '';
  const unk = x => [x.tokensUnknown && t('econ.routes.unkTokens', {n: x.tokensUnknown}), x.cacheUnknown && `cache-read: ${x.cacheUnknown}`,
    x.secondsUnknown && t('econ.routes.unkSec', {n: x.secondsUnknown})].filter(Boolean).join(', ');
  // Compact first: the tag, the cards, the tokens, the returns - the other columns
  // (the attempts, cache-read, time, preparation, unknown) are reachable by scrolling right.
  const rows = list => list.map(x => `<tr>
    <td><b>${x.key}</b></td>
    <td class="n">${x.cards}</td>
    <td class="n">${fmt(x.tokens)}</td>
    <td class="n">${x.returns}</td>
    <td class="n">${x.attempts}</td>
    <td class="n">${fmt(x.cacheRead)}</td>
    <td class="n">${secText(x.seconds)}</td>
    <td class="n">${x.prepShare == null ? `<span class="dim">${t('econ.notRecorded')}</span>` : x.prepShare + '% <span class="dim">(' + x.prepNodes + ')</span>'}</td>
    <td class="dim">${unk(x) || '—'}</td>
  </tr>`).join('');
  const block = (title, list) => list && list.length ? `<tr><th colspan="9">${title}</th></tr>` + rows(list) : '';
  return `<div class="e-card">
    <h3>${t('econ.routes.title')}</h3>
    ${hintFold(`<p class="hint">${t('econ.routes.hint')}</p>`)}
    <div class="etable-scroll"><table class="etable" style="min-width:640px">
      <thead><tr><th>${t('econ.th.label')}</th><th class="n">${t('econ.th.cards')}</th><th class="n">${t('econ.th.tokens')}</th><th class="n">${t('econ.th.returns')}</th>
        <th class="n">${t('econ.th.attempts')}</th><th class="n">Cache-read</th><th class="n">${t('econ.th.time')}</th><th class="n">${t('econ.th.prep')}</th><th>Unknown</th></tr></thead>
      <tbody>${block(t('econ.routes.route'), r.route) + block(t('econ.routes.over'), r.over) + block(t('econ.routes.seg'), r.seg) + block(t('econ.routes.wave'), r.wave)}</tbody>
    </table></div>
  </div>`;
}

/* The records that claim themselves a spend and are not: the legacy Russian form
   (a date, then the Russian "attempt" wording) stands, but the parse does not pass. Held APART
   from the legitimate zeros of `Intent` - there the zero is right by §3, here the spend happened and was lost. */
function malformedHtml(e){
  const list = e.malformed || [];
  if (!list.length) return `<div class="nodata">${t('econ.malformed.none')}</div>`;
  const rows = list.map(m => `<tr>
    <td class="mono dim">${esc(m.cardId.replace(/^card-(\d+).*$/, '$1'))}</td>
    <td>${esc(m.line)}</td>
  </tr>`).join('');
  return `<h3>${t('econ.malformed.title', {n: list.length})}</h3>
    <p class="hint">${t('econ.malformed.hint')}</p>
    <table class="etable">
      <thead><tr><th>${t('econ.th.card')}</th><th>${t('econ.th.line')}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/* The instruction weight - what is computed from the law and the roles' files, not from a record.
   It is held as a separate block and labeled an "estimate" deliberately: next to it stand facts
   taken off the call's metadata, and mixing them with a computation is not allowed - else the
   computation in a week becomes indistinguishable from a measurement. */
function instructionWeightHtml(e, byNode){
  const w = e.instruction;
  if (!w || !w.byNode) return `<div class="nodata">${t('econ.weight.unknown')}</div>`;
  // The rows are taken from the WEIGHT, not from the attempts: the weight is known for all five
  // nodes, including those that have not attempted once yet. Building from the attempts would
  // hide `Core` precisely because it has not been called yet.
  const spent = Object.fromEntries((byNode || []).map(n => [n.node, n]));
  const rows = Object.entries(w.byNode).map(([node, v]) => {
    const n = spent[node];
    return `<tr>
      <td>${esc(node)}</td>
      <td class="n">${fmt(v.perStep)}</td>
      <td class="n">${n && n.avgTokens ? fmt(n.avgTokens) : '—'}</td>
      <td class="n">${n && n.avgSteps != null ? n.avgSteps : '—'}</td>
    </tr>`;
  }).join('');
  return `<h3>${t('econ.weight.title')} <span class="hint">— ${t('econ.weight.estimate')}</span></h3>
    <p class="hint">${t('econ.weight.hint', {tokens: fmt(w.common.tokens)})}</p>
    <table class="etable">
      <thead><tr><th>${t('econ.th.node')}</th><th class="n">${t('econ.weight.perStep')}</th><th class="n">${t('econ.weight.perAttempt')}</th><th class="n">${t('econ.weight.steps')}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="hint">${t('econ.weight.foot')}</p>`;
}

/* --- The sessions' economy: the re-reading against the work -------------------
   The only place on the tab where the figures are taken not from a card record but from the
   engine's own transcripts. .claude/scripts/session-economy.cjs does the counting; only the display here. */
function sessionAgeText(se){
  return se.ageHours == null ? '—'
    : se.ageHours < 1 ? t('time.lessThanHour')
    : relTime(se.ageHours * 60);
}

function sessionRowsHtml(se){
  return [...se.sessions].reverse().map(s => `<tr>
    <td class="dim">${(s.first || '—').slice(0, 10)}${s.live ? ` <b title="${esc(t('econ.sess.liveTitle'))}">${t('econ.sess.live')}</b>` : ''}</td>
    <td class="n">${fmt(s.calls)}</td>
    <td class="n">${(s.cacheRead / 1e6).toFixed(1)}</td>
    <td class="n">${fmt(Math.round(s.output / 1e3))}</td>
    <td class="n"><b>${s.ratio ?? '—'}</b></td>
    <td class="n">${s.costUsd != null ? '$' + Math.round(s.costUsd) : '<span class="dim">~$' + Math.round(s.estUsd) + '</span>'}</td>
  </tr>`).join('');
}

// The course over time: one number does not answer "falling or growing" - and that is the
// main question. A week without work stands as a gap, not as zero.
function sessionWeeksHtml(se){
  const weeks = se.byWeek.filter(w => w.ratio != null);
  const wmax = Math.max(...weeks.map(w => w.ratio), 1);
  const bars = weeks.map(w => `<div class="d" style="height:${Math.max(3, pct(w.ratio, wmax))}%"
      title="${t('econ.sw.bar', {week: w.week, ratio: w.ratio, n: w.sessions})}"></div>`).join('');
  const first = weeks[0], last = weeks[weeks.length - 1];
  const trend = (first && last && weeks.length > 1)
    ? t(last.ratio > first.ratio ? 'econ.sw.up' : 'econ.sw.down', {a: first.ratio, wa: first.week, b: last.ratio, wb: last.week})
    : t('econ.sw.few');
  return `<div style="margin-top:14px">
    <p class="hint">${t('econ.sw.lead')} ${trend}</p>
    ${weeks.length ? `<div class="days">${bars}</div>
      <div class="days-ax"><span>${first.week}</span><span>${last.week}</span></div>`
      : `<div class="nodata">${t('econ.sw.none')}</div>`}
  </div>`;
}

function sessionVerifyRowsHtml(v){
  return v.rows.map(r => `<tr>
    <td class="dim">${r.date}</td>
    <td class="n">${r.crPct > 0 ? '+' : ''}${r.crPct}%</td>
    <td class="n">${r.ccPct == null ? '—' : (r.ccPct > 0 ? '+' : '') + r.ccPct + '%'}</td>
    <td class="n">${r.outPct == null ? '—' : (r.outPct > 0 ? '+' : '') + r.outPct + '%'}</td>
    <td class="n">${fmt(r.inheritedCalls || 0)}</td>
    <td>${r.suspect ? `<b>${t('econ.verify.suspect')}</b>` : t('econ.verify.ok')}</td>
  </tr>`).join('');
}

function sessionVerifyHtml(v){
  const vrows = sessionVerifyRowsHtml(v);
  return `<h3>${t('econ.blocks.verify')}</h3>
    <p class="hint">${t('econ.verify.hint', {pct: v.suspectThresholdPct, checked: v.sessionsChecked, total: v.sessionsTotal})}</p>
    ${v.sessionsChecked ? `<table class="etable">
      <thead><tr><th>${t('econ.th.session')}</th><th class="n">${t('econ.verify.reread')}</th><th class="n">${t('econ.verify.cacheNew')}</th>
        <th class="n">${t('econ.verify.out')}</th><th class="n">${t('econ.verify.inherited')}</th><th>${t('econ.verify.result')}</th></tr></thead>
      <tbody>${vrows}</tbody></table>
      <p class="hint" style="margin-top:10px">${t('econ.verify.note')}</p>`
      : `<div class="nodata">${t('econ.verify.none')}</div>`}`;
}

/** Level 5, "the sessions' table": the summary + the table + the course by weeks - without the self-verification (that is a separate block). */
function sessionTableBlockHtml(se){
  if (!se) return `<div class="nodata">${t('econ.sess.none')}</div>`;
  if (se.error) return `<div class="nodata">${esc(se.error)}</div>`;
  const tot = se.totals;
  const liveCount = se.sessions.filter(s => s.live).length;
  return `<p class="hint">
      ${t('econ.sess.hint', {age: sessionAgeText(se)})}
      ${liveCount ? t('econ.sess.liveCount', {n: liveCount}) : ''}
    </p>
    <div class="cov-legend" style="padding:0 10px 10px">
      <span>${t('econ.sess.sessions', {n: tot.sessions})}</span>
      <span>${t('econ.sess.calls', {n: fmt(tot.calls)})}</span>
      <span>${t('econ.sess.reread', {n: fmt(Math.round(tot.cacheRead / 1e6))})}</span>
      <span>${t('econ.sess.produced', {n: fmt(Math.round(tot.output / 1e6))})}</span>
      <span class="dim">${t('econ.sess.money', {exact: tot.costUsdSessions, total: tot.sessions, usd: fmt(Math.round(tot.bestUsd))})}</span>
    </div>
    <table class="etable">
      <thead><tr><th>${t('econ.th.session')}</th><th class="n">${t('econ.sess.thCalls')}</th><th class="n">${t('econ.sess.thReread')}</th>
        <th class="n">${t('econ.sess.thOut')}</th><th class="n">${t('econ.sess.thRatio')}</th><th class="n">${t('econ.sess.thCost')}</th></tr></thead>
      <tbody>${sessionRowsHtml(se)}</tbody>
    </table>
    ${sessionWeeksHtml(se)}`;
}

function codexUsageHtml(dialog){
  const c = dialog && dialog.codex;
  if (!c) return `<div class="nodata">${t('econ.codex.none')}</div>`;
  const row = (label, v) => `<tr><td><b>${label}</b></td><td class="n">${fmt(v.calls)}</td><td class="n">${fmt(v.tokens)}</td><td class="n">${fmt(v.cacheRead)}</td><td class="n">${t('econ.of', {a: v.cacheKnown, b: v.calls})}</td></tr>`;
  const main = c.byKind && c.byKind.main || { calls:0,tokens:0,cacheRead:0,cacheKnown:0 };
  const children = c.byKind && c.byKind.subagent || { calls:0,tokens:0,cacheRead:0,cacheKnown:0 };
  return `<h3>${t('econ.codex.title')}</h3>
    <p class="dim">${t('econ.codex.hint', {n: fmt((c.sessions || []).length)})}</p>
    <table class="etable"><thead><tr><th>${t('econ.codex.thItem')}</th><th class="n">${t('econ.codex.thCalls')}</th><th class="n">${t('econ.th.tokensLc')}</th><th class="n">${t('econ.codex.thCache')}</th><th class="n">${t('econ.codex.thR')}</th></tr></thead><tbody>${row(t('econ.dlg.name'), main)}${row(t('econ.subagents.short'), children)}</tbody></table>`;
}

/** The owner of the sessions' sheet - the engine whose adapter declared it; no such - `null`. */
function sessionOwnerOf(view){ return (view.dialog && view.dialog.sessionOwner) || null; }

function notForEngineHtml(_title, owner, cur){
  return `<div class="nodata" data-not-for="${esc(owner)}">${t('econ.notFor', {engine: esc(engineLabel(cur || '—')), owner: esc(owner)})}</div>`;
}

/* --- Level 5: the reference and the audit, everything collapsed by default ---- */
function level5Html(view){
  const e = view.economy;
  const owner = sessionOwnerOf(view);
  const mine = view.econEngine != null && view.econEngine === owner;
  const usageCaches = (view.dialog && view.dialog.usageCaches) || {};
  const sessionBody = mine
    ? sessionTableBlockHtml(view.sessionEconomy)
    : ((usageCaches[view.econEngine] || []).includes('codex-usage.json') ? codexUsageHtml(view.dialog) : notForEngineHtml('sessions', owner || '—', view.econEngine));
  const verifyBody = mine && view.sessionEconomy && !view.sessionEconomy.error
    ? sessionVerifyHtml(view.sessionEconomy.verification)
    : notForEngineHtml('verify', owner || '—', view.econEngine);
  const blocks = [
    [t('econ.blindSpots'), blindSpotsHtml(e)],
    [t('econ.blocks.malformed'), malformedHtml(e)],
    [t('econ.blocks.verify'), verifyBody],
    [t('econ.weight.title'), instructionWeightHtml(e, view.byNode)],
    [t('econ.blocks.sessions'), sessionBody],
    [t('econ.blocks.config'), configHtml(view.nodeConfig)],
  ];
  return `<div class="tier"><div class="tier-lab">${t('econ.l5.tier')}</div>
    <div class="erow erow-6">${blocks.map(([ttl, b]) => accDetails(ttl, b, false)).join('')}</div>
  </div>`;
}

/* --- The header: the engine tag + the trustworthiness of the data ------------- */
function trustBadgeHtml(coverage){
  if (!coverage || !coverage.cardsWorked) {
    return `<div class="e-trust"><span class="dim">${t('econ.trust')}</span><b class="mono dim">—</b></div>`;
  }
  const share = pct(coverage.cardsWithAttempts, coverage.cardsWorked);
  return `<div class="e-trust"><span class="dim">${t('econ.trust')}</span>
    <span class="e-meter"><i style="width:${share}%"></i></span>
    <b class="mono">${share}%</b></div>`;
}

/* The economy by the engines. The tokens of different engines do not go into one
   sum: everything where tokens stand is drawn by the selected tag; the common row -
   only the attempts, the time and the accepted cards. */
let ECON_ENGINE = null;
const engineLabel = k => k === 'untagged' ? t('econ.untagged') : k;
function engineTableHtml(b, bare){
  const heading = bare ? '' : `<h3>${t('econ.eng.title')}</h3>`;
  if (!b || !b.keys.length) return `${heading}<div class="nodata">${t('econ.eng.none')}</div>`;
  const col = k => b.columns[k];
  // The detail (cache-read/time/id) - in the title, not inline: a long id in the visible text
  // of a cell ballooned the whole table column by the auto-layout, and the short numbers of the
  // rows above (right-aligned) slid beyond the visible scroll edge.
  const unk = u => {
    const detail = (u.cache_read || u.duration_s || u.call_id)
      ? t('econ.eng.detail', {cr: u.cache_read, time: u.duration_s, id: u.call_id}) : '';
    return `<span${detail ? ` class="dim" title="${esc(detail)}"` : ''}>${t('econ.unknown', {n: u.tokens})}</span>`;
  };
  const row = (label, f, common) => `<tr><td class="elbl">${label}</td>${b.keys.map(k => `<td class="n">${f(col(k))}</td>`).join('')}<td class="n">${common}</td></tr>`;
  const c = b.common;
  const noSum = `<span class="dim">${t('econ.eng.noSum')}</span>`;
  return `${heading}
    ${hintFold(`<p class="hint">${t('econ.eng.hint')}</p>`)}
    <div class="etable-scroll"><table class="etable" style="min-width:${120 + b.keys.length * 100}px">
      <thead><tr><th></th>${b.keys.map(k => `<th class="n">${esc(engineLabel(k))}</th>`).join('')}<th class="n">${t('econ.eng.common')}</th></tr></thead>
      <tbody>
        ${row(t('econ.th.attempts'), v => fmt(v.attempts), fmt(c.attempts))}
        ${row(t('econ.th.time'), v => secText(v.seconds), secText(c.seconds))}
        ${row(t('econ.eng.cardsWithRec'), v => fmt(v.cards), '<span class="dim">—</span>')}
        ${row(t('econ.eng.accepted'), () => '<span class="dim">—</span>', fmt(c.accepted))}
        ${row(t('econ.th.tokens'), v => fmt(v.tokens), noSum)}
        ${row('Cache-read', v => fmt(v.cacheRead), noSum)}
        ${row(t('econ.eng.unknownRow'), v => unk(v.unknown), '<span class="dim">—</span>')}
      </tbody>
    </table></div>`;
}

/* --- The engines' speed summary: the top of the "Economy" tab ------------------
   A tile per engine: the speedometer "out tokens per a call's second", the ring "the retry share",
   three stripes (seconds / tokens / $ per a closed card). The place and the scale are computed by
   the pure functions below (the test: tiles.test.cjs); the color - by the place among the engines with a value. */
const TILE_MIN_FRAC = 0.04;

/** The place of a value among the engines' values: good / mid / bad, or neutral (one value or all equal), null - no value. */
function tilePlace(vals, v, higherBetter){
  if (v == null) return null;
  const xs = vals.filter(x => x != null);
  if (xs.length < 2) return 'neutral';
  const hi = Math.max(...xs), lo = Math.min(...xs);
  if (hi === lo) return 'neutral';
  const best = higherBetter ? hi : lo, worst = higherBetter ? lo : hi;
  return v === best ? 'good' : v === worst ? 'bad' : 'mid';
}

/** The share of the scale 0..1: the largest value among the engines - the full scale; null - no value. */
function tileFrac(vals, v){
  if (v == null) return null;
  const max = Math.max(0, ...vals.filter(x => x != null));
  if (!(max > 0)) return 0;
  return v > 0 ? Math.max(TILE_MIN_FRAC, v / max) : 0;
}

/** The model of the tiles from `speed.summary`: per engine - a speedometer, a ring, three stripes; plus the "Total". A null metric - no data. */
function tileModel(sm){
  const val = x => (x && x.v != null ? x.v : null);
  const tags = sm.tags || [];
  const col = f => tags.map(k => val(sm.engines[k][f]));
  const cols = { out: col('outPerCallSec'), sec: col('secPerClosed'), tok: col('tokensPerClosed'), usd: col('usdPerClosed') };
  const tiles = tags.map((k, i) => {
    const r = sm.engines[k];
    const bar = (f, key) => ({ m: r[f], v: cols[key][i], frac: tileFrac(cols[key], cols[key][i]), place: tilePlace(cols[key], cols[key][i], false) });
    const out = { m: r.outPerCallSec, v: cols.out[i], frac: tileFrac(cols.out, cols.out[i]), place: tilePlace(cols.out, cols.out[i], true) };
    const retry = { m: r.retryShare, v: val(r.retryShare), frac: val(r.retryShare) };
    const bars = { sec: bar('secPerClosed', 'sec'), tok: bar('tokensPerClosed', 'tok'), usd: bar('usdPerClosed', 'usd') };
    const empty = out.v == null && retry.v == null && !r.closedCards && Object.values(bars).every(b => b.v == null)
      && ['tokensTotal', 'secTotal', 'usdTotal'].every(f => val(r[f]) == null);
    return { tag: k, closed: r.closedCards, out, retry, bars, empty };
  });
  return { tiles, total: sm.total || null };
}

const fmtTileDec = (v, n) => v.toFixed(n);
const TILE_ARC = 'M12 62 A48 48 0 0 1 108 62';

function gaugeHtml(o){
  const aria = esc(t('econ.tile.speed'));
  if (o.v == null) return `<div class="sg-box"><div class="sg-none">${t('econ.speed.noData')}</div></div>`;
  const low = o.m.low;
  return `<div class="sg-box${low ? ' low' : ''}"><svg viewBox="0 0 120 70" role="img" aria-label="${aria}: ${fmtTileDec(o.v, 1)}">
      <path class="sg-track" d="${TILE_ARC}" pathLength="100"/>
      <path class="sg-arc g-${o.place}" d="${TILE_ARC}" pathLength="100" stroke-dasharray="${(o.frac * 100).toFixed(1)} 100"/>
    </svg><div class="sg-num mono">${fmtTileDec(o.v, 1)}</div></div>`;
}

function ringHtml(o){
  const aria = esc(t('econ.tile.retry'));
  if (o.v == null) return `<div class="sr-box"><div class="sg-none">${t('econ.speed.noData')}</div></div>`;
  const p = Math.round(o.v * 100);
  return `<div class="sr-box${o.m.low ? ' low' : ''}"><svg viewBox="0 0 60 60" role="img" aria-label="${aria}: ${p}%">
      <circle class="sg-track" cx="30" cy="30" r="22" pathLength="100"/>
      <circle class="sg-arc g-retry" cx="30" cy="30" r="22" pathLength="100" stroke-dasharray="${(o.frac * 100).toFixed(1)} 100" transform="rotate(-90 30 30)"/>
    </svg><div class="sr-num mono">${p}%</div></div>`;
}

function stripeHtml(label, b, f){
  if (b.v == null) return `<div class="sb-row"><span class="sb-lbl">${label}</span><span class="sb-track"></span><span class="sb-val dim">${t('econ.speed.noData')}</span></div>`;
  return `<div class="sb-row${b.m.low ? ' low' : ''}"><span class="sb-lbl">${label}</span>
    <span class="sb-track"><i class="g-${b.place}" style="width:${(b.frac * 100).toFixed(1)}%"></i></span>
    <span class="sb-val mono">${f(b.v)}</span></div>`;
}

function engineTileHtml(x){
  const lowM = [x.out.m, x.retry.m, x.bars.sec.m, x.bars.tok.m, x.bars.usd.m].filter(m => m && m.low)
    .sort((p, q) => p.n - q.n)[0];
  const note = lowM ? `<div class="st-note dim">${t('econ.sum.low', {n: fmt(lowM.n), m: fmt(lowM.m)})}</div>` : '';
  if (x.empty) {
    return `<div class="sum-tile empty" data-engine-tile="${esc(x.tag)}"><div class="st-name">${esc(engineLabel(x.tag))}</div>
      <div class="sg-none">${t('econ.speed.noData')}</div></div>`;
  }
  return `<div class="sum-tile" data-engine-tile="${esc(x.tag)}">
    <div class="st-name">${esc(engineLabel(x.tag))}</div>
    <div class="st-top">
      <div class="st-gauge">${gaugeHtml(x.out)}<div class="st-cap">${t('econ.tile.speed')}</div></div>
      <div class="st-ring">${ringHtml(x.retry)}<div class="st-cap">${t('econ.tile.retry')}</div></div>
    </div>
    <div class="st-bars">
      ${stripeHtml(t('econ.tile.sec'), x.bars.sec, v => secText(Math.round(v)))}
      ${stripeHtml(t('econ.tile.tok'), x.bars.tok, v => fmt(Math.round(v)))}
      ${stripeHtml(t('econ.tile.usd'), x.bars.usd, v => '$' + v.toFixed(4))}
    </div>
    ${note}
    <div class="st-closed dim">${t('econ.sum.closed', {n: fmt(x.closed)})}</div>
  </div>`;
}

function summaryHtml(e){
  const sm = e.speed && e.speed.summary;
  if (!sm || !sm.tags || !sm.tags.length) return '';
  const model = tileModel(sm);
  const T = model.total || {};
  const tot = (lbl, m, f) => `<span class="sum-tot"><span class="dim">${lbl}</span> <b class="mono${m && m.low ? ' dim' : ''}">${m && m.v != null ? f(m.v) : t('econ.speed.noData')}</b></span>`;
  const strip = `<div class="sum-strip" data-summary-total><b>${t('econ.tile.total')}</b>
      ${tot(t('econ.tile.totTok'), T.tokensTotal, v => fmt(Math.round(v)))}
      ${tot(t('econ.tile.totSec'), T.secTotal, v => secText(Math.round(v)))}
      ${tot(t('econ.tile.totUsd'), T.usdTotal, v => '$' + v.toFixed(4))}
    </div>`;
  return `<div class="tier"><div class="tier-lab">${t('econ.sum.title')}</div>
    ${hintFold(`<p class="hint">${t('econ.sum.hint')}</p>`)}
    ${strip}
    <div class="sum-tiles">${model.tiles.map(engineTileHtml).join('')}</div></div>`;
}

/* --- The speed and the efficiency by the engines + the model/effort by the nodes --- */
let SPEED_KIND = 'all';
const speedNum = (v, f) => v == null ? `<span class="dim">—</span>` : f(v);
function speedHtml(e){
  const sp = e.speed;
  if (!sp || !sp.byKind) return '';
  if (!sp.byKind[SPEED_KIND]) SPEED_KIND = 'all';
  const rows = sp.byKind[SPEED_KIND].engines;
  const tags = Object.keys(rows).sort((a, b) => a.localeCompare(b));
  const dec = (v, n) => v.toFixed(n);
  const body = tags.map(k => {
    const r = rows[k];
    const unk = r.outUnknown
      ? `<br><small class="dim">${t('econ.speed.outUnknown', {n: fmt(r.outUnknown), a: fmt(r.attempts)})}</small>` : '';
    return `<tr><td class="elbl"><b>${esc(engineLabel(k))}</b></td>
      <td class="n">${speedNum(r.outPerSec, v => dec(v, 1))}${unk}</td>
      <td class="n">${speedNum(r.secPerAttempt, v => secText(Math.round(v)))}</td>
      <td class="n">${speedNum(r.attemptsPerClosed, v => dec(v, 1))}</td>
      <td class="n">${speedNum(r.tokensPerClosed, v => fmt(Math.round(v)))}</td>
      <td class="n">${speedNum(r.usdPerClosed, v => '$' + dec(v, 4))}</td>
      <td class="n">${speedNum(r.cacheShare, v => Math.round(v * 100) + '%')}</td>
      <td class="n">${fmt(r.closedCards)}</td></tr>`;
  }).join('');
  const mrows = sp.byKind[SPEED_KIND].models || [];
  const mbody = mrows.map(r => {
    const unk = r.outUnknown
      ? `<br><small class="dim">${t('econ.speed.outUnknown', {n: fmt(r.outUnknown), a: fmt(r.attempts)})}</small>` : '';
    const mdl = r.model === 'unknown' ? `<span class="dim">${t('econ.speed.modelUnknown')}</span>` : `<span class="mono">${esc(r.model)}</span>`;
    return `<tr><td class="elbl"><b>${esc(engineLabel(r.engine))}</b></td><td>${mdl}</td>
      <td class="n">${speedNum(r.outPerSec, v => dec(v, 1))}${unk}</td>
      <td class="n">${fmt(r.out)}</td><td class="n">${secText(Math.round(r.outSeconds))}</td><td class="n">${fmt(r.attempts)}</td></tr>`;
  }).join('');
  const models = mrows.length
    ? `<h3>${t('econ.speed.modelTitle')}</h3><div class="etable-scroll"><table class="etable"><thead><tr><th>${t('econ.speed.thEngine')}</th><th>${t('econ.config.model')}</th><th class="n">${t('econ.speed.thOut')}</th><th class="n">${t('econ.speed.thOutTok')}</th><th class="n">${t('econ.speed.thOutSec')}</th><th class="n">${t('econ.speed.thAttempts')}</th></tr></thead><tbody>${mbody}</tbody></table></div>`
    : '';
  const kinds = ['all', ...sp.kinds];
  const filter = `<div class="e-seg" data-speed-kinds><span class="dim">${t('econ.speed.kind')}:</span> ${kinds.map(k =>
    `<span class="${k === SPEED_KIND ? 'on' : ''}" data-speed-kind="${esc(k)}">${k === 'all' ? t('econ.speed.kindAll') : esc(k)}</span>`).join('')}</div>`;
  const speed = tags.length
    ? `<div class="etable-scroll"><table class="etable"><thead><tr><th>${t('econ.speed.thEngine')}</th><th class="n">${t('econ.speed.thOut')}</th><th class="n">${t('econ.speed.thSec')}</th><th class="n">${t('econ.speed.thAtt')}</th><th class="n">${t('econ.speed.thTok')}</th><th class="n">${t('econ.speed.thUsd')}</th><th class="n">${t('econ.speed.thCache')}</th><th class="n">${t('econ.speed.thClosed')}</th></tr></thead><tbody>${body}</tbody></table></div>`
    : `<div class="nodata">${t('econ.speed.noData')}</div>`;
  return `<div class="tier"><div class="tier-lab">${t('econ.speed.title')}</div>
    ${hintFold(`<p class="hint">${t('econ.speed.hint')}</p>`)}
    ${filter}${speed}${models}${nodeModelsHtml(e.nodeModels)}</div>`;
}

function nodeModelsHtml(tables){
  const heading = `<h3>${t('econ.models.title')}</h3>`;
  if (!tables || !tables.length) return `${heading}<div class="nodata">${t('econ.models.none')}</div>`;
  const nodes = ['Intent', 'Spec', 'Kit', 'Run', 'Core'];
  const cell = (n, node) => { const m = n[node]; return m ? `<span class="mono">${esc(m.model)}</span> <small class="dim">${esc(m.effort)}</small>` : '<span class="dim">—</span>'; };
  return `${heading}<div class="etable-scroll"><table class="etable"><thead><tr><th>${t('econ.speed.thEngine')}</th>${nodes.map(n => `<th>${esc(n)}</th>`).join('')}</tr></thead><tbody>${tables.map(x =>
    `<tr><td class="elbl"><b>${esc(engineLabel(x.tag))}</b></td>${nodes.map(n => `<td>${cell(x.nodes, n)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function renderEconomy(d){
  const e = d.economy || {};
  const engines = e.engines || {};
  const keys = (e.byEngine && e.byEngine.keys || Object.keys(engines)).filter(k => engines[k]);
  if (!keys.includes(ECON_ENGINE)) ECON_ENGINE = keys[0] || null;
  const v = ECON_ENGINE ? engines[ECON_ENGINE] : null;
  const view = v
    ? { ...d, econEngine: ECON_ENGINE, byNode: v.byNode, byRoute: v.byRoute, economy: { ...e, ...v } }
    : { ...d, econEngine: null, byNode: [], byRoute: null };
  const dialog = ECON_ENGINE && d.dialog && ECON_ENGINE === d.dialog.sessionOwner ? d.dialog : null;
  const header = `<div class="e-topbar">
    <div class="e-seg">${keys.map(k =>
      `<span class="${k === ECON_ENGINE ? 'on' : ''}" data-engine="${esc(k)}">${esc(engineLabel(k))}</span>`).join('')}</div>
    <span class="dim">— ${t('econ.engineNote')}</span>
    ${trustBadgeHtml(e.coverage)}
  </div>`;
  const el = document.getElementById('economy');
  el.innerHTML = header
    + summaryHtml(e)
    + level1Html(d, view)
    + level2Html(view)
    + level3Html(view, dialog)
    + level4Html(d, view)
    + speedHtml(e)
    + level5Html(view);
  el.querySelectorAll('[data-speed-kind]').forEach(x => x.onclick = () => { SPEED_KIND = x.dataset.speedKind; renderEconomy(latestData); });
  el.querySelectorAll('[data-engine]').forEach(x => x.onclick = () => { ECON_ENGINE = x.dataset.engine; renderEconomy(latestData); });
}

if (typeof module !== 'undefined' && module.exports) module.exports = { tilePlace, tileFrac, tileModel, TILE_MIN_FRAC };
