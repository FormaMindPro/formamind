'use strict';

/**
 * test-cycle-gate.cjs - a test of the Core cycle accumulation gate and the k:volume parsing for the Gemini adapter.
 *
 * The ru literals below are pins on the ru output of the cycle-status/guard-core-cycle libs, or ru
 * fixtures of the project document's labels (data) - held as-is, the escape pass turns them into \u sequences.
 */

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function resolveRoot() {
  const candidates = [
    path.resolve(__dirname, '../..'),                   // in project: .agents/tests -> project root
    path.resolve(__dirname, '../../../../../../..'),     // in protocol clone inside project
    path.resolve(__dirname, '../../../../..'),           // in standalone protocol repo
  ];
  for (const c of candidates) {
    if (
      fs.existsSync(path.join(c, 'project', 'config', 'PROJECT.md')) ||
      fs.existsSync(path.join(c, '.claude', 'scripts', 'cycle-status.cjs'))
    ) {
      return c;
    }
  }
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'skills', 'forma'))) return c;
  }
  return candidates[0];
}

const root = resolveRoot();
function resolveCycleStatus() {
  const candidates = [
    path.join(root, '.claude', 'scripts', 'cycle-status.cjs'),
    path.resolve(__dirname, '../../.claude/scripts/cycle-status.cjs'),
    path.resolve(__dirname, '../../../adapters/claude/scripts/cycle-status.cjs'),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return candidates[0];
}

function resolveGuardCoreCycle() {
  const candidates = [
    path.join(root, '.forma', 'rules', 'guard-core-cycle.cjs'),
    path.resolve(__dirname, '../../.forma/rules/guard-core-cycle.cjs'),
    path.resolve(__dirname, '../../../core/rules/guard-core-cycle.cjs'),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return candidates[0];
}

const { parseVolume } = require(resolveCycleStatus());
const { checkCoreCycleGuard } = require(resolveGuardCoreCycle());

let passed = 0;
const it = (name, fn) => { fn(); passed += 1; console.log('ok  ' + name); };

it('parseVolume parses the k:volume anchor and the label variants', () => {
  assert.equal(parseVolume('| \u041e\u0431\u044a\u0451\u043c \u0446\u0438\u043a\u043b\u0430, \u043a\u0430\u0440\u0442\u043e\u0447\u0435\u043a (\u043d\u0430 \u044d\u043f\u0438\u043a) <!-- k:volume --> | 25 |'), 25);
  assert.equal(parseVolume('| \u041e\u0431\u044a\u0451\u043c \u043a\u0440\u0443\u0433\u0430 | 25 |'), 25);
  assert.equal(parseVolume('| Cycle volume | 25 |'), 25);
});

it('checkCoreCycleGuard blocks the Core invoke_subagent at N < 25', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-cycle-gate-'));
  try {
    const configDir = path.join(tmpDir, 'project', 'config');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'PROJECT.md'), '| <!-- k:volume --> | 25 |', 'utf8');

    const denied = checkCoreCycleGuard({
      toolName: 'invoke_subagent',
      args: { TypeName: 'core', Role: 'Core Arbiter' },
      root: tmpDir,
    });
    assert.equal(denied.decision, 'deny');
    assert.match(denied.reason, /\u041e\u0442\u043a\u0430\u0437: \u0412 \u044d\u043f\u0438\u043a\u0435 \u043d\u0430\u043a\u043e\u043f\u043b\u0435\u043d\u043e 0\/25 \u043a\u0430\u0440\u0442\u043e\u0447\u0435\u043a\./);

    const forced = checkCoreCycleGuard({
      toolName: 'invoke_subagent',
      args: { TypeName: 'core', Role: 'Core Arbiter' },
      force: true,
      root: tmpDir,
    });
    assert.equal(forced.decision, 'allow');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

it('the PreToolUse hook guard-core-cycle.cjs answers by the deny/allow JSON contract', () => {
  const candidates = [
    path.join(root, '.agents', 'hooks', 'guard-core-cycle.cjs'),
    path.resolve(__dirname, '../hooks/guard-core-cycle.cjs'),
  ];
  const hookScript = candidates.find((c) => fs.existsSync(c));
  assert.ok(hookScript, 'the hook script must exist');

  const payloadDeny = JSON.stringify({
    toolCall: {
      name: 'invoke_subagent',
      args: { TypeName: 'core' },
    },
    workspacePaths: [root],
  });

  const resDeny = spawnSync(process.execPath, [hookScript], { input: payloadDeny, encoding: 'utf8' });
  assert.equal(resDeny.status, 0);
  const outDeny = JSON.parse(resDeny.stdout);
  assert.equal(outDeny.decision, 'deny');
  assert.match(outDeny.reason, /\u041e\u0442\u043a\u0430\u0437: \u0412 \u044d\u043f\u0438\u043a\u0435 \u043d\u0430\u043a\u043e\u043f\u043b\u0435\u043d\u043e \d+\/25 \u043a\u0430\u0440\u0442\u043e\u0447\u0435\u043a\./);

  const payloadForce = JSON.stringify({
    toolCall: {
      name: 'invoke_subagent',
      args: { TypeName: 'core', Prompt: 'early closure --force' },
    },
    workspacePaths: [root],
  });

  const resForce = spawnSync(process.execPath, [hookScript], { input: payloadForce, encoding: 'utf8' });
  assert.equal(resForce.status, 0);
  const outForce = JSON.parse(resForce.stdout);
  assert.equal(outForce.decision, 'allow');
});

console.log(`\nAll ${passed} cycle-gate checks passed.`);
