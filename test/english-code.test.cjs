// english-code.test.cjs: ensures all executable code and skills in the protocol clean zones carry zero Cyrillic characters (Prohibition 19).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('check-english-code passes with 0 findings across the repository', () => {
  const script = path.join(__dirname, '..', 'skills', 'forma', 'core', 'board', 'checks', 'check-english-code.cjs');
  const res = spawnSync(process.execPath, [script], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
  });
  assert.equal(res.status, 0, `check-english-code failed with exit ${res.status}:\n${res.stdout}\n${res.stderr}`);
  assert.match(res.stdout, /check-english-code: 0 finding\(s\) in 0 file\(s\)/);
});
