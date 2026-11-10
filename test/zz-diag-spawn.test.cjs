'use strict';

// TEMPORARY DIAGNOSTIC (remove after the CI red is root-caused): how does the runner classify
// `node --eval process.exit(0)` through spawnSync shell:true - the exact call runGate makes?
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const os = require('node:os');
const fs = require('node:fs');

test('diagnostic: exit-0 gate spawn, three variants, full details', () => {
  const dir = fs.mkdtempSync(require('node:path').join(os.tmpdir(), 'diag-spawn-'));
  const variants = {
    pathNode: spawnSync('node --eval process.exit(0)', { shell: true, cwd: dir, encoding: 'utf8' }),
    execPath: spawnSync(process.execPath + ' --eval process.exit(0)', { shell: true, cwd: dir, encoding: 'utf8' }),
    execPathNoShell: spawnSync(process.execPath, ['--eval', 'process.exit(0)'], { cwd: dir, encoding: 'utf8' }),
  };
  const pick = (r) => ({ status: r.status, error: r.error ? String(r.error.message) : null,
    stderr: (r.stderr || '').slice(0, 200), stdout: (r.stdout || '').slice(0, 100) });
  const details = Object.fromEntries(Object.entries(variants).map(([k, r]) => [k, pick(r)]));
  assert.ok(variants.pathNode.status === 0, 'path node exits 0; details: ' + JSON.stringify(details));
  fs.rmSync(dir, { recursive: true, force: true });
});
