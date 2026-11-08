'use strict';

// Route regression (AGENTS.md §2) as a board check: it runs the sandbox .forma/board/route-regression.cjs
// (a Spec→Kit→Run imitation + tamper probes) in the common check-board / sync-engines --check pass.
// Thereby edits of AGENTS.md and role files never stay without a machine check of the route -
// the housekeeping runs this pass after every such edit.

const i18n = require('../../i18n/index.cjs');
const { runTestFile } = require('../../dashboard/lib/checks.cjs');

const SCRIPT = '.forma/board/route-regression.cjs';

function run({ root }) {
  const failure = runTestFile(root, SCRIPT);
  return failure ? [failure + i18n.message('board.route-regression.suffix', null, 'ru')] : [];
}

module.exports = { id: 'route-regression', since: null, run };
