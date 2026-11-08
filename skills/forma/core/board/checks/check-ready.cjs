'use strict';

// Judge of a card's readiness (criterion gates, the fact dossier, recorded exceptions) as a board check:
// it runs the self-check .forma/board/check-ready-sandbox.cjs - an honest run of the sandbox card plus
// tamper probes: a broken gate does not yield green (code 1), an exception in History that named the gate
// skips it with an explicit mark (code 0), an exception without an address - fail-closed, runtime errors - code 2.
// Thereby the "gate + verdict" convention is held by machine - the common check-board / sync-engines --check pass.

const i18n = require('../../i18n/index.cjs');
const { runTestFile } = require('../../dashboard/lib/checks.cjs');

const SCRIPT = '.forma/board/check-ready-sandbox.cjs';

function run({ root }) {
  const failure = runTestFile(root, SCRIPT);
  return failure ? [failure + i18n.message('board.check-ready.suffix', null, 'ru')] : [];
}

module.exports = { id: 'check-ready', since: null, run };
