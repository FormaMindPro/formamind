'use strict';

// Registry wrapper for `external-exits.cjs` - the scrub law (prohibition 17) as a standing board
// check. The subject - the tracked scripts of the project (the detection is `git grep` over the
// working tree); a project root that is not a git work tree carries no subject - the check skips
// without findings (a fresh install before the first commit stays green). An unexpected fall of
// the scan is a finding, not a silent green (fail-closed).

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { runExternalExits } = require('./external-exits.cjs');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function isGitWorkTree(root) {
  const r = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root, encoding: 'utf8' });
  return r.status === 0 && String(r.stdout).trim() === 'true';
}

function run(ctx = {}) {
  const root = ctx.root || ROOT;
  if (!isGitWorkTree(root)) return []; // not a git work tree - no tracked scripts, no subject, skip
  try {
    const { lines } = runExternalExits({ root });
    return lines.filter((l) => l.status === 'red').map((l) => 'law-external-exits: ' + l.fact);
  } catch (e) {
    return ['law-external-exits: the scan fell: ' + (e && e.message ? e.message : String(e))];
  }
}

module.exports = { id: 'law-external-exits', since: null, run };
