'use strict';

// The Claude Code engine reconciliation registry: what `sync-engines.cjs` runs in a circle. One check - one file:
// `{ id, since, run(ctx) }` (the shape - `.forma/dashboard/lib/checks.cjs`). A new check - a new file and one line here;
// the line order is the order of findings in the output. The core checks (board, manual, integrity) live in the core
// and are wired in here by path; the adapter checks sit next door. Helpers - in `support/`.

module.exports = [
  require('./root-rules.cjs'),
  require('./rules-size.cjs'),
  require('../../../.forma/dashboard/checks/manual-languages.cjs'),
  require('../../../.forma/dashboard/checks/locale-parity.cjs'),
  ...require('../../../.forma/board/checks/index.cjs'),
  require('./engine-impersonal.cjs'),
  require('../../../.forma/dashboard/checks/core-integrity.cjs'),
  require('./claude-delivery.cjs'),
  require('./adapter-conformance.cjs'),
  require('./codex.cjs'),
  require('./kimi.cjs'),
  require('./law-pointers.cjs'),
];
