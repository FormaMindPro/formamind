'use strict';

// Registry of the board checks - part of the core, one for all engines. One check - one file next door: `{ id, since, run(ctx) }`
// (the form - `.forma/dashboard/lib/checks.cjs`). A new check - a new file and one line here; the order of lines - the order of findings.
// Check helpers live in `support/`. The registry is run by `.forma/board/check-board.cjs`.

module.exports = [
  require('./epics.cjs'),
  require('./route-labels.cjs'),
  require('./route-stage.cjs'),
  require('./route-executor.cjs'),
  require('./run-model-override.cjs'),
  require('./status-values.cjs'),
  require('./card-materials.cjs'),
  require('./spend-language.cjs'),
  require('./key-language.cjs'),
  require('./core-closing.cjs'),
  require('./attempt-parses.cjs'),
  require('./attempt-format.cjs'),
  require('./agent-id.cjs'),
  require('./engine-tag.cjs'),
  require('./ledger-parity.cjs'),
  require('./budget-stop.cjs'),
  require('./human-row-trace.cjs'),
  require('./route-regression.cjs'),
  require('./check-ready.cjs'),
  require('./check-english-code.cjs'),
  require('./law-thresholds-declared.cjs'),
  require('./law-external-exits.cjs'),
  require('./law-push-verify-rule.cjs'),
];
