// The git and command-run wrappers for the author scenarios (`protocol/scripts/lib/git.cjs`).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { run, gitRun, gitOut } = require('../scripts/lib/git.cjs');

let dir;
test.before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-git-'));
  const g = (...a) => gitRun(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a);
  assert.equal(gitRun(dir, 'init', '-q').code, 0);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  g('add', '-A');
  assert.equal(g('commit', '-q', '-m', 'first').code, 0);
});
test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

test('run: the exit code and the merged output, does not throw', () => {
  const ok = run(process.execPath, ['-e', 'console.log("out"); console.error("err")']);
  assert.equal(ok.code, 0);
  assert.match(ok.out, /out/);
  assert.match(ok.out, /err/);
  const bad = run(process.execPath, ['-e', 'process.exit(3)']);
  assert.equal(bad.code, 3);
});

test('run: cwd comes from the option, by default the current directory', () => {
  const here = run(process.execPath, ['-e', 'process.stdout.write(process.cwd())']);
  assert.equal(here.out, process.cwd());
  const there = run(process.execPath, ['-e', 'process.stdout.write(process.cwd())'], { cwd: dir });
  assert.equal(fs.realpathSync(there.out), fs.realpathSync(dir));
});

test('gitRun: the code and the output, a git error - a code, not an exception', () => {
  const st = gitRun(dir, 'status', '--porcelain');
  assert.equal(st.code, 0);
  assert.equal(st.out.trim(), '');
  const bad = gitRun(dir, 'rev-parse', '--verify', '-q', 'refs/heads/no-such');
  assert.notEqual(bad.code, 0);
  const nogit = gitRun(os.tmpdir(), 'rev-parse', '--git-dir');
  assert.ok(typeof nogit.code === 'number');
});

test('gitOut: stdout as a string; a non-zero code throws, stderr not printed', () => {
  assert.equal(gitOut(dir, 'log', '--format=%s').trim(), 'first');
  assert.equal(gitOut(dir, 'show', 'HEAD:a.txt'), 'one\n');
  assert.throws(() => gitOut(dir, 'show', 'HEAD:no-such-file'));
  assert.throws(() => gitOut(dir, 'cat-file', '-e', 'deadbeef^{commit}'));
});
