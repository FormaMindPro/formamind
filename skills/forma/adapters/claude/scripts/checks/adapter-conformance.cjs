'use strict';

// An engine adapter is found by its §8 file; ready - when it carries a conformance test of the economy contract (ECONOMY.md).
// Not ready - an info note (a line in `ctx.info`, ready to print), not a violation.
// Finding labels come from the core dictionary: English key in code, ru value as data.

const fs = require('fs');
const path = require('path');
const { runTestFile } = require('../../../.forma/dashboard/lib/checks.cjs');
const { isDormant } = require('./support/dormant.cjs');
const i18n = require('../../../.forma/i18n/index.cjs');
const msg = (code, params) => i18n.message(code, params, 'ru');

// Codex declares no forma-adapter.cjs - its line is static; the other engines come from the project's adapters.
const STATIC = [{ id: 'codex', name: 'Codex', eight: '.codex/CODEX-8.md', test: '.codex/tests/test-codex-usage.cjs' }];
const TEST_RE = /^(test-.*(adapter|usage).*\.cjs|.*(economy|adapter)\.test\.cjs)$/;

/** The adapter's conformance test: the first matching file in its testsDir, then in scriptsDir. */
function findTest(root, src) {
  for (const dir of [src.testsDir, src.scriptsDir]) {
    if (!dir) continue;
    const abs = path.join(root, ...dir.split('/'));
    let names = [];
    try { names = fs.readdirSync(abs).sort(); } catch { continue; }
    const hit = names.find((n) => TEST_RE.test(n));
    if (hit) return dir + '/' + hit;
  }
  return null;
}

/** A human-readable engine name from its tag: `claude-code` -> `Claude Code` (the adapter shape has no separate name field). */
const humanName = (tag) => String(tag).split(/[-_]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

/** The project's adapters (a folder with forma-adapter.cjs) and the static ones: [{ id?, name, eight, test }]. */
function listAdapters(root) {
  const E = require('../../../.forma/dashboard/lib/engines.cjs');
  const found = E.loadAdapters(root)
    .filter((a) => typeof a.engineRulesFile === 'string')
    .map((a) => ({ id: E.idOf(a), name: humanName(a.engine || E.idOf(a)), eight: a.engineRulesFile, test: findTest(root, E.sourcesOf(a)) }));
  return [...found, ...STATIC];
}

/** One adapter: violations into `problems`, info into `info`. No §8 file - the adapter is not installed, silence. */
function checkAdapter(root, a, problems, info) {
  if (!fs.existsSync(path.join(root, a.eight))) return;
  if (a.id && isDormant(root, a.id)) { info.push(msg('adapter-conformance.dormant', { name: a.name })); return; }
  if (!a.test) { info.push(msg('adapter-conformance.not_ready', { name: a.name })); return; }
  if (!fs.existsSync(path.join(root, a.test))) { problems.push(msg('adapter-conformance.no_test', { name: a.name, test: a.test })); return; }
  const bad = runTestFile(root, a.test);
  if (bad) problems.push(msg('adapter-conformance.failed', { name: a.name, bad }));
  else info.push(msg('adapter-conformance.passed', { name: a.name }));
}

function run({ root, info }) {
  const problems = [];
  const notes = [];
  for (const a of listAdapters(root)) checkAdapter(root, a, problems, notes);
  if (!notes.length && !problems.length) problems.push(msg('adapter-conformance.none'));
  if (info) info.push(...notes.map((l) => '    ✓ ' + l));
  return problems;
}

module.exports = { id: 'adapter-conformance', since: null, run };
