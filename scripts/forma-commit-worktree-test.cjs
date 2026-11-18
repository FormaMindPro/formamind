#!/usr/bin/env node
// The linked-worktree check of the pre-commit chain: the hook is installed once into the common git dir, a worktree
// whose submodule is not initialized still commits, and the commit carries its own file only. A commit from the
// linked worktree of the protocol itself is refused with the main clone named.
//   node .forma/protocol/scripts/forma-commit-worktree-test.cjs   - exit 0 green, 1 red; writes only into a temp dir
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, gitRun } = require('./lib/git.cjs');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SCRIPT = path.join(ROOT, '.forma', 'protocol', 'scripts', 'forma-commit.cjs');
const REL_SCRIPT = path.join('.forma', 'protocol', 'scripts', 'forma-commit.cjs');

let failed = 0;
function check(name, ok, detail) {
  if (!ok) failed += 1;
  console.log((ok ? '\u2713 ' : '\u2717 ') + name + (ok || !detail ? '' : ': ' + String(detail).trim()));
  return ok;
}
const lines = (out) => String(out || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

// The hook is the project's, not the worktree's: installed once from the main clone, shared by every worktree.
const inst = run('node', [REL_SCRIPT, '--install-hook'], { cwd: ROOT });
check('--install-hook from the main clone', inst.code === 0, inst.out);

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-worktree-'));
const wt = path.join(base, 'wt');
let removeFail = null;
try {
  const add = gitRun(ROOT, 'worktree', 'add', '--detach', wt, 'HEAD');
  if (check('git worktree add --detach HEAD', add.code === 0, add.out)) {
    const dot = path.join(wt, '.git');
    check('.git in the linked worktree is a file', fs.existsSync(dot) && fs.statSync(dot).isFile(), dot);

    fs.writeFileSync(path.join(wt, 'worktree-probe.txt'), 'probe\n');
    const stage = gitRun(wt, 'add', '--', 'worktree-probe.txt');
    check('git add worktree-probe.txt', stage.code === 0, stage.out);

    // No --no-verify: the hook runs the goal-freeze gate and the protocol check; both must pass here.
    const commit = gitRun(wt, 'commit', '-m', 'worktree probe');
    if (check('git commit with the hook installed passes', commit.code === 0, commit.out)) {
      const files = lines(gitRun(wt, 'show', '--name-only', '--format=', 'HEAD').out);
      check('the commit carries exactly worktree-probe.txt', files.length === 1 && files[0] === 'worktree-probe.txt', JSON.stringify(files));
    } else {
      console.log('  the commit did not happen - the carried file list is not checked');
    }

    // The shared branch is the main clone's: a protocol commit, a release or a push from here is a stop naming it.
    const stopped = run('node', [SCRIPT, 'worktree probe'], { cwd: wt });
    check('a protocol commit from the linked worktree stops', stopped.code !== 0, stopped.out);
    check('the stop names the main clone', stopped.out.includes(ROOT), stopped.out);
  }
} finally {
  if (fs.existsSync(wt)) {
    const rem = gitRun(ROOT, 'worktree', 'remove', '--force', wt);
    if (rem.code !== 0) removeFail = rem.out;
  }
  try { fs.rmSync(base, { recursive: true, force: true }); } catch (e) { removeFail = removeFail || e.message; }
  check('the linked worktree is removed', !removeFail, removeFail);
}

console.log(failed ? `\u2717 ${failed} failure(s)` : '\u2713 worktree chain is green');
process.exit(failed ? 1 : 0);
