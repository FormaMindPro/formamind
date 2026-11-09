'use strict';

// The core is one for all engines: the law, the manual, the economy module with its conformance test, the
// interview, the board, the dashboard. A core check; the engines' sync puts it into the registry. An engine's
// adapter is checked separately - by its own conformance test of the economy contract (ECONOMY.md).

const fs = require('fs');
const path = require('path');
const { walk } = require('../lib/fs.cjs');
// The findings' canonical ru strings live in the core dictionary; the language is fixed.
const { message: coreMessage } = require('../../i18n/index.cjs');
const ruMsg = (key, params) => coreMessage(key, params, 'ru');
const { runTestFile } = require('../lib/checks.cjs');

const NEED = ['AGENTS.md', '.forma/manual/en/03-protocol/ECONOMY.md', '.forma/manual/ru/03-protocol/ECONOMY.md',
  '.forma/dashboard/economy.cjs', '.forma/dashboard/economy.test.cjs', '.forma/dashboard/tally.cjs', '.forma/dashboard/spend-line.cjs'];
const PARTS = ['.forma/skills/grilling/SKILL.md', '.forma/skills/forma-grill-with-ui/SKILL.md', '.forma/skills/forma-grill-with-ui/server.mjs',
  '.forma/board/new-card.cjs', '.forma/board/card-move.cjs', '.forma/board/check-board.cjs', '.forma/board/DATA-MODEL.md', '.devtool/features', '.forma/dashboard/generate.js'];
// The core's parts without an engine: an engine's path or name in them is a violation. The names are assembled
// from parts: a check looking for an engine binding must not be bound itself.
const ENGINE_FREE_DIRS = ['.forma/skills/grilling', '.forma/skills/forma-grill-with-ui', '.forma/board'];
const ENGINE_DIRS = ['cla' + 'ude', 'co' + 'dex', 'age' + 'nts'].join('|');
const ENGINE_BOUND = new RegExp('\\.(' + ENGINE_DIRS + ')[/\\\\]|\\bClau' + 'de Code\\b|\\bMonitor tool\\b');

const exists = (root, rel) => fs.existsSync(path.join(root, rel));

/** The core's parts bound to an engine: `core: <dir>/<file> is bound to an engine - "<match>"`. */
function engineBoundProblems(root) {
  const problems = [];
  for (const dir of ENGINE_FREE_DIRS) {
    for (const f of walk(path.join(root, dir)).sort()) {
      const m = fs.readFileSync(path.join(root, dir, f), 'utf8').match(ENGINE_BOUND);
      if (m) problems.push(ruMsg('core_integrity.engine_bound', { path: dir + '/' + f, hit: m[0] }));
    }
  }
  return problems;
}

function run({ root }) {
  const missing = NEED.filter((rel) => !exists(root, rel));
  const problems = missing.map((rel) => ruMsg('core_integrity.missing', { path: rel }));
  for (const rel of PARTS) if (!exists(root, rel)) problems.push(ruMsg('core_integrity.missing', { path: rel }));
  problems.push(...engineBoundProblems(root));
  if (!missing.includes('.forma/dashboard/economy.test.cjs') && !missing.includes('.forma/dashboard/economy.cjs')) {
    const bad = runTestFile(root, '.forma/dashboard/economy.test.cjs');
    if (bad) problems.push(ruMsg('core_integrity.prefix') + bad);
  }
  return problems;
}

module.exports = { id: 'core-integrity', since: null, run };
