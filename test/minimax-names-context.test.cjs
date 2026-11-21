#!/usr/bin/env node
'use strict';

/**
 * The MiniMax Code names reminder: the UserPromptSubmit branch of the package hook.
 * The reminder is a context aid, not a check of the answer (AGENTS.md section 1, prohibition 20).
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const pkg = path.join(root, 'skills', 'forma', 'adapters', 'minimax', 'miniapps', 'minimax-engine');
const hook = path.join(pkg, 'scripts', 'hook.mjs');

let passed = 0;
const it = (name, fn) => { fn(); passed += 1; console.log('ok  ' + name); };

it('the package hook carries the names branch and ASCII code', () => {
  assert.ok(fs.existsSync(hook), 'hook.mjs is missing');
  const text = fs.readFileSync(hook, 'utf8');
  assert.match(text, /namesBlock/);
  assert.match(text, /names-context|names\.tag/, 'the names messages are missing');
  assert.ok(!/[\u0400-\u04ff]/.test(text), 'the hook carries Cyrillic');
});

it('the package wires the event and the role names human-register', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(pkg, 'hooks', 'hooks.json'), 'utf8'));
  assert.ok(hooks.hooks.UserPromptSubmit, 'UserPromptSubmit is not wired');
  const role = fs.readFileSync(path.join(root, 'skills', 'forma', 'adapters', 'minimax', '.minimax', 'agents', 'intent.md'), 'utf8');
  assert.match(role, /^uses:.*human-register/m);
  const sha = (p) => crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex');
  assert.equal(
    sha(path.join(root, 'skills', 'forma', 'adapters', 'minimax', '.minimax', 'skills', 'human-register', 'SKILL.md')),
    sha(path.join(root, 'skills', 'forma', 'core', 'skills', 'human-register', 'SKILL.md')),
    'the MiniMax skill mirror drifted from the core canon',
  );
});

it('the hook prints names into additionalContext and stays fail-open', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'names-minimax-'));
  try {
    const proj = path.join(tmp, 'project');
    fs.mkdirSync(path.join(proj, '.minimax', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(proj, 'AGENTS.md'), '# law\n', 'utf8');
    fs.writeFileSync(path.join(proj, '.minimax', 'agents', 'intent.md'), '# intent\n', 'utf8');
    fs.cpSync(path.join(root, 'skills', 'forma', 'core', 'i18n'), path.join(proj, '.forma', 'i18n'), { recursive: true });
    fs.mkdirSync(path.join(proj, '.devtool', 'features'), { recursive: true });
    fs.writeFileSync(path.join(proj, '.devtool', 'features', 'card-7-probe.md'),
      '---\nid: "card-7-probe"\n---\n# card-7 \u00b7 Probe title\n\n## Task\n');
    const env = {
      ...process.env,
      PLUGIN_ROOT: pkg,
      PLUGIN_DATA: path.join(tmp, 'plugin-data'),
      MINIMAX_PROJECT_DIR: proj,
      FORMA_LANG: 'en',
    };
    const run = (input) => spawnSync(process.execPath, [hook], { env, input, encoding: 'utf8' });

    const hit = run(JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'card-7 route-8 prohibition-20' }));
    assert.equal(hit.status, 0, hit.stderr);
    const ctx = JSON.parse(hit.stdout).hookSpecificOutput;
    assert.equal(ctx.hookEventName, 'UserPromptSubmit');
    assert.match(ctx.additionalContext, /Card-7 "Probe title"/);
    assert.match(ctx.additionalContext, /route-8/);
    assert.match(ctx.additionalContext, /prohibition 20/);

    const quiet = run(JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'no protocol codes here' }));
    assert.equal(quiet.status, 0);
    assert.equal(quiet.stdout.trim(), '', 'the hook printed without codes');

    const broken = run('{not json');
    assert.equal(broken.status, 0, 'unreadable input must not block the prompt');
    assert.equal(broken.stdout.trim(), '', 'the hook printed on unreadable input');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

console.log(`\n${passed} checks passed`);
