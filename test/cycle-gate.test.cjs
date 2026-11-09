'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
// Russian markup labels, the guard's denial text and early-close prompts are data matched against
// guard-core-cycle.cjs / parseVolume (which still hold them literally): unicode escapes.
const D = {
  volumeEpic: '\u041e\u0431\u044a\u0451\u043c \u0446\u0438\u043a\u043b\u0430, \u043a\u0430\u0440\u0442\u043e\u0447\u0435\u043a (\u043d\u0430 \u044d\u043f\u0438\u043a)',
  volumeCircle: '\u041e\u0431\u044a\u0451\u043c \u043a\u0440\u0443\u0433\u0430',
  volume: '\u041e\u0431\u044a\u0451\u043c \u0446\u0438\u043a\u043b\u0430',
  param: '\u041f\u0430\u0440\u0430\u043c\u0435\u0442\u0440',
  value: '\u0417\u043d\u0430\u0447\u0435\u043d\u0438\u0435',
  deny: '\u041e\u0442\u043a\u0430\u0437: \u0412 \u044d\u043f\u0438\u043a\u0435 \u043d\u0430\u043a\u043e\u043f\u043b\u0435\u043d\u043e',
  cards: '\u043a\u0430\u0440\u0442\u043e\u0447\u0435\u043a.',
  closeCycle: '\u0417\u0430\u043a\u0440\u044b\u0442\u044c \u0446\u0438\u043a\u043b',
  earlyClose: '\u0434\u043e\u0441\u0440\u043e\u0447\u043d\u043e\u0435 \u0437\u0430\u043a\u0440\u044b\u0442\u0438\u0435 \u043a\u0440\u0443\u0433\u0430'
};

const { parseVolume } = require('../skills/forma/adapters/claude/scripts/cycle-status.cjs');
const { checkCoreCycleGuard } = require('../skills/forma/core/rules/guard-core-cycle.cjs');

test('parseVolume: extracts volume from different markup formats', () => {
  const sample1 = `| ${D.volumeEpic} <!-- k:volume --> | 25 |`;
  assert.equal(parseVolume(sample1), 25);

  const sample2 = `| ${D.volumeCircle} | 20 |`;
  assert.equal(parseVolume(sample2), 20);

  const sample3 = `| ${D.volume} | 15 |`;
  assert.equal(parseVolume(sample3), 15);

  const sample4 = '| Cycle volume | 30 |';
  assert.equal(parseVolume(sample4), 30);

  const sample5 = '| <!-- k:volume --> | 12 |';
  assert.equal(parseVolume(sample5), 12);

  const empty = '# Just header\nSome text';
  assert.equal(parseVolume(empty), null);
});

test('checkCoreCycleGuard: blocks a premature Core call, allows at the threshold or with force', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cycle-gate-test-'));

  try {
    const configDir = path.join(tmpDir, 'project', 'config');
    const doneDir = path.join(tmpDir, '.devtool', 'features', 'done');
    fs.mkdirSync(configDir, { recursive: true });
    fs.mkdirSync(doneDir, { recursive: true });

    const projectMd = [
      '# Project Config',
      `| ${D.param} | ${D.value} |`,
      '| --- | --- |',
      `| ${D.volumeEpic} <!-- k:volume --> | 25 |`,
    ].join('\n');
    fs.writeFileSync(path.join(configDir, 'PROJECT.md'), projectMd, 'utf8');

    // 1. Create 2 accepted cards in done/
    for (let i = 1; i <= 2; i++) {
      const cardContent = [
        '---',
        `id: "card-00${i}"`,
        'status: "done"',
        'assignee: "Core"',
        'epic: "1. Core protocol"',
        '---',
        `# card-00${i}`,
      ].join('\n');
      fs.writeFileSync(path.join(doneDir, `card-00${i}.md`), cardContent, 'utf8');
    }

    // A non-subagent call is allowed
    const nonSub = checkCoreCycleGuard({ toolName: 'run_command', root: tmpDir });
    assert.equal(nonSub.decision, 'allow');

    // A non-Core subagent is allowed
    const kitSub = checkCoreCycleGuard({
      toolName: 'invoke_subagent',
      args: { TypeName: 'kit', Role: 'Kit Tooling' },
      root: tmpDir,
    });
    assert.equal(kitSub.decision, 'allow');

    // A Core call at 2/25 is blocked
    const coreSub = checkCoreCycleGuard({
      toolName: 'invoke_subagent',
      args: { TypeName: 'core', Role: 'Core Arbiter', Prompt: D.closeCycle },
      root: tmpDir,
    });
    assert.equal(coreSub.decision, 'deny');
    assert.match(coreSub.reason, new RegExp(D.deny + ' 2\\/25 ' + D.cards));

    // A Core call with an early-close marker in the prompt is allowed
    const coreEarly = checkCoreCycleGuard({
      toolName: 'invoke_subagent',
      args: { TypeName: 'core', Role: 'Core Arbiter', Prompt: D.earlyClose },
      root: tmpDir,
    });
    assert.equal(coreEarly.decision, 'allow');

    // A Core call with force: true is allowed
    const coreForce = checkCoreCycleGuard({
      toolName: 'invoke_subagent',
      args: { TypeName: 'core', Role: 'Core Arbiter' },
      force: true,
      root: tmpDir,
    });
    assert.equal(coreForce.decision, 'allow');

    // Pad up to 25 cards
    for (let i = 3; i <= 25; i++) {
      const pad = String(i).padStart(3, '0');
      // use card-003..009 and card-099 to keep the trace regex of the release check intact
      const cardName = i < 10 ? `card-${pad}` : (i === 25 ? 'card-099' : `item-${pad}`);
      const cardContent = [
        '---',
        `id: "${cardName}"`,
        'status: "done"',
        'assignee: "Core"',
        'epic: "1. Core protocol"',
        '---',
      ].join('\n');
      fs.writeFileSync(path.join(doneDir, `${cardName}.md`), cardContent, 'utf8');
    }

    // Now 25 cards are accumulated - Core is allowed without force
    const coreFull = checkCoreCycleGuard({
      toolName: 'invoke_subagent',
      args: { TypeName: 'core', Role: 'Core Arbiter' },
      root: tmpDir,
    });
    assert.equal(coreFull.decision, 'allow');
    assert.equal(coreFull.accepted, 25);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('guard-core-cycle CLI: exit code 1 on an incomplete cycle and 0 with --force', () => {
  const guardPath = path.resolve(__dirname, '../skills/forma/core/rules/guard-core-cycle.cjs');

  // A call without force fails (code 1): the current project has 3/25
  const res1 = spawnSync(process.execPath, [guardPath], { encoding: 'utf8' });
  assert.equal(res1.status, 1);
  assert.match(res1.stderr, new RegExp(D.deny));

  // A call with --force succeeds (code 0)
  const res2 = spawnSync(process.execPath, [guardPath, '--force'], { encoding: 'utf8' });
  assert.equal(res2.status, 0);

  // A call with FORMA_CYCLE_FORCE=1 succeeds (code 0)
  const res3 = spawnSync(process.execPath, [guardPath], {
    encoding: 'utf8',
    env: { ...process.env, FORMA_CYCLE_FORCE: '1' },
  });
  assert.equal(res3.status, 0);
});
