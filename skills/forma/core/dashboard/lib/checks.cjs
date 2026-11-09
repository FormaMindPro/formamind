'use strict';

/**
 * The checks registry: one check - one module `{ id, since, run(ctx) -> findings }`. Part of the core's
 * shared library (`.forma/dashboard/lib/`); the registry is an array of such modules in the `index.cjs` next
 * to them, the array's order is the findings' order.
 *
 *   id      the check's name, latin through a hyphen; equals its file's name
 *   since   a rule key in `.forma/living/checks.json` or `null` when the rule is undated. The core knows only
 *           the key, the entry day is written by the project (`rules.ruleSince`)
 *   run     `run(ctx)` -> an array of finding lines; an empty one - the check is clean. `ctx.root` - the
 *           project root, `ctx.since` - the rule's entry day (`YYYY-MM-DD`) or `null`; the rest of ctx the
 *           checks take from the runner (say, `ctx.info` - the facts that are not violations)
 */

const path = require('path');
const { spawnSync } = require('child_process');
const rules = require('./rules.cjs');
// Canonical ru strings of the registry's findings live in the core dictionary; the language is fixed.
const { message: coreMessage } = require('../../i18n/index.cjs');
const ruMsg = (key, params) => coreMessage(key, params, 'ru');

const ID_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** The findings of all the registry's checks, glued in the registry's order; each one's entry day is taken from `.forma/living/checks.json`. */
function runChecks(checks, ctx) {
  return checks.flatMap((check) => {
    const since = check.since ? rules.ruleSince(ctx.root, check.since) : null;
    return check.run({ ...ctx, since });
  });
}

/** What is wrong with the registry: an empty list - the shape is held (the fields, the `since` type, the `id` uniqueness). */
function validateChecks(checks) {
  const problems = [];
  const seen = new Set();
  for (const check of checks) {
    const id = check && check.id;
    if (typeof id !== 'string' || !ID_RE.test(id)) { problems.push(ruMsg('checks.id_latin', { id })); continue; }
    if (seen.has(id)) problems.push(ruMsg('checks.id_twice', { id }));
    seen.add(id);
    if (check.since !== null && typeof check.since !== 'string') problems.push(ruMsg('checks.since_key', { id }));
    if (typeof check.run !== 'function') problems.push(ruMsg('checks.run_fn', { id }));
  }
  return problems;
}

/** Running a test file as an integrity check: `null` - passed, otherwise a line with the exit code and the output's tail. */
function runTestFile(root, rel) {
  const r = spawnSync(process.execPath, [path.join(root, rel)], { cwd: root, encoding: 'utf8' });
  const tail = (r.stderr || r.stdout || '').trim().split(String.fromCharCode(10)).pop().trim();
  return r.status === 0 ? null : ruMsg('checks.test_failed', { file: rel, code: r.status, tail: tail.slice(0, 160) });
}

module.exports = { runChecks, validateChecks, runTestFile };
