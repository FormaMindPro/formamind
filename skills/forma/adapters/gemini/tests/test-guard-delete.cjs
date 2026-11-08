#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
function resolveGuardDelete() {
  const candidates = [
    path.resolve(__dirname, '../../.forma/rules/guard-delete.cjs'),
    path.resolve(__dirname, '../../../core/rules/guard-delete.cjs'),
    path.resolve(__dirname, '../../../../core/rules/guard-delete.cjs'),
    path.resolve(process.cwd(), '.forma/rules/guard-delete.cjs'),
    path.resolve(process.cwd(), '.forma/protocol/skills/forma/core/rules/guard-delete.cjs'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

const {
  isProtectedPath,
  checkCommand,
  unlockDeletion,
  consumeUnlock,
  isUnlockActive,
  runGuard,
} = require(resolveGuardDelete());

let passed = 0;
const it = (name, fn) => {
  fn();
  passed++;
  console.log('ok  ' + name);
};

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-test-'));

try {
  // 1. The protected paths check
  it('tells protected files and directories apart correctly', () => {
    assert.equal(isProtectedPath('.claude', tmpDir), true);
    assert.equal(isProtectedPath('.agents/rules/gemini-8.md', tmpDir), true);
    assert.equal(isProtectedPath('.codex', tmpDir), true);
    assert.equal(isProtectedPath('.devtool/features', tmpDir), true);
    assert.equal(isProtectedPath('.forma/manual', tmpDir), true);
    assert.equal(isProtectedPath('AGENTS.md', tmpDir), true);
    assert.equal(isProtectedPath('PROJECT.md', tmpDir), true);
    assert.equal(isProtectedPath('project/goals/goal-01/GOAL.md', tmpDir), true);
    assert.equal(isProtectedPath('VARS/credentials.md', tmpDir), true);

    // Ordinary files must not be blocked
    assert.equal(isProtectedPath('src/index.js', tmpDir), false);
    assert.equal(isProtectedPath('assets/image.png', tmpDir), false);
    assert.equal(isProtectedPath('package.json', tmpDir), false);
  });

  // 2. Blocking of the deletion commands
  it('blocks the deletion commands of the protected files (POSIX and Windows)', () => {
    // POSIX
    let res = checkCommand('rm -rf .agents', tmpDir);
    assert.equal(res.blocked, true);

    res = checkCommand('rm AGENTS.md', tmpDir);
    assert.equal(res.blocked, true);

    // PowerShell / Windows
    res = checkCommand('Remove-Item -Recurse -Force .claude', tmpDir);
    assert.equal(res.blocked, true);

    res = checkCommand('del /f /q PROJECT.md', tmpDir);
    assert.equal(res.blocked, true);

    // Non-destructive commands are allowed
    res = checkCommand('cat AGENTS.md', tmpDir);
    assert.equal(res.blocked, false);

    res = checkCommand('git status', tmpDir);
    assert.equal(res.blocked, false);

    // The deletion of an ordinary file is allowed
    res = checkCommand('rm scratch.txt', tmpDir);
    assert.equal(res.blocked, false);
  });

  // 3. The one-time unlock (the human's phrase, guard-delete data)
  it('the unlock phrase lifts the blocking for exactly one action', () => {
    // Without the unlock - blocked
    let res = checkCommand('rm -rf .devtool', tmpDir);
    assert.equal(res.blocked, true);

    // The unlock is activated
    unlockDeletion(tmpDir);
    assert.equal(isUnlockActive(tmpDir), true);

    // The first deletion passes and removes the marker
    res = checkCommand('rm -rf .devtool', tmpDir);
    assert.equal(res.blocked, false);
    assert.equal(res.unblockedByPhrase, true);
    assert.equal(isUnlockActive(tmpDir), false);

    // The second deletion is immediately blocked again
    res = checkCommand('rm -rf .devtool', tmpDir);
    assert.equal(res.blocked, true);
  });

  // 4. The PreToolUse interface check
  it('runGuard returns a correct decision for Antigravity', () => {
    let out = runGuard({
      toolName: 'run_command',
      args: { CommandLine: 'rm -rf .forma' },
      root: tmpDir,
    });
    assert.equal(out.decision, 'deny');
    assert.match(out.reason, /\u0417\u0430\u043f\u0440\u0435\u0442 1/); // the guard's ru reason pinned (data)

    out = runGuard({
      toolName: 'run_command',
      args: { CommandLine: 'npm test' },
      root: tmpDir,
    });
    assert.equal(out.decision, 'allow');
  });

  console.log(`\nAll ${passed} guard-delete checks passed.`);
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
