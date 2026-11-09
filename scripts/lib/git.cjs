// Running commands and git for the protocol author's scripts (protocol/scripts). Not part of the package:
// like the scripts themselves, it is only needed where protocol/ is a git clone of FormaMindPro/formamind.
'use strict';
const { spawnSync, execFileSync } = require('child_process');

const MAX_BUFFER = 64 << 20;

/** A command without a shell: exit code and merged stdout+stderr; never throws. */
function run(cmd, args, { cwd = process.cwd() } = {}) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: MAX_BUFFER });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

/** `git -C <dir> ...`: exit code and merged stdout+stderr; never throws. */
function gitRun(dir, ...args) {
  return run('git', ['-C', dir, ...args]);
}

/** `git -C <dir> ...`: stdout as a string; a non-zero code throws, stderr is not shown. */
function gitOut(dir, ...args) {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', maxBuffer: MAX_BUFFER, stdio: ['ignore', 'pipe', 'ignore'] });
}

module.exports = { run, gitRun, gitOut };
