#!/usr/bin/env node
// The board check of .devtool/features/ - part of the core, one for all engines (AGENTS.md §6–7).
// Epics and goals, route labels and stages, card materials, spend lines (§3), the Core closing.
// The checks themselves - the registry `.forma/board/checks/`: one check - one file, the order - in `.forma/board/checks/index.cjs`.
//
//   node .forma/board/check-board.cjs [<card-id>]   - all the board violations; with <card-id> - only this card's lines.
//   Exit: 0 - no violations, 1 - there are (printed line by line, with the «— » prefix).
// Module: require('./check-board.cjs').checkBoard(root) → [lines of violations]. The engine calls it
// from its reconciliation (sync-engines) and from its card-write hook.

const path = require('path');
const { runChecks } = require('../dashboard/lib/checks.cjs');
const CHECKS = require('./checks/index.cjs');

const ROOT = path.resolve(__dirname, '..', '..');

/** The board violations of the project `root` (by default - the project the script lies in), in the registry's order.
 *  `info` - an optional array for the checks' notes (not violations: "the journal does not cover", the Core queue). */
function checkBoard(root, info) {
  return runChecks(CHECKS, { root: root ? path.resolve(root) : ROOT, ...(Array.isArray(info) ? { info } : {}) });
}

module.exports = { checkBoard, CHECKS };

if (require.main === module) {
  const id = process.argv[2];
  const info = [];
  const problems = checkBoard(undefined, info).filter((p) => !id || p.includes(id));
  for (const n of info.filter((n) => !id || n.includes(id))) console.log('    · ' + n);
  for (const p of problems) console.log('    — ' + p);
  process.exit(problems.length ? 1 : 0);
}
