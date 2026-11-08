'use strict';

/**
 * The economy and the spend for the dashboard: the whole corpus (the fields without tokens) and the slices by engines.
 * `spend-views.cjs` does the counting; here - the instruction weight from the adapter and the reading of `tally.cjs` (routes, engines).
 */

const fs = require('fs');
const path = require('path');
const { boardDir } = require('../lib/card.cjs');
const engines = require('../lib/engines.cjs');
const { spendViews } = require('./spend-views.cjs');
const { buildSpeed, buildSummary } = require('./speed.cjs');

/**
 * The instruction weight from the adapter. No adapter or weight field - the 'unknown' value, not null and not 0
 * (`weightKnown` - whether the steps can be counted).
 */
function weightContext(projectRoot) {
  const weightOf = engines.first(projectRoot, 'instructionWeight');
  const stepsOf = engines.first(projectRoot, 'stepsFromCacheRead');
  const instrWeight = weightOf ? weightOf() : null;
  return {
    instrWeight,
    stepsOf,
    weightKnown: instrWeight !== null && !!stepsOf,
    stepWeight: (node) => ((instrWeight && instrWeight.byNode) || {})[node],
  };
}

/** The slice by route tags for one engine; `tally.cjs` unreadable - `null`. */
function readByRoute(projectRoot, engine) {
  try {
    return require('../tally.cjs').byRoute([boardDir(projectRoot)], engine, engines.canonicalTag(projectRoot));
  } catch { return null; } // no parse - the tab will show "no data", not zero
}

/** The adapters' call ledgers: { the engine's canonical tag: [records] } from <the adapter's directory>/.ledger/calls.jsonl; a missing file or a broken line - skipped. */
function readLedgers(projectRoot, canon) {
  const out = {};
  for (const a of engines.loadAdapters(projectRoot)) {
    const tag = canon(a.spendTag || a.engine || engines.idOf(a));
    let text = '';
    try { text = fs.readFileSync(path.join(projectRoot, a.dir, '.ledger', 'calls.jsonl'), 'utf8'); } catch { continue; }
    const list = out[tag] || (out[tag] = []);
    for (const l of text.split(String.fromCharCode(10))) { if (!l.trim()) continue; try { list.push(JSON.parse(l)); } catch {} }
  }
  return out;
}

/** The accepted cards - the files of `done/` (no directory - 0). */
function countAccepted(projectRoot) {
  try {
    return fs.readdirSync(path.join(boardDir(projectRoot), 'done')).filter((f) => f.endsWith('.md')).length;
  } catch { return 0; } // no done/ - no accepted cards
}

/**
 * The slice by engines: a column per tag, the tokens of different engines are not summed. The common row - only
 * the common fields: attempts, time, accepted cards.
 */
/** The project's engines by the adapters (`engines.engineTags`). */
const adapterEngines = (projectRoot) => engines.engineTags(projectRoot);

function readByEngine(projectRoot) {
  try {
    const t = require('../tally.cjs').tally([boardDir(projectRoot)], engines.canonicalTag(projectRoot));
    const columns = { ...t.byEngine };
    // An engine with an adapter gets its column from the engine's folder itself, even without a single spend line.
    for (const { tag, aliases } of adapterEngines(projectRoot)) {
      if (aliases.some((x) => x in columns)) continue;
      columns[tag] = { attempts: 0, tokens: 0, cacheRead: 0, withCacheRead: 0, seconds: 0, withSeconds: 0, usd: 0, cards: 0, unknown: require('../economy.cjs').unknownCount(require('../economy.cjs').emptyAcc()) };
    }
    const keys = Object.keys(columns).sort((a, b) => (a === 'untagged') - (b === 'untagged') || a.localeCompare(b));
    const common = { attempts: 0, seconds: 0, withSeconds: 0, secondsUnknown: 0, accepted: countAccepted(projectRoot) };
    for (const k of keys) {
      const v = columns[k];
      common.attempts += v.attempts; common.seconds += v.seconds;
      common.withSeconds += v.withSeconds; common.secondsUnknown += v.unknown.duration_s;
    }
    return { keys, columns, common };
  } catch { return null; } // no parse - the tab will show "no data"
}

/** The cards holding only one engine's attempts (the tokens and the money re-counted). */
function cardsOfEngine(cards, engine) {
  return cards.map((c) => {
    const a = c.attempts.filter((z) => z.engine === engine);
    return { ...c, attempts: a, tokensTotal: a.reduce((s, z) => s + (z.tokens || 0), 0), costUsdTotal: a.reduce((s, z) => s + z.costUsd, 0) };
  });
}

/** The token slices - per engine: the corpus token fields are summed across engines and are not shown on the tab. */
function engineViews(projectRoot, cards, w) {
  const out = {};
  const seen = new Set(cards.flatMap((c) => c.attempts.map((z) => z.engine)));
  for (const { tag, aliases } of adapterEngines(projectRoot)) if (!aliases.some((x) => seen.has(x))) seen.add(tag);
  for (const k of seen) {
    const v = spendViews(cardsOfEngine(cards, k), w);
    out[k] = {
      byNode: v.byNode, totals: v.economy.totals, coverage: v.economy.coverage,
      topCards: v.economy.topCards, byDate: v.economy.byDate, efficiency: v.economy.efficiency,
      byRoute: readByRoute(projectRoot, k),
    };
  }
  return out;
}

/**
 * The spend: the corpus's `byNode` and `economy` - only the fields without tokens (the coverage, the services, the
 * blind spots, the malformed lines) - plus `economy.byEngine` and `economy.engines[tag]`.
 */
function buildSpend(projectRoot, rawCards) {
  // The aliases of one engine's tag fold into one column; the spend lines in the cards are not rewritten.
  const canon = engines.canonicalTag(projectRoot);
  const cards = rawCards.map((c) => ({ ...c, attempts: c.attempts.map((z) => ({ ...z, engine: canon(z.engine) })) }));
  const w = weightContext(projectRoot);
  const corpus = spendViews(cards.map((c) => ({ ...c, tokensTotal: 0 })), w);
  const byNode = corpus.byNode.map((n) => ({
    node: n.node, costUsdTotal: n.costUsdTotal, attemptCount: n.attemptCount,
    externalAttemptCount: n.externalAttemptCount, cardCount: n.cardCount,
    secondsTotal: n.secondsTotal, withSeconds: n.withSeconds, avgSeconds: n.avgSeconds,
  }));
  const economy = corpus.economy;
  for (const k of ['totals', 'topCards', 'byDate', 'efficiency']) delete economy[k];
  economy.byEngine = readByEngine(projectRoot);
  economy.engines = engineViews(projectRoot, cards, w);
  // The speed and the efficiency per engines, and the model/effort per nodes from the adapter's contract (`nodeModels`) - for each engine.
  const tables = engines.nodeModelTables(projectRoot);
  // An attempt's model - by the node-model table of its engine's adapter; no table or the node absent from it - `unknown` in the slice.
  const modelOf = (engine, node) => {
    const t = tables.find((x) => canon(x.tag) === engine);
    const row = t && t.nodeModels && t.nodeModels[node];
    return row && typeof row.model === 'string' ? row.model : null;
  };
  economy.speed = buildSpeed(cards, adapterEngines(projectRoot).filter((e) => !e.aliases.some((x) => cards.some((c) => c.attempts.some((z) => z.engine === x)))).map((e) => e.tag), modelOf);
  economy.speed.summary = buildSummary(cards, readLedgers(projectRoot, canon), adapterEngines(projectRoot).map((e) => e.tag));
  economy.nodeModels = tables.map(({ tag, nodeModels }) => ({ tag, nodes: nodeModels }));
  return { byNode, economy };
}

module.exports = { buildSpend };
