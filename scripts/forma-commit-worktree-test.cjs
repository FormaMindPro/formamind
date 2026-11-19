#!/usr/bin/env node
// The linked-worktree chain of forma-commit.cjs, proved on a throwaway fixture: the hook installed once into the
// common git dir still commits from a worktree whose protocol submodule is not initialized (the hook falls back to
// the main clone), the commit carries its own staged path only, and a full protocol commit from the linked worktree
// stops with the main clone named. Nothing of the host project is read or written: the fixture is a temp dir with
// two stub scripts, and only the protocol clone (committed objects) is copied.
//   node .forma/protocol/scripts/forma-commit-worktree-test.cjs   - exit 0 green, 1 red; writes only into a temp dir
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, gitRun } = require('./lib/git.cjs');

const PROTO = path.resolve(__dirname, '..');
const COMMIT_SCRIPT = path.join(PROTO, 'scripts', 'forma-commit.cjs');

let failed = 0;
function check(name, ok, detail) {
  if (!ok) failed += 1;
  console.log((ok ? '\u2713 ' : '\u2717 ') + name + (ok || !detail ? '' : ': ' + String(detail).trim()));
  return ok;
}
const lines = (out) => String(out || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const norm = (s) => String(s).replace(/\\/g, '/').toLowerCase();

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-worktree-'));
const proj = path.join(base, 'proj');
const wt = path.join(base, 'wt');
let wtAdded = false;
let removeFail = null;

function writeStub(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

try {
  // 1. The fixture repository, with its own identity: nothing is read from the host's git config.
  fs.mkdirSync(proj);
  const init = gitRun(proj, 'init', '-q');
  const cfg = init.code === 0 && [
    ['user.name', 'fixture'],
    ['user.email', 'fixture@example.invalid'],
    ['commit.gpgsign', 'false'],
  ].every(([k, v]) => gitRun(proj, 'config', k, v).code === 0);
  check('fixture repository initialized with a local identity', init.code === 0 && cfg, init.out);

  // 2. The stubs the hook bodies call, and the protocol clone the hook resolves.
  writeStub(path.join(proj, '.forma', 'board', 'checks', 'goal-freeze.cjs'), '#!/usr/bin/env node\nprocess.exit(0);\n');
  writeStub(path.join(proj, '.claude', 'scripts', 'sync-engines.cjs'), '#!/usr/bin/env node\nprocess.exit(0);\n');
  // --no-hardlinks: the temp dir may sit on another volume than the source, where hardlinks are refused.
  const clone = gitRun(base, 'clone', '--quiet', '--local', '--no-hardlinks', PROTO, path.join(proj, '.forma', 'protocol'));
  check('protocol cloned into the fixture', clone.code === 0, clone.out);

  // 3. The stubs are the initial commit; the clone stays untracked, so a worktree starts without it.
  const stage = gitRun(proj, 'add', '--', '.forma/board/checks/goal-freeze.cjs', '.claude/scripts/sync-engines.cjs');
  const initial = stage.code === 0 ? gitRun(proj, 'commit', '-q', '-m', 'fixture stubs') : stage;
  check('fixture stubs committed', initial.code === 0, initial.out);

  // 4. The real script installs the hook; cwd is the fixture, so the hook lands in the fixture's git dir.
  const inst = run('node', [COMMIT_SCRIPT, '--install-hook'], { cwd: proj });
  const hook = path.join(proj, '.git', 'hooks', 'pre-commit');
  check('--install-hook writes pre-commit into the fixture', inst.code === 0 && fs.existsSync(hook), inst.out);

  // 5. A linked worktree of the fixture at HEAD: `.git` is a file, the protocol is absent.
  const add = gitRun(proj, 'worktree', 'add', '--detach', wt, 'HEAD');
  wtAdded = add.code === 0;
  if (check('git worktree add --detach HEAD', wtAdded, add.out)) {
    const dot = path.join(wt, '.git');
    check('.git in the linked worktree is a file', fs.existsSync(dot) && fs.statSync(dot).isFile(), dot);
    check('the linked worktree has no protocol clone', !fs.existsSync(path.join(wt, '.forma', 'protocol')), path.join(wt, '.forma', 'protocol'));

    // 6. No --no-verify: the goal-freeze stub passes, the hook falls back to the main clone's script, --sync-staged passes.
    fs.writeFileSync(path.join(wt, 'worktree-probe.txt'), 'probe\n');
    const addProbe = gitRun(wt, 'add', '--', 'worktree-probe.txt');
    check('git add worktree-probe.txt', addProbe.code === 0, addProbe.out);

    // 7. A path staged in the main worktree only must not enter the linked commit.
    fs.writeFileSync(path.join(proj, 'foreign.txt'), 'foreign\n');
    const addForeign = gitRun(proj, 'add', '--', 'foreign.txt');
    check('foreign.txt staged in the main worktree', addForeign.code === 0, addForeign.out);

    const commit = gitRun(wt, 'commit', '-m', 'worktree probe');
    if (check('git commit with the installed hook passes', commit.code === 0, commit.out)) {
      const files = lines(gitRun(wt, 'show', '--name-only', '--format=', 'HEAD').out);
      check('the commit carries exactly worktree-probe.txt', files.length === 1 && files[0] === 'worktree-probe.txt', JSON.stringify(files));
      check('the commit carries no foreign path', !files.includes('foreign.txt'), JSON.stringify(files));
    } else {
      console.log('  the commit did not happen - the carried file list is not checked');
    }

    // 8. A full protocol commit from here shares the main clone's branch: a stop naming the main clone.
    const stopped = run('node', [COMMIT_SCRIPT, 'probe'], { cwd: wt });
    check('a protocol commit from the linked worktree stops', stopped.code !== 0, stopped.out);
    check('the stop names the main clone', norm(stopped.out).includes(norm(proj)), stopped.out);
  }
} finally {
  if (wtAdded) {
    const rem = gitRun(proj, 'worktree', 'remove', '--force', wt);
    if (rem.code !== 0) removeFail = rem.out;
  }
  try { fs.rmSync(base, { recursive: true, force: true }); } catch (e) { removeFail = removeFail || e.message; }
  check('the fixture and its linked worktree are removed', !removeFail, removeFail);
}

console.log(failed ? `\u2717 ${failed} failure(s)` : '\u2713 worktree chain is green');
process.exit(failed ? 1 : 0);
