'use strict';

/**
 * The provider's cost report, supplied by an engine adapter and read by the core.
 *
 * The adapter declares `cost: { script, label, currency, ttlMs }` (`.forma/dashboard/lib/engines.cjs`,
 * the header). The core knows neither the provider nor its price list: it runs the declared script as
 * `node <script> --json --project` from the project root and takes the JSON it prints. A project with
 * no such adapter, or with a script that fails, gets `available: false` - the block is not built.
 *
 * The script's JSON (the `go-cost.cjs` shape, see `.zcode/scripts/go-cost.cjs`):
 *   { generatedAt, estimate, period, project, source, limits, usage[], total, unknown, note }
 *   limits - { rolling, weekly, monthly }, each { status, percent, resetsAt }
 *   usage  - [{ model, requests, failed, input, cache, output, cost, costKnown, cap }]
 * The numbers are the provider's facts plus the script's own estimate; `unknown` is never 0.
 *
 * Caching: the result is written to `.forma/dashboard/.cache/cost-<id>.json` and reused for `ttlMs`
 * (five minutes by default). A failed run falls back to a stale cache when one exists; the block then
 * says so. The report is a statistic, not a threshold: the core sets no limit in dollars.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const engines = require('../lib/engines.cjs');

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const RUN_TIMEOUT_MS = 20000;

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/** The adapter that declares a cost source; the first one in the adapters' order. */
function costAdapter(root) {
  const adapters = engines.loadAdapters(root);
  return adapters.find((a) => a && a.cost && typeof a.cost.script === 'string' && a.cost.script.trim()) || null;
}

/**
 * The script's payload -> the block's shape. `available` is true only when the provider reported
 * something - an allowance or at least one model row; a silent provider is not a zero.
 */
function normalizeCost(payload, adapter) {
  const cfg = (adapter && adapter.cost) || {};
  const p = payload && typeof payload === 'object' ? payload : {};
  const models = Array.isArray(p.usage) ? p.usage : [];
  const limits = p.limits && typeof p.limits === 'object' ? p.limits : null;
  const available = Boolean(limits) || models.length > 0;
  return {
    available,
    label: typeof cfg.label === 'string' ? cfg.label : null,
    currency: typeof cfg.currency === 'string' ? cfg.currency : 'USD',
    period: typeof p.period === 'string' ? p.period : null,
    generatedAt: typeof p.generatedAt === 'string' ? p.generatedAt : null,
    estimate: p.estimate !== false,
    source: typeof p.source === 'string' ? p.source : null,
    limits,
    models,
    total: p.total && typeof p.total === 'object' ? p.total : null,
    unknown: p.unknown && typeof p.unknown === 'object' ? p.unknown : null,
    stale: false,
    reason: available ? null : 'the provider reported neither an allowance nor a model row',
  };
}

/** The block with no provider: the adapter is absent or the report cannot be read. */
function unavailable(adapter, reason) {
  const cfg = (adapter && adapter.cost) || {};
  return {
    available: false,
    label: typeof cfg.label === 'string' ? cfg.label : null,
    currency: typeof cfg.currency === 'string' ? cfg.currency : 'USD',
    period: null,
    generatedAt: null,
    estimate: true,
    source: null,
    limits: null,
    models: [],
    total: null,
    unknown: null,
    stale: false,
    reason,
  };
}

/**
 * The cost block of the first adapter that declares one.
 * `opts.spawn` - a replacement for spawnSync (tests); `opts.now` - the clock (tests).
 */
function readCost(root, opts = {}) {
  const adapter = costAdapter(root);
  if (!adapter) return unavailable(null, 'no adapter declares a cost source');
  const cfg = adapter.cost;
  const tag = adapter.id || adapter.spendTag || adapter.engine || 'engine';
  const cacheFile = path.join(root, '.forma', 'dashboard', '.cache', `cost-${tag}.json`);
  const ttl = Number(cfg.ttlMs) > 0 ? Number(cfg.ttlMs) : DEFAULT_TTL_MS;
  const now = typeof opts.now === 'function' ? opts.now() : Date.now();
  const cached = readJson(cacheFile);
  if (cached && cached.payload && Number.isFinite(cached.at) && now - cached.at < ttl && now >= cached.at) {
    return { ...cached.payload, stale: false };
  }

  const script = path.resolve(root, cfg.script);
  if (!fs.existsSync(script)) {
    if (cached && cached.payload) return { ...cached.payload, stale: true, reason: 'the cost script is missing: ' + cfg.script };
    return unavailable(adapter, 'the cost script is missing: ' + cfg.script);
  }

  const run = typeof opts.spawn === 'function' ? opts.spawn : spawnSync;
  let result;
  try {
    result = run(process.execPath, [script, '--json', '--project'], {
      cwd: root,
      encoding: 'utf8',
      timeout: Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : RUN_TIMEOUT_MS,
      windowsHide: true,
    });
  } catch (e) {
    const reason = 'the cost script did not run: ' + (e && e.message ? e.message : String(e));
    if (cached && cached.payload) return { ...cached.payload, stale: true, reason };
    return unavailable(adapter, reason);
  }

  if (!result || result.status !== 0 || !result.stdout) {
    const reason = 'the cost script failed' + (result && result.status != null ? ' (exit ' + result.status + ')' : '')
      + (result && result.stderr ? ': ' + String(result.stderr).trim().split(/\r?\n/)[0] : '');
    if (cached && cached.payload) return { ...cached.payload, stale: true, reason };
    return unavailable(adapter, reason);
  }

  let payload;
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    const reason = 'the cost script printed no JSON';
    if (cached && cached.payload) return { ...cached.payload, stale: true, reason };
    return unavailable(adapter, reason);
  }

  const normalized = normalizeCost(payload, adapter);
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify({ at: now, payload: normalized }), 'utf8');
  } catch { /* a cache write never blocks the report */ }
  return normalized;
}

module.exports = { readCost, normalizeCost, costAdapter };
