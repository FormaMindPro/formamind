#!/usr/bin/env node
'use strict';

/**
 * The Codex names reminder: the UserPromptSubmit wiring, the dispatcher branch and its behavior.
 * The reminder is a context aid, not a check of the answer (AGENTS.md section 1, prohibition 20).
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const adapter = path.join(root, 'skills', 'forma', 'adapters', 'codex');
const codex = path.join(adapter, '.codex');
const hooks = JSON.parse(fs.readFileSync(path.join(codex, 'hooks.json'), 'utf8'));

let passed = 0;
const it = (name, fn) => { fn(); passed += 1; console.log('ok  ' + name); };

it('hooks.json registers names-context.ps1 on UserPromptSubmit', () => {
  assert.ok(Array.isArray(hooks.UserPromptSubmit) && hooks.UserPromptSubmit.length, 'no UserPromptSubmit event');
  const commands = hooks.UserPromptSubmit.flatMap((g) => (g.hooks || []).map((h) => h.command || ''));
  assert.ok(commands.some((c) => c.includes('names-context.ps1')), 'names-context.ps1 is not wired');
  assert.ok(fs.existsSync(path.join(codex, 'hooks', 'names-context.ps1')), 'the wrapper is missing');
});

it('section 8 names the reminder hook', () => {
  const text = fs.readFileSync(path.join(codex, 'CODEX-8.md'), 'utf8');
  assert.match(text, /names-context\.ps1/);
  assert.match(text, /UserPromptSubmit/);
});

it('the Codex skill mirror matches the core canon and the canonical role names it', () => {
  const sha = (p) => crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex');
  const core = path.join(root, 'skills', 'forma', 'core', 'skills', 'human-register', 'SKILL.md');
  const mirror = path.join(adapter, '.agents', 'skills', 'human-register', 'SKILL.md');
  assert.equal(sha(mirror), sha(core), 'the Codex skill mirror drifted from the core canon');
  const role = fs.readFileSync(path.join(root, 'skills', 'forma', 'adapters', 'claude', 'agents', 'intent.md'), 'utf8');
  assert.match(role, /^uses:.*human-register/m);
});

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'names-codex-'));
  fs.cpSync(codex, path.join(dir, '.codex'), { recursive: true });
  fs.cpSync(path.join(root, 'skills', 'forma', 'core', 'i18n'), path.join(dir, '.forma', 'i18n'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.forma', 'dashboard', 'lib'), { recursive: true });
  fs.copyFileSync(path.join(root, 'skills', 'forma', 'core', 'dashboard', 'lib', 'fs.cjs'),
    path.join(dir, '.forma', 'dashboard', 'lib', 'fs.cjs'));
  fs.mkdirSync(path.join(dir, '.devtool', 'features'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.devtool', 'features', 'card-7-probe.md'),
    '---\nid: "card-7-probe"\n---\n# card-7 \u00b7 Probe title\n\n## Task\n');
  return dir;
}

const runNode = (dir, input) => spawnSync(process.execPath, [path.join(dir, '.codex', 'scripts', 'codex-hooks.cjs'), 'names-context'], {
  cwd: dir, input, encoding: 'utf8', env: { ...process.env, FORMA_LANG: 'en' },
});

it('the dispatcher prints additionalContext names and stays fail-open', () => {
  const dir = fixture();
  try {
    const hit = runNode(dir, JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'card-7 route-8 prohibition-20' }));
    assert.equal(hit.status, 0, hit.stderr);
    const ctx = JSON.parse(hit.stdout).hookSpecificOutput;
    assert.equal(ctx.hookEventName, 'UserPromptSubmit');
    assert.match(ctx.additionalContext, /Card-7 "Probe title"/);
    assert.match(ctx.additionalContext, /route-8/);
    assert.match(ctx.additionalContext, /prohibition 20/);

    const quiet = runNode(dir, JSON.stringify({ prompt: 'no protocol codes here' }));
    assert.equal(quiet.status, 0);
    assert.equal(quiet.stdout.trim(), '', 'the hook printed without codes');

    const broken = runNode(dir, '{not json');
    assert.equal(broken.status, 0, 'unreadable input must not block the prompt');
    assert.equal(broken.stdout.trim(), '', 'the hook printed on unreadable input');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

it('the PowerShell wrapper delivers the same context', () => {
  if (process.platform !== 'win32') return;
  const dir = fixture();
  try {
    const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(dir, '.codex', 'hooks', 'names-context.ps1')], {
      cwd: dir, input: JSON.stringify({ prompt: 'card-7 route-8' }), encoding: 'utf8', env: { ...process.env, FORMA_LANG: 'en' },
    });
    assert.equal(r.status, 0, r.stderr);
    const ctx = JSON.parse(r.stdout).hookSpecificOutput;
    assert.match(ctx.additionalContext, /Card-7 "Probe title"/);
    assert.match(ctx.additionalContext, /route-8/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`\n${passed} checks passed`);
