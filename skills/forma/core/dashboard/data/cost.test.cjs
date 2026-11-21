#!/usr/bin/env node
'use strict';

/**
 * test of `data/cost.cjs`: the adapter-declared cost source.
 * It checks:
 *   1. No adapter with a `cost` field - unavailable, no block.
 *   2. A script printing JSON - available, the models and the limits are read, the counter shows one run.
 *   3. A failed script - unavailable with the reason; a stale cache is used instead of a zero.
 *   4. The normalization: no allowance and no rows - unavailable; an unknown cost stays unknown.
 *
 * Run: node .forma/dashboard/data/cost.test.cjs
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { readCost, normalizeCost } = require('./cost.cjs');

let passed = 0;
const it = (name, fn) => { fn(); passed += 1; console.log('ok  ' + name); };

const BASE = Date.UTC(2026, 10, 21, 20, 0, 0);
const at = (hours) => new Date(BASE + hours * 3600 * 1000).toISOString();
const PAYLOAD = {
  generatedAt: at(0),
  estimate: true,
  period: 'sample-period',
  source: 'db',
  limits: {
    rolling: { status: 'ok', percent: 3, resetsAt: at(2) },
    weekly: { status: 'ok', percent: 1, resetsAt: at(48) },
    monthly: { status: 'ok', percent: 0, resetsAt: at(720) },
  },
  usage: [
    { model: 'model-a', requests: 10, failed: 0, input: 1000, cache: 900, output: 50, cost: 0.0012, costKnown: true, cap: 100 },
  ],
  total: { requests: 10, failed: 0, input: 1000, cache: 900, output: 50, cost: 0.0012, costKnown: true },
  unknown: { priceRows: 0, inputRows: 0 },
  note: 'estimate',
};

/** A temporary project with one adapter and a script printing `body`; the counter file counts the runs. */
function project(body, opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cost-source-'));
  fs.mkdirSync(path.join(root, '.a'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.a', 'forma-adapter.cjs'),
    "module.exports = { engine: 'a', id: 'a', spendTag: 'a', cost: { script: '.a/cost.cjs', label: 'Provider A', currency: 'USD', ttlMs: " + (opts.ttlMs || 60000) + " } };\n",
    'utf8',
  );
  const counter = path.join(root, 'runs.txt');
  fs.writeFileSync(path.join(root, '.a', 'cost.cjs'), body(counter), 'utf8');
  return { root, counter };
}

it('no adapter with a cost source - unavailable, not zero', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cost-empty-'));
  const r = readCost(root);
  assert.equal(r.available, false);
  assert.match(r.reason, /no adapter/);
  assert.deepEqual(r.models, []);
});

it('the script prints JSON - available, the block reads the limits and the models', () => {
  const { root, counter } = project((counterPath) => `
const fs = require('fs');
fs.appendFileSync(${JSON.stringify(counterPath)}, 'x');
console.log(${JSON.stringify(JSON.stringify(PAYLOAD))});
`);
  const r = readCost(root, { now: () => 1000 });
  assert.equal(r.available, true);
  assert.equal(r.label, 'Provider A');
  assert.equal(r.currency, 'USD');
  assert.equal(r.limits.rolling.percent, 3);
  assert.equal(r.models.length, 1);
  assert.equal(r.models[0].model, 'model-a');
  assert.equal(r.stale, false);
  assert.equal(fs.readFileSync(counter, 'utf8'), 'x');
});

it('the second read within the TTL is the cache - the script runs once', () => {
  const { root, counter } = project((counterPath) => `
const fs = require('fs');
fs.appendFileSync(${JSON.stringify(counterPath)}, 'x');
console.log(${JSON.stringify(JSON.stringify(PAYLOAD))});
`);
  readCost(root, { now: () => 1000 });
  const second = readCost(root, { now: () => 2000 });
  assert.equal(second.available, true);
  assert.equal(second.stale, false);
  assert.equal(fs.readFileSync(counter, 'utf8'), 'x');
});

it('a failed script after the TTL falls back to the stale cache, not to zero', () => {
  const { root } = project((counterPath) => `
const fs = require('fs');
fs.appendFileSync(${JSON.stringify(counterPath)}, 'x');
console.log(${JSON.stringify(JSON.stringify(PAYLOAD))});
`);
  readCost(root, { now: () => 1000 });
  fs.writeFileSync(path.join(root, '.a', 'cost.cjs'), "process.stderr.write('boom'); process.exit(1);\n", 'utf8');
  const r = readCost(root, { now: () => 100000 });
  assert.equal(r.available, true);
  assert.equal(r.stale, true);
  assert.match(r.reason, /exit 1/);
  assert.equal(r.models[0].model, 'model-a');
});

it('a failed script with no cache - unavailable with the reason', () => {
  const { root, counter } = project(() => "process.stderr.write('no key'); process.exit(2);\n");
  const r = readCost(root, { now: () => 1000 });
  assert.equal(r.available, false);
  assert.match(r.reason, /exit 2/);
  assert.match(r.reason, /no key/);
  assert.equal(fs.existsSync(counter), false);
});

it('normalization: neither an allowance nor a row - unavailable; an unknown cost stays unknown', () => {
  const silent = normalizeCost({}, { cost: { label: 'P', currency: 'USD' } });
  assert.equal(silent.available, false);
  assert.match(silent.reason, /neither/);
  const one = normalizeCost({ usage: [{ model: 'm', requests: 1, cost: null, costKnown: false, cap: null }] }, { cost: { label: 'P' } });
  assert.equal(one.available, true);
  assert.equal(one.models[0].cost, null);
  assert.equal(one.models[0].costKnown, false);
  assert.equal(one.estimate, true);
});

console.log('\npassed: ' + passed);
