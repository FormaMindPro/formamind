#!/usr/bin/env node
'use strict';

/**
 * test-qoder-guard.cjs - the Qoder deletion and card guards.
 * It checks, in temporary roots:
 *  1. guard-destructive denies a protected delete, lifts exactly one action after the human's phrase,
 *     and denies the next one;
 *  2. without .forma/rules the guard refuses (fail-closed), it does not allow;
 *  3. unlock-delete sets the marker on the phrase and ignores a look-alike;
 *  4. guard-cards rejects a broken card on Write and on Edit, and passes the valid form;
 *  5. the guards refuse unreadable hook input;
 *  6. settings.json wires Bash, Write|Edit and UserPromptSubmit; the holders' selftests are green.
 *
 * Run:
 *   node .qoder/tests/test-qoder-guard.cjs
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function findRoot(start) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, 'AGENTS.md'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return path.resolve(start);
    dir = up;
  }
}

const root = findRoot(__dirname);
const HOOKS = ['guard-destructive.cjs', 'guard-cards.cjs', 'unlock-delete.cjs'];
const PHRASE = '\u041e\u0442\u043a\u043b\u044e\u0447\u0438 \u0441\u0435\u043d\u0441\u043e\u0440\u0438\u043a\u0443';
const LOOKALIKE = '\u043d\u0435\u043e\u0442\u043a\u043b\u044e\u0447\u0438 \u0441\u0435\u043d\u0441\u043e\u0440\u0438\u043a\u0443';
const VALID = '# t\n\n## Task\n\n1 \u00b7 tooling | x | check: node ok.cjs | 1 | human\n\n## Kit\n\n## History\n\n## Result\n';
const FOUR = '# t\n\n## Task\n\n1 \u00b7 tooling | x | check: node ok.cjs | 1\n\n## Kit\n\n## History\n\n## Result\n';

let passed = 0;
const it = (name, fn) => { fn(); passed += 1; console.log('ok  ' + name); };

const temp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), name));
const hook = (dir, name) => path.join(dir, '.qoder', 'engine', 'hooks', name);

/** The hooks and, when asked, the rulebook they load. */
function prepare(dir, withRulebook) {
  fs.mkdirSync(path.join(dir, '.qoder', 'engine', 'hooks'), { recursive: true });
  for (const name of HOOKS) fs.copyFileSync(path.join(root, '.qoder', 'engine', 'hooks', name), hook(dir, name));
  if (!withRulebook) return;
  fs.cpSync(path.join(root, '.forma', 'rules'), path.join(dir, '.forma', 'rules'), { recursive: true });
  fs.cpSync(path.join(root, '.forma', 'i18n'), path.join(dir, '.forma', 'i18n'), { recursive: true });
}

function run(dir, name, input) {
  return spawnSync(process.execPath, [hook(dir, name)], {
    cwd: dir,
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
  });
}

const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });
const marker = (dir) => path.join(dir, '.forma', '.delete-unlock');

it('guard-destructive denies a protected delete, lifts exactly one after the phrase, then denies again', () => {
  const dir = temp('qoder-guard-');
  try {
    prepare(dir, true);
    assert.equal(run(dir, 'guard-destructive.cjs', bash('rm -rf .forma')).status, 2, 'the protected delete was not denied');
    const unlocked = run(dir, 'unlock-delete.cjs', { prompt: PHRASE });
    assert.equal(unlocked.status, 0, 'the unlock hook failed: ' + (unlocked.stderr || ''));
    assert.ok(fs.existsSync(marker(dir)), 'the phrase did not set the one-time marker');
    assert.equal(run(dir, 'guard-destructive.cjs', bash('rm -rf .forma')).status, 0, 'the lifted action was not allowed');
    assert.ok(!fs.existsSync(marker(dir)), 'the marker was not consumed by the lifted action');
    assert.equal(run(dir, 'guard-destructive.cjs', bash('rm -rf .forma')).status, 2, 'the second action was not denied again');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

it('unlock-delete ignores the look-alike and the English words', () => {
  const dir = temp('qoder-unlock-');
  try {
    prepare(dir, true);
    run(dir, 'unlock-delete.cjs', { prompt: LOOKALIKE });
    assert.ok(!fs.existsSync(marker(dir)), 'the look-alike set the marker');
    run(dir, 'unlock-delete.cjs', { prompt: 'disable sensory' });
    assert.ok(!fs.existsSync(marker(dir)), 'the English words set the marker');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

it('without .forma/rules the guard refuses instead of allowing', () => {
  const dir = temp('qoder-norule-');
  try {
    prepare(dir, false);
    const r = run(dir, 'guard-destructive.cjs', bash('rm -rf .forma'));
    assert.equal(r.status, 2, 'the guard allowed a protected delete without its rulebook');
    assert.match(String(r.stderr || ''), /fail-closed|rulebook/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

it('guard-cards rejects a broken card on Write and on Edit, and passes the valid form', () => {
  const dir = temp('qoder-cards-');
  try {
    prepare(dir, false);
    const file = path.join(dir, '.devtool', 'features', 'card-1-test.md');
    const write = (content) => run(dir, 'guard-cards.cjs', { tool_name: 'Write', tool_input: { file_path: file, content } });
    assert.equal(write(FOUR).status, 2, 'a four-field Task line was not rejected');
    assert.equal(write(VALID).status, 0, 'the valid card form was rejected');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, VALID);
    const edit = (oldString, newString) => run(dir, 'guard-cards.cjs', { tool_name: 'Edit', tool_input: { file_path: file, old_string: oldString, new_string: newString } });
    assert.equal(edit('## Result\n', '').status, 2, 'an edit dropping the Result zone was not rejected');
    assert.equal(edit('## History\n', '## History\n- a note.\n').status, 0, 'a form-preserving edit was rejected');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

it('the guards refuse unreadable hook input', () => {
  const dir = temp('qoder-input-');
  try {
    prepare(dir, true);
    for (const name of ['guard-destructive.cjs', 'guard-cards.cjs']) {
      assert.equal(run(dir, name, '').status, 2, name + ' allowed empty input');
      assert.equal(run(dir, name, 'not json').status, 2, name + ' allowed non-JSON input');
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

it('settings.json wires Bash, Write|Edit and UserPromptSubmit', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, '.qoder', 'settings.json'), 'utf8'));
  const hooks = config.hooks || {};
  const matchers = (hooks.PreToolUse || []).map((entry) => entry.matcher);
  assert.ok(matchers.includes('Bash'), 'PreToolUse has no Bash matcher');
  assert.ok(matchers.includes('Write|Edit'), 'PreToolUse has no Write|Edit matcher');
  const promptCommands = (hooks.UserPromptSubmit || []).flatMap((entry) => (entry.hooks || []).map((h) => h.command));
  assert.ok(promptCommands.some((command) => /unlock-delete\.cjs/.test(command)), 'UserPromptSubmit does not run unlock-delete');
});

it('the holders selftest green', () => {
  for (const name of HOOKS) {
    const r = spawnSync(process.execPath, [path.join(root, '.qoder', 'engine', 'hooks', name), '--selftest'], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, name + ' selftest failed: ' + (r.stderr || r.stdout));
  }
});

console.log(`\npassed: ${passed}`);
