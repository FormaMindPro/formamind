'use strict';

// Registry wrapper for `push-verify-rule.cjs` - the push-verdict rule of the law (§2) as a standing
// board check. The subject - the engine mirrors of the project (the root-level zones carrying
// `agents/run.md`); the template half (the protocol source) is judged with them when the source is
// in place. No engine mirrors - no subject: the check skips without findings, a fresh install stays
// green; the subject present - the full gate run.

const path = require('node:path');
const { collect, findMirrors } = require('./push-verify-rule.cjs');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function run(ctx = {}) {
  const root = ctx.root || ROOT;
  if (findMirrors(root).length === 0) return []; // no engine mirrors - no subject, skip
  try {
    const { problems } = collect({ root });
    return problems.map((m) => 'law-push-verify-rule: ' + m);
  } catch (e) {
    return ['law-push-verify-rule: the gate fell: ' + (e && e.message ? e.message : String(e))];
  }
}

module.exports = { id: 'law-push-verify-rule', since: null, run };
