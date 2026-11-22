#!/usr/bin/env node
'use strict';

/**
 * test-go-cost.cjs - the readings of `.zcode/scripts/go-cost.cjs`.
 * It checks the money arithmetic and the shapes, not the network:
 *   1. The cost of one row: the input is inclusive of the cache, the cache has its own price.
 *   2. A missing price or a missing count - null (unknown), never 0.
 *   3. The price multiplier: a weekday window doubles the cost, Saturday and the hours outside do not.
 *   4. The per-model slice: requests, failures, the cap, an unknown price on one model.
 *   5. The models payload: prices, the three caps, the multipliers; a free model is 0, not unknown.
 *   6. The period starts at the local midnight; the labels.
 *   7. The formatting: tokens and dollars.
 *
 * Run: node .zcode/tests/test-go-cost.cjs
 */

const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const cost = require(path.join(root, '.zcode', 'scripts', 'go-cost.cjs'));

let passed = 0;
const it = (name, fn) => { fn(); passed += 1; console.log('ok  ' + name); };

const deepseek = {
  input: 0.15,
  cache: 0.003,
  output: 0.6,
  caps: { go: 100, plus: 200, teams: 105 },
  multipliers: [{
    when: {
      utc_days: { in: ['mon', 'tue', 'wed', 'thu', 'fri'] },
      any: [
        { all: [{ utc_hours: { gte: '01:00' } }, { utc_hours: { lt: '04:00' } }] },
        { all: [{ utc_hours: { gte: '06:00' } }, { utc_hours: { lt: '10:00' } }] },
      ],
    },
    factor: 2,
  }],
};

// The Saturday noon UTC of the pinned date: outside every multiplier window.
const saturday = Date.UTC(2026, 10, 21, 12, 0);
const fridayEarly = Date.UTC(2026, 10, 20, 2, 30);
const fridayLate = Date.UTC(2026, 10, 20, 5, 0);

it('cost: the input is inclusive of the cache, the cache carries its own price', () => {
  const row = { input: 126627, output: 805, cacheRead: 124288, startedAt: saturday };
  // (126627 - 124288) * 0.15 + 124288 * 0.003 + 805 * 0.6 = 1206.714 token-dollars per 1M
  assert.equal(cost.costOf(row, deepseek), 0.001206714);
});

it('cost: no price or no count - null, not 0', () => {
  const row = { input: 1000, output: 10, cacheRead: 0, startedAt: saturday };
  assert.equal(cost.costOf(row, null), null);
  assert.equal(cost.costOf(row, { input: null, cache: 0, output: 0 }), null);
  assert.equal(cost.costOf({ input: null, output: 10, cacheRead: 0, startedAt: saturday }, deepseek), null);
  assert.equal(cost.costOf({ input: 1000, output: null, cacheRead: 0, startedAt: saturday }, deepseek), null);
});

it('cost: a free model is 0, not unknown', () => {
  const row = { input: 1000, output: 10, cacheRead: 0, startedAt: saturday };
  assert.equal(cost.costOf(row, { input: 0, cache: 0, output: 0, multipliers: [] }), 0);
});

it('multiplier: the weekday window doubles, Saturday and the outside hours do not', () => {
  assert.equal(cost.multiplierAt(deepseek.multipliers, saturday), 1);
  assert.equal(cost.multiplierAt(deepseek.multipliers, fridayEarly), 2);
  assert.equal(cost.multiplierAt(deepseek.multipliers, fridayLate), 1);
  assert.equal(cost.multiplierAt(undefined, fridayEarly), 1);
});

it('cost: the multiplier applies to the whole row at its own moment', () => {
  const row = { input: 1e6, output: 0, cacheRead: 0, startedAt: fridayEarly };
  assert.equal(cost.costOf(row, deepseek), 0.3); // 1M * 0.15 / 1M * 2
  assert.equal(cost.costOf({ ...row, startedAt: saturday }, deepseek), 0.15);
});

it('aggregate: the slice by model, the failures, the cap, an unknown price', () => {
  const rows = [
    { modelId: 'deepseek-v4.1-flash', status: 'completed', input: 1000, output: 100, cacheRead: 900, startedAt: saturday },
    { modelId: 'deepseek-v4.1-flash', status: 'error', input: 500, output: 0, cacheRead: 0, startedAt: saturday },
    { modelId: 'mystery-model', status: 'completed', input: 2000, output: 50, cacheRead: 0, startedAt: saturday },
  ];
  const models = { 'deepseek-v4.1-flash': deepseek };
  const agg = cost.aggregate(rows, models);
  assert.equal(agg.models.length, 2);
  const ds = agg.models.find((m) => m.model === 'deepseek-v4.1-flash');
  assert.equal(ds.requests, 2);
  assert.equal(ds.failed, 1);
  assert.equal(ds.cap, 100);
  assert.equal(ds.costKnown, true);
  // 100 * 0.15 + 900 * 0.003 + 100 * 0.6 = 15 + 2.7 + 60 = 77.7 token-dollars per 1M; second row 75
  assert.equal(ds.cost, (77.7 + 75) / 1e6);
  const mystery = agg.models.find((m) => m.model === 'mystery-model');
  assert.equal(mystery.costKnown, false);
  assert.equal(mystery.cap, null);
  assert.equal(agg.priceUnknownRows, 1);
  assert.equal(agg.total.costKnown, false);
  assert.equal(agg.total.requests, 3);
  assert.equal(agg.total.cost, ds.cost);
});

it('models: prices, the three caps, the multipliers; a free model is 0', () => {
  const payload = {
    data: [
      {
        id: 'deepseek-v4.1-flash',
        cost: {
          text: {
            input: { price: 0.15, cache: { read: 0.003 } },
            output: { price: 0.6 },
          },
          multipliers: deepseek.multipliers,
        },
        go: { monthly_usage: { go: 100, 'go-plus': 200, 'go-teams': 105 } },
      },
      {
        id: 'beam-free',
        cost: { text: { input: { price: 0, cache: { read: 0 } }, output: { price: 0 } } },
        go: {},
      },
      { id: 'no-cost' },
    ],
  };
  const models = cost.normalizeModels(payload);
  assert.deepEqual(models['deepseek-v4.1-flash'].caps, { go: 100, plus: 200, teams: 105 });
  assert.equal(models['deepseek-v4.1-flash'].input, 0.15);
  assert.equal(models['deepseek-v4.1-flash'].multipliers.length, 1);
  assert.equal(models['beam-free'].input, 0);
  assert.equal(models['beam-free'].caps.go, null);
  assert.equal(models['no-cost'].input, null);
});

it('period: the first day starts at the local midnight', () => {
  const now = new Date(2026, 10, 21, 15, 40);
  const start = cost.sinceMs(1, now);
  assert.equal(start, new Date(2026, 10, 21, 0, 0).getTime());
  assert.equal(cost.sinceMs(7, now), new Date(2026, 10, 15, 0, 0).getTime());
  // The labels are built from the same dates, never written as project-looking strings (the clean zone).
  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  assert.equal(cost.periodLabel(1, start, now), iso(now));
  assert.equal(cost.periodLabel(7, cost.sinceMs(7, now), now), iso(new Date(2026, 10, 15, 0, 0)) + '..' + iso(now));
});

it('format: tokens and dollars stay readable at every scale', () => {
  assert.equal(cost.fmtTokens(999), '999');
  assert.equal(cost.fmtTokens(1500), '1.5K');
  assert.equal(cost.fmtTokens(75_976_261), '75.98M');
  assert.equal(cost.fmtTokens(2_000_000_000), '2.00B');
  assert.equal(cost.fmtTokens(null), 'unknown');
  assert.equal(cost.fmtUsd(0.001206714), '$0.0012');
  assert.equal(cost.fmtUsd(0.724), '$0.724');
  assert.equal(cost.fmtUsd(12.5), '$12.50');
  assert.equal(cost.fmtUsd(null), 'unknown');
  assert.equal(cost.peakLabel(deepseek.multipliers), 'x2');
  assert.equal(cost.peakLabel([]), '-');
});

console.log('\npassed: ' + passed);
