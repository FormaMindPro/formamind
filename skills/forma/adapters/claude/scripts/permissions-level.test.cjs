'use strict';
// The permissions-level.cjs test: node --test .claude/scripts/permissions-level.test.cjs
// The ru level names below are the keys of permission-levels.json (data) - held as \u escapes.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RU = {
  small: '\u043c\u0430\u043b\u044b\u0439',
  medium: '\u0441\u0440\u0435\u0434\u043d\u0438\u0439',
  full: '\u043f\u043e\u043b\u043d\u044b\u0439',
  unknown: '\u043e\u0433\u0440\u043e\u043c\u043d\u044b\u0439',
};

const script = path.join(__dirname, 'permissions-level.cjs');
const levels = path.join(__dirname, '..', 'permission-levels.json');

function project(local) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'perm-'));
  fs.mkdirSync(path.join(root, '.claude'));
  fs.copyFileSync(levels, path.join(root, '.claude', 'permission-levels.json'));
  if (local) fs.writeFileSync(path.join(root, '.claude', 'settings.local.json'), JSON.stringify(local));
  return root;
}
const run = (root, ...a) => spawnSync('node', [script, ...a], { env: { ...process.env, PERMISSIONS_ROOT: root }, encoding: 'utf8' });
const read = (root) => JSON.parse(fs.readFileSync(path.join(root, '.claude', 'settings.local.json'), 'utf8'));

test('small: reads and runs nodes, edits are not allowed', () => {
  const root = project();
  assert.strictEqual(run(root, RU.small).status, 0);
  const p = read(root).permissions;
  assert.ok(p.allow.includes('Read') && p.allow.includes('Agent(kit)'));
  assert.ok(!p.allow.includes('Edit') && !p.allow.includes('Bash') && !p.defaultMode);
});

test('full: general Bash, Edit, Write, Agent; the english alias works', () => {
  const root = project();
  assert.strictEqual(run(root, 'full').status, 0);
  const p = read(root).permissions;
  for (const e of ['Bash', 'Edit', 'Write', 'Read', 'Glob', 'Grep', 'Agent', 'SendMessage']) assert.ok(p.allow.includes(e), e);
  assert.strictEqual(p.defaultMode, 'acceptEdits');
});

test('a level change strips the previous one and does not touch the human\u0027s entries', () => {
  const root = project({ permissions: { allow: ['Bash(git push*)', 'Read'], deny: ['Bash(rm *)'] }, env: { A: '1' } });
  run(root, RU.full);
  run(root, RU.small);
  const s = read(root);
  assert.ok(s.permissions.allow.includes('Bash(git push*)') && s.permissions.allow.includes('Read'));
  assert.ok(!s.permissions.allow.includes('Bash') && !s.permissions.allow.includes('Write'));
  assert.deepStrictEqual(s.permissions.deny, ['Bash(rm *)']);
  assert.strictEqual(s.env.A, '1');
  assert.strictEqual(s.permissions.defaultMode, undefined);
});

test('--off returns the file to the human\u0027s entries', () => {
  const root = project({ permissions: { allow: ['Read'] } });
  run(root, RU.medium);
  run(root, '--off');
  assert.deepStrictEqual(read(root), { permissions: { allow: ['Read'] } });
  assert.ok(!fs.existsSync(path.join(root, '.claude', 'permission-level.state.json')));
});

test('an unknown level - a stop without writing', () => {
  const root = project();
  const r = run(root, RU.unknown);
  assert.strictEqual(r.status, 2);
  assert.ok(!fs.existsSync(path.join(root, '.claude', 'settings.local.json')));
});

test('--show names the current level', () => {
  const root = project();
  run(root, RU.medium);
  assert.match(run(root, '--show').stdout, new RegExp('.*\\u0422\\u0435\\u043a\\u0443\\u0449\\u0438\\u0439 \\u0443\\u0440\\u043e\\u0432\\u0435\\u043d\\u044c: ' + RU.medium));
});
