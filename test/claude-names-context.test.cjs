#!/usr/bin/env node
'use strict';

/**
 * The Claude Code names reminder: the hook, its installer wiring and its behavior.
 * The reminder is a context aid, not a check of the answer (AGENTS.md section 1, prohibition 20).
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const adapter = path.join(root, 'skills', 'forma', 'adapters', 'claude');
const hook = path.join(adapter, 'hooks', 'names-context.cjs');
const installer = fs.readFileSync(path.join(root, 'bin', 'forma.cjs'), 'utf8');
const profile = fs.readFileSync(path.join(adapter, 'verify-profile.cjs'), 'utf8');
const section = fs.readFileSync(path.join(adapter, 'rules', 'claude-8.md'), 'utf8');

let passed = 0;
const it = (name, fn) => { fn(); passed += 1; console.log('ok  ' + name); };

it('the hook exists and is ASCII executable code', () => {
  assert.ok(fs.existsSync(hook), 'names-context.cjs is missing');
  const text = fs.readFileSync(hook, 'utf8');
  assert.ok(!/[\u0400-\u04ff]/.test(text), 'the hook carries Cyrillic');
});

it('the installer wires names-context.cjs on UserPromptSubmit with node', () => {
  assert.match(installer, /UserPromptSubmit:\s*\[\{\s*hooks:\s*\['unlock-delete\.sh',\s*'names-context\.cjs'\]\s*\}\]/);
  assert.match(installer, /name\.endsWith\('\.cjs'\)\s*\?\s*`node \.claude\/hooks\/\$\{name\}`/);
});

it('the verify profile accepts the node command for .cjs hooks', () => {
  assert.match(profile, /h\.name\.endsWith\('\.cjs'\)\s*\?\s*`node \$\{file\}`/);
  assert.match(profile, /node --check: hook syntax/);
});

it('section 8 names the reminder hook', () => {
  assert.match(section, /names-context\.cjs/);
  assert.match(section, /UserPromptSubmit/);
});

it('the core skill and the Claude role carry the norm', () => {
  assert.ok(fs.existsSync(path.join(root, 'skills', 'forma', 'core', 'skills', 'human-register', 'SKILL.md')));
  const role = fs.readFileSync(path.join(adapter, 'agents', 'intent.md'), 'utf8');
  assert.match(role, /^uses:.*human-register/m);
});

it('the hook prints names for protocol codes and stays fail-open', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'names-claude-'));
  try {
    fs.cpSync(path.join(root, 'skills', 'forma', 'core', 'i18n'), path.join(dir, '.forma', 'i18n'), { recursive: true });
    fs.mkdirSync(path.join(dir, '.devtool', 'features'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.devtool', 'features', 'card-7-probe.md'),
      '---\nid: "card-7-probe"\n---\n# card-7 \u00b7 Probe title\n\n## Task\n');
    fs.mkdirSync(path.join(dir, '.claude', 'hooks'), { recursive: true });
    fs.copyFileSync(hook, path.join(dir, '.claude', 'hooks', 'names-context.cjs'));
    const run = (input) => spawnSync(process.execPath, [path.join(dir, '.claude', 'hooks', 'names-context.cjs')], {
      cwd: dir, input, encoding: 'utf8', env: { ...process.env, FORMA_LANG: 'en' },
    });

    const hit = run(JSON.stringify({ prompt: 'card-7 route-8 prohibition-20' }));
    assert.equal(hit.status, 0, hit.stderr);
    assert.match(hit.stdout, /Card-7 "Probe title"/);
    assert.match(hit.stdout, /route-8/);
    assert.match(hit.stdout, /prohibition 20/);

    const quiet = run(JSON.stringify({ prompt: 'no protocol codes here' }));
    assert.equal(quiet.status, 0);
    assert.equal(quiet.stdout.trim(), '', 'the hook printed without codes');

    const broken = run('{not json');
    assert.equal(broken.status, 0, 'unreadable input must not block the prompt');
    assert.equal(broken.stdout.trim(), '', 'the hook printed on unreadable input');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`\n${passed} checks passed`);
