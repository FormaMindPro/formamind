#!/usr/bin/env node
// Rebuilds the snapshot of epics/cards/spend out of .devtool/features/**/*.md.
// Not a store - a cache: the cards remain the single truth (AGENTS.md §3, "Spend is counted by fact").
// .forma/dashboard/ is not part of .devtool/ (that belongs to the Kanban Markdown extension, .devtool/features/);
// this is a separate arsenal tool in the project root that simply reads .devtool/features/.
// Exports buildData() for serve.js (a live rebuild without writing the file) and works as a CLI:
// Run: node .forma/dashboard/generate.js  ->  .forma/dashboard/.cache/data.json
//
// Only the assembly lives here: every tab is read by its own module from `data/`
// (cards and attempts, spend, graphify, subagents, the interview, settings, routes, the board).
// Whatever only the engine knows, the core takes from the adapter through `lib/engines.cjs`; no adapter
// or field - the datum is `unknown`, the other quantities suffer nothing.

const fs = require('fs');
const path = require('path');
// Canonical ru strings of the console output live in the core dictionary; the language is fixed.
const { message: coreMessage } = require('../i18n/index.cjs');
const ruMsg = (key, params) => coreMessage(key, params, 'ru');

// The server hot-reloads only this file, so the `data/` modules are read anew on every load.
const DATA_DIR = path.join(__dirname, 'data') + path.sep;
for (const key of Object.keys(require.cache)) {
  if (key.startsWith(DATA_DIR)) delete require.cache[key];
}

const { readSpendCards, groupEpics, cardTotals } = require('./data/cards.cjs');
const { buildSpend } = require('./data/spend.cjs');
const { readNodeConfig } = require('./data/nodes.cjs');
const { readFormaCatalog } = require('./data/forma.cjs');
const { buildGraphify, graphsBuilt } = require('./data/graphify.cjs');
const { readSessionEconomy, readDialog } = require('./data/dialog.cjs');
const { readSubagentsRegistry } = require('./data/subagents.cjs');
const { buildBort } = require('./data/bort.cjs');
const { buildChain } = require('./data/chain.cjs');
const { readInterview } = require('./data/interview.cjs');
const { readProjectSettings, readEngineSettings } = require('./data/settings.cjs');
const { buildBoard } = require('./data/board.cjs');
const { buildDocs } = require('./data/docs.cjs');

/** The structure tree is re-read every time: the server hot-reloads only `generate.js`. */
function readStructure(projectRoot) {
  delete require.cache[require.resolve('./structure.cjs')];
  return require('./structure.cjs').buildStructure(projectRoot);
}

/** The engine schema is re-read every time (like the structure). */
function readSchema(projectRoot) {
  for (const m of ['./schema-manifest.cjs', './schema.cjs', './schema-view.cjs']) delete require.cache[require.resolve(m)];
  return require('./schema-view.cjs').buildSchemaView(projectRoot);
}

function buildData(projectRoot) {
  const cards = readSpendCards(projectRoot);
  const epics = groupEpics(cards);
  const totals = cardTotals(cards, epics);
  const { byNode, economy } = buildSpend(projectRoot, cards);
  return {
    generatedAt: new Date().toISOString(),
    totals,
    byNode,
    // The cut by route labels - by the engine tag, in economy.engines[tag].byRoute.
    economy,
    sessionEconomy: readSessionEconomy(projectRoot),
    dialog: readDialog(projectRoot),
    bort: buildBort(projectRoot),
    nodeConfig: readNodeConfig(projectRoot),
    formaCatalog: readFormaCatalog(projectRoot),
    ...buildGraphify(projectRoot),
    subagents: readSubagentsRegistry(projectRoot),
    epics: Object.values(epics).sort((a, b) => a.epic.localeCompare(b.epic, 'ru')),
    chain: buildChain(projectRoot),
    interview: readInterview(projectRoot),
    structure: readStructure(projectRoot),
    schema: readSchema(projectRoot),
    settings: { project: readProjectSettings(projectRoot), engine: readEngineSettings(projectRoot) },
    board: buildBoard(projectRoot),
    docs: buildDocs(projectRoot),
    graphsBuilt: graphsBuilt(projectRoot),
  };
}

module.exports = { buildData };

/** CLI: build the data and write it into the `.forma/dashboard/.cache/data.json` cache. */
function main() {
  const root = path.resolve(__dirname, '..', '..');
  const outFile = path.join(__dirname, '.cache', 'data.json');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const data = buildData(root);
  fs.writeFileSync(outFile, JSON.stringify(data, null, 2), 'utf8');
  console.log(ruMsg('generate.built', { cards: data.totals.cardCount, epics: data.totals.epicCount, tokens: JSON.stringify(data.totals.tokensByEngine), attempts: data.totals.attemptCount }));
  console.log(`→ ${path.relative(root, outFile)}`);
}

// Run directly (not require from serve.js) - build and write into the cache.
if (require.main === module) main();
