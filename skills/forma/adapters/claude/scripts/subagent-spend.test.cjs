#!/usr/bin/env node
'use strict';
/**
 * subagent-spend.cjs: the sums of a live call from a rollout fixture through the engine adapter;
 * dedup by requestId; both host id forms; no transcript - null, not zero.
 *   node .claude/scripts/subagent-spend.test.cjs
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { spendOf, spanSeconds } = require('./subagent-spend.cjs');

let passed = 0;
// The test bodies are asynchronous and turn the shared process.env.ZCODE_HOME - run strictly one by one.
const tests = [];
const it = (name, fn) => tests.push([name, fn]);
const step = (id, ts, u) => JSON.stringify({ requestId: id, completedAt: ts, response: { usage: u } });

it('the rollout fixture through the adapter: dedup by requestId, N = Σ in+write+read+out, the call window', async () => {
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
    assert.equal(s.steps, 2); // the requestId duplicate collapsed: three records, two steps
    assert.deepEqual([s.tokens_n, s.cache_read, s.tokens_out], [10550, 9000, 150]);
    assert.equal(s.duration_s, 30); // the window between the first and the last step
    const pre = await spendOf('agent_fx'); // the host id comes in both forms
    assert.equal(pre.steps, 2);
  } finally { delete process.env.ZCODE_HOME; fs.rmSync(home, { recursive: true, force: true }); }
});

it('no transcript - null, not zero; a window without time or with non-time - null', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'subspend-empty-'));
  fs.mkdirSync(path.join(home, 'cli', 'rollout'), { recursive: true });
  process.env.ZCODE_HOME = home;
  try { assert.equal(await spendOf('ghost'), null); }
  finally { delete process.env.ZCODE_HOME; fs.rmSync(home, { recursive: true, force: true }); }
  assert.equal(spanSeconds(null, '2026-01-01T10:00:00.000Z'), null);
  assert.equal(spanSeconds('not a time', 'also not a time'), null);
  assert.equal(spanSeconds('2026-01-01T10:00:00.000Z', '2026-01-01T10:01:00.000Z'), 60);
});

(async () => {
  for (const [name, fn] of tests) {
    await fn();
    passed += 1;
    console.log('ok  ' + name);
  }
  console.log(`\n${passed} checks passed`);
})().catch((e) => { console.error(e && e.message || e); process.exit(1); });
