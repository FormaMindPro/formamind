#!/usr/bin/env node
'use strict';
/**
 * subagent-spend.cjs: суммы живого вызова из фикстуры rollout через адаптер движка;
 * дедуп по requestId; обе формы id хоста; стенограммы нет — null, не ноль.
 *   node .claude/scripts/subagent-spend.test.cjs
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { spendOf, spanSeconds } = require('./subagent-spend.cjs');

let passed = 0;
// Тела тестов асинхронны и крутят общий process.env.ZCODE_HOME — гонять строго по одному.
const tests = [];
const it = (name, fn) => tests.push([name, fn]);
const step = (id, ts, u) => JSON.stringify({ requestId: id, completedAt: ts, response: { usage: u } });

it('фикстура rollout через адаптер: дедуп по requestId, N = Σ in+write+read+out, окно вызова', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'subspend-'));
  const dir = path.join(home, 'cli', 'rollout');
  fs.mkdirSync(dir, { recursive: true });
  const u1 = { inputTokens: 6200, outputTokens: 100, cacheReadTokens: 5000, cacheWriteTokens: 200 };
  fs.writeFileSync(path.join(dir, 'model-io-sess_subagent_agent_fx.jsonl'),
    [step('r1', '2026-01-01T10:00:00.000Z', u1), step('r1', '2026-01-01T10:00:01.000Z', u1),
     step('r2', '2026-01-01T10:00:30.000Z', { inputTokens: 4200, outputTokens: 50, cacheReadTokens: 4000, cacheWriteTokens: 0 })].join('\n') + '\n');
  process.env.ZCODE_HOME = home;
  try {
    const s = await spendOf('fx');
    assert.equal(s.engine, 'zcode');
    assert.equal(s.steps, 2); // дубль requestId схлопнут: записей три, шагов два
    assert.deepEqual([s.tokens_n, s.cache_read, s.tokens_out], [10550, 9000, 150]);
    assert.equal(s.duration_s, 30); // окно между первым и последним шагом
    const pre = await spendOf('agent_fx'); // id хоста приходит в обеих формах
    assert.equal(pre.steps, 2);
  } finally { delete process.env.ZCODE_HOME; fs.rmSync(home, { recursive: true, force: true }); }
});

it('стенограммы нет — null, не ноль; окно без времени или с не-временем — null', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'subspend-empty-'));
  fs.mkdirSync(path.join(home, 'cli', 'rollout'), { recursive: true });
  process.env.ZCODE_HOME = home;
  try { assert.equal(await spendOf('ghost'), null); }
  finally { delete process.env.ZCODE_HOME; fs.rmSync(home, { recursive: true, force: true }); }
  assert.equal(spanSeconds(null, '2026-01-01T10:00:00.000Z'), null);
  assert.equal(spanSeconds('не время', 'тоже не время'), null);
  assert.equal(spanSeconds('2026-01-01T10:00:00.000Z', '2026-01-01T10:01:00.000Z'), 60);
});

(async () => {
  for (const [name, fn] of tests) {
    await fn();
    passed += 1;
    console.log('ok  ' + name);
  }
  console.log(`\n${passed} проверок пройдено`);
})().catch((e) => { console.error(e && e.message || e); process.exit(1); });
