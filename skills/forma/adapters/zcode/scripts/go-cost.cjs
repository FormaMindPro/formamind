#!/usr/bin/env node
'use strict';

/**
 * go-cost.cjs - the OpenCode Go allowance and the money cost of the model calls.
 *
 * Three facts, three sources:
 *   1. The official allowance - GET https://opencode.ai/inference/go/v1/usage (the rolling 5h,
 *      the weekly and the monthly percent, with the reset times).
 *   2. The prices and the monthly caps - GET .../v1/models, cached for a day in
 *      .zcode/.state/go-cost-models.json (a stale cache is used when the API is silent).
 *   3. The local usage - the host's model_usage table (~/.zcode/cli/db/db.sqlite), else the
 *      rollout transcripts through the ZCode adapter. The table carries the provider, the model,
 *      the tokens and the session; the session table maps a session to its directory, which is
 *      what `--project` filters by.
 *
 * The money is an ESTIMATE: the tokens times the price from the Go models endpoint. The official
 * per-request `opencode.allowance` is not stored by the host - `unknown`, not 0
 * (.forma/manual/en/03-protocol/ECONOMY.md, "The unknown marker"). The estimate never enters a
 * spend line: a line is written from the call's own fact, not from a price list.
 *
 * This is a statistic, not a threshold: the law sets no limit in dollars (AGENTS.md section 3).
 * The provider's own percentages are reported as they are.
 *
 * The key: OPENCODE_GO_API_KEY (or OPENCODE_API_KEY), else the api-key of the `opencode-go-*`
 * providers in ~/.zcode/v2/provider_config.json, else the `opencode` key of the opencode auth file.
 * The key is never printed.
 *
 * Run:
 *   node .zcode/scripts/go-cost.cjs [--days N] [--project [dir]] [--models] [--json]
 *   --days N     the period, calendar days back from today, local time (default 1 - today)
 *   --project    only the sessions of this project (no value - the current project root)
 *   --models     the price and cap table from the Go models endpoint, no usage
 *   --json       machine-readable output (the dashboard's input)
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { StringDecoder } = require('node:string_decoder');

const ROOT = path.resolve(__dirname, '..', '..');
const i18n = require(path.join(ROOT, '.forma', 'i18n', 'index.cjs'));
const { makeCli } = require(path.join(ROOT, '.forma', 'dashboard', 'lib', 'cli.cjs'));

const LANG = i18n.projectLang(ROOT) || 'ru';
const msg = (code, params) => i18n.message(code, params, LANG);

const API = 'https://opencode.ai/inference/go/v1';
const PROVIDER_PREFIX = 'opencode-go';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 15000;

const num = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function zcodeHome() {
  return process.env.ZCODE_HOME || path.join(os.homedir(), '.zcode');
}

/** The Go key: the env first, then the host's provider rules, then the opencode auth file. Null - none. */
function findKey() {
  const env = process.env.OPENCODE_GO_API_KEY || process.env.OPENCODE_API_KEY;
  if (env) return { key: env, source: 'env' };
  const cfg = readJson(path.join(zcodeHome(), 'v2', 'provider_config.json'));
  const rules = cfg && cfg.config && cfg.config.providerConfigRules && cfg.config.providerConfigRules.providerRules;
  if (Array.isArray(rules)) {
    for (const rule of rules) {
      const id = String((rule && rule.providerId) || '');
      const key = rule && rule.config && rule.config.access && rule.config.access.apiKey;
      if (id.startsWith(PROVIDER_PREFIX) && typeof key === 'string' && key) return { key, source: 'zcode' };
    }
  }
  const auth = readJson(path.join(os.homedir(), '.local', 'share', 'opencode', 'auth.json'));
  const key = auth && auth.opencode && auth.opencode.key;
  if (typeof key === 'string' && key) return { key, source: 'opencode' };
  return null;
}

async function fetchJson(url, key) {
  const res = await fetch(url, {
    headers: { authorization: 'Bearer ' + key, 'user-agent': 'forma-go-cost' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

/** The models endpoint -> { id: { input, cache, output, caps, multipliers } }; the caps in dollars. */
function normalizeModels(payload) {
  const list = payload && Array.isArray(payload.data) ? payload.data : [];
  const out = {};
  for (const m of list) {
    if (!m || !m.id) continue;
    const text = (m.cost && m.cost.text) || {};
    const input = text.input || {};
    const output = text.output || {};
    const caps = (m.go && m.go.monthly_usage) || {};
    out[m.id] = {
      input: num(input.price),
      cache: num((input.cache || {}).read),
      output: num(output.price),
      caps: { go: num(caps.go), plus: num(caps['go-plus']), teams: num(caps['go-teams']) },
      multipliers: Array.isArray(m.cost && m.cost.multipliers) ? m.cost.multipliers : [],
    };
  }
  return out;
}

/** The prices: a fresh cache, else the API, else a stale cache (the API silent); null - no price list. */
async function loadModels(key) {
  const file = path.join(ROOT, '.zcode', '.state', 'go-cost-models.json');
  const cached = readJson(file);
  const fresh = cached && Date.parse(cached.fetchedAt) && Date.now() - Date.parse(cached.fetchedAt) < CACHE_TTL_MS;
  if (fresh) return { models: cached.models, stale: false, error: null };
  if (key) {
    try {
      const models = normalizeModels(await fetchJson(API + '/models', key));
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify({ fetchedAt: new Date().toISOString(), models }), 'utf8');
      } catch { /* a cache write never blocks the reading */ }
      return { models, stale: false, error: null };
    } catch (e) {
      return { models: cached ? cached.models : null, stale: true, error: e && e.message ? e.message : String(e) };
    }
  }
  return { models: cached ? cached.models : null, stale: true, error: null };
}

/** The official allowance; null when the API or the key is absent. */
async function loadLimits(key) {
  if (!key) return null;
  try {
    const d = await fetchJson(API + '/usage', key);
    return d && d.usage ? d.usage : null;
  } catch { return null; }
}

/** The price multiplier at a moment: the first matching window of `cost.multipliers`, else 1. */
function multiplierAt(multipliers, ms) {
  if (!Array.isArray(multipliers) || !multipliers.length || !Number.isFinite(ms)) return 1;
  const d = new Date(ms);
  const day = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][d.getUTCDay()];
  const hour = d.getUTCHours();
  for (const m of multipliers) {
    const when = m && m.when;
    if (!when) continue;
    const days = when.utc_days && when.utc_days.in;
    if (Array.isArray(days) && !days.includes(day)) continue;
    const any = Array.isArray(when.any) ? when.any : [];
    for (const cond of any) {
      const all = Array.isArray(cond.all) ? cond.all : [];
      if (!all.length) continue;
      let ok = true;
      for (const c of all) {
        const h = c && c.utc_hours;
        if (!h) continue;
        if (h.gte != null && hour < Number(String(h.gte).slice(0, 2))) ok = false;
        if (h.lt != null && hour >= Number(String(h.lt).slice(0, 2))) ok = false;
      }
      if (ok) return num(m.factor) != null ? num(m.factor) : 1;
    }
  }
  return 1;
}

/**
 * The money of one row: (input without the cache) x the input price + the cache x the cache price
 * + the output x the output price, per 1M tokens, times the moment's multiplier.
 * The host's input is inclusive of the cache. A missing price or a missing count - null, not 0.
 */
function costOf(row, price) {
  if (!row || !price || price.input == null) return null;
  if (row.input == null || row.output == null) return null;
  const cache = row.cacheRead || 0;
  const uncached = Math.max(0, row.input - cache);
  const base = (uncached * price.input + cache * (price.cache || 0) + row.output * (price.output || 0)) / 1e6;
  return base * multiplierAt(price.multipliers, row.startedAt);
}

/** The rows -> the per-model slice and the total; a model without a price keeps its tokens, its cost is unknown. */
function aggregate(rows, models) {
  const by = new Map();
  let priceUnknownRows = 0;
  let inputUnknownRows = 0;
  for (const row of rows) {
    const id = row.modelId || 'unknown';
    let a = by.get(id);
    if (!a) {
      a = { model: id, requests: 0, failed: 0, input: 0, cache: 0, output: 0, cost: 0, costKnown: true, cap: null };
      by.set(id, a);
    }
    a.requests += 1;
    if (row.status && row.status !== 'completed') a.failed += 1;
    if (row.input != null) a.input += row.input;
    if (row.output != null) a.output += row.output;
    a.cache += row.cacheRead || 0;
    const price = models ? models[id] : null;
    const cost = costOf(row, price);
    if (cost == null) {
      a.costKnown = false;
      if (!price || price.input == null) priceUnknownRows += 1;
      else inputUnknownRows += 1;
    } else a.cost += cost;
    if (price && price.caps && price.caps.go != null) a.cap = price.caps.go;
  }
  const list = [...by.values()].sort((x, y) => {
    const cx = x.costKnown ? x.cost : -1;
    const cy = y.costKnown ? y.cost : -1;
    return cy - cx || x.model.localeCompare(y.model);
  });
  const total = { requests: 0, failed: 0, input: 0, cache: 0, output: 0, cost: 0, costKnown: true };
  for (const a of list) {
    total.requests += a.requests;
    total.failed += a.failed;
    total.input += a.input;
    total.cache += a.cache;
    total.output += a.output;
    if (a.costKnown) total.cost += a.cost;
    else total.costKnown = false;
  }
  return { models: list, total, priceUnknownRows, inputUnknownRows };
}

/** The local midnight of the first day of the period. */
function sinceMs(days, now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1)).getTime();
}

function dateLabel(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function periodLabel(days, since, now = new Date()) {
  return days === 1 ? dateLabel(now) : dateLabel(new Date(since)) + '..' + dateLabel(now);
}

function localStamp(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return 'unknown';
  return dateLabel(d) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

/** The host's model_usage table; null when the table or the sqlite module is unavailable. */
function readDbRows(since, projectDir) {
  const file = path.join(zcodeHome(), 'cli', 'db', 'db.sqlite');
  if (!fs.existsSync(file)) return null;
  let DatabaseSync;
  try { ({ DatabaseSync } = require('node:sqlite')); } catch { return null; }
  let db = null;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    let sql = 'select u.provider_id as provider, u.model_id as model, u.status as status,'
      + ' u.started_at as startedAt, u.input_tokens as input, u.output_tokens as output,'
      + ' u.cache_read_input_tokens as cacheRead'
      + ' from model_usage u where u.provider_id like ? and u.started_at >= ?';
    const params = [PROVIDER_PREFIX + '%', since];
    if (projectDir) {
      sql += " and u.session_id in (select id from session where lower(replace(directory, '\\', '/')) = lower(replace(?, '\\', '/')))";
      params.push(projectDir);
    }
    return db.prepare(sql).all(...params).map((r) => ({
      providerId: r.provider,
      modelId: r.model,
      status: r.status,
      startedAt: Number(r.startedAt),
      input: r.input == null ? null : Number(r.input),
      output: r.output == null ? null : Number(r.output),
      cacheRead: r.cacheRead == null ? 0 : Number(r.cacheRead),
    }));
  } catch { return null; } finally {
    if (db) { try { db.close(); } catch { /* closed already */ } }
  }
}

/** A file's lines, with the multibyte characters kept whole across the chunks. */
function eachLine(file, onLine) {
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1 << 20);
  const decoder = new StringDecoder('utf8');
  let rest = '';
  try {
    let n;
    while ((n = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      rest += decoder.write(buffer.subarray(0, n));
      let i;
      while ((i = rest.indexOf('\n')) >= 0) {
        onLine(rest.slice(0, i));
        rest = rest.slice(i + 1);
      }
    }
    rest += decoder.end();
    if (rest.trim()) onLine(rest);
  } finally { fs.closeSync(fd); }
}

/** The fallback: the rollout transcripts of the ZCode host, through the adapter's own reading. */
function readRolloutRows(since) {
  let adapter;
  try { adapter = require('../forma-adapter.cjs'); } catch { return null; }
  const dir = adapter.transcriptsDir(ROOT);
  if (!dir) return null;
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return null; }
  const rows = [];
  for (const name of names) {
    if (!/^model-io-sess_.+\.jsonl$/.test(name)) continue;
    const file = path.join(dir, name);
    let stat;
    try { stat = fs.statSync(file); } catch { continue; }
    if (stat.mtimeMs < since) continue;
    eachLine(file, (line) => {
      let j;
      try { j = JSON.parse(line); } catch { return; }
      const providerId = j && j.model && j.model.providerId;
      if (!String(providerId || '').startsWith(PROVIDER_PREFIX)) return;
      const ts = Date.parse(j.completedAt || j.startedAt || '');
      if (!Number.isFinite(ts) || ts < since) return;
      const usage = adapter.parseUsage({ usage: (j.response || {}).usage });
      if (usage.tokens_in == null && usage.cache_read == null && usage.tokens_out == null) return;
      const input = usage.tokens_in == null ? null
        : usage.tokens_in + (usage.cache_read || 0) + (usage.cache_write || 0);
      rows.push({
        providerId,
        modelId: (j.model && j.model.modelId) || 'unknown',
        status: j.error ? 'error' : 'completed',
        startedAt: ts,
        input,
        output: usage.tokens_out,
        cacheRead: usage.cache_read || 0,
      });
    });
  }
  return rows;
}

function fmtTokens(n) {
  if (n == null || !Number.isFinite(n)) return 'unknown';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(Math.round(n));
}

function fmtUsd(n) {
  if (n == null || !Number.isFinite(n)) return 'unknown';
  if (n < 0.01) return '$' + n.toFixed(4);
  if (n < 1) return '$' + n.toFixed(3);
  return '$' + n.toFixed(2);
}

function fmtPrice(n) {
  return n == null ? 'unknown' : String(n);
}

function fmtCap(n) {
  return n == null ? '-' : '$' + n;
}

function table(head, rows) {
  const widths = head.map((h, i) => Math.max(String(h).length, ...rows.map((r) => String(r[i]).length)));
  const line = (cells) => cells.map((c, i) => (i === 0 ? String(c).padEnd(widths[i]) : String(c).padStart(widths[i]))).join('  ');
  return [
    '  ' + line(head),
    '  ' + widths.map((w) => '-'.repeat(w)).join('  '),
    ...rows.map((r) => '  ' + line(r)),
  ];
}

function peakLabel(multipliers) {
  const factors = [...new Set((multipliers || []).map((m) => num(m && m.factor)).filter((f) => f != null))];
  return factors.length ? factors.map((f) => 'x' + f).join(',') : '-';
}

function renderModels(info, hasKey) {
  const out = [msg('zgc.models_title')];
  if (!info.models) {
    out.push('  ' + msg(hasKey ? 'zgc.api_unavailable' : 'zgc.no_key'));
    return out.join('\n');
  }
  if (info.stale) out.push('  (' + msg('zgc.cache_stale') + ')');
  const head = [
    msg('zgc.model'), msg('zgc.in'), msg('zgc.cache'), msg('zgc.out'),
    msg('zgc.plan_go'), msg('zgc.plan_plus'), msg('zgc.plan_teams'), msg('zgc.peak_col'),
  ];
  const rows = Object.entries(info.models)
    .sort((a, b) => ((b[1].caps.go || 0) - (a[1].caps.go || 0)) || a[0].localeCompare(b[0]))
    .map(([id, p]) => [
      id, fmtPrice(p.input), fmtPrice(p.cache), fmtPrice(p.output),
      fmtCap(p.caps.go), fmtCap(p.caps.plus), fmtCap(p.caps.teams), peakLabel(p.multipliers),
    ]);
  out.push(...table(head, rows));
  return out.join('\n');
}

function renderHuman(report, hasKey) {
  const out = [];
  out.push(msg('zgc.allowance'));
  if (!report.limits) {
    out.push('  ' + msg(hasKey ? 'zgc.api_unavailable' : 'zgc.no_key'));
  } else {
    const rows = [
      [msg('zgc.window_5h'), report.limits.rolling],
      [msg('zgc.window_week'), report.limits.weekly],
      [msg('zgc.window_month'), report.limits.monthly],
    ];
    for (const [label, win] of rows) {
      const pct = win && num(win.percent) != null ? Math.round(num(win.percent)) + '%' : 'unknown';
      const at = win && win.resetsAt ? localStamp(win.resetsAt) : 'unknown';
      out.push('  ' + label.padEnd(7) + pct.padStart(4) + '  ' + msg('zgc.resets', { at }));
    }
  }
  out.push('');
  out.push(msg('zgc.cost_title', { period: report.period }));
  if (!report.usage.length) {
    out.push('  ' + msg(report.source ? 'zgc.no_rows' : 'zgc.no_source'));
  } else {
    const head = [
      msg('zgc.model'), msg('zgc.req'), msg('zgc.in'), msg('zgc.cache'), msg('zgc.out'),
      msg('zgc.cost'), msg('zgc.cap'), msg('zgc.share'),
    ];
    const rows = report.usage.map((u) => [
      u.model, String(u.requests), fmtTokens(u.input), fmtTokens(u.cache), fmtTokens(u.output),
      u.costKnown ? fmtUsd(u.cost) : 'unknown', fmtCap(u.cap),
      u.cap != null && u.costKnown && u.cap > 0 ? (u.cost / u.cap * 100).toFixed(2) + '%' : '-',
    ]);
    rows.push([
      msg('zgc.total'), String(report.total.requests), fmtTokens(report.total.input),
      fmtTokens(report.total.cache), fmtTokens(report.total.output),
      report.total.costKnown ? fmtUsd(report.total.cost) : 'unknown', '', '',
    ]);
    out.push(...table(head, rows));
    if (report.total.failed) out.push('  ' + msg('zgc.failed', { n: report.total.failed }));
    if (!report.total.costKnown) out.push('  ' + msg('zgc.partial'));
  }
  out.push('');
  out.push('  ' + msg('zgc.source_' + (report.source || 'none')));
  out.push('  ' + msg('zgc.note_estimate'));
  return out.join('\n');
}

function renderJson(report) {
  return JSON.stringify({
    generatedAt: new Date().toISOString(),
    estimate: true,
    period: report.period,
    days: report.days,
    project: report.project,
    source: report.source,
    limits: report.limits,
    usage: report.usage,
    total: report.total,
    unknown: { priceRows: report.priceUnknownRows, inputRows: report.inputUnknownRows },
    note: msg('zgc.note_estimate'),
  }, null, 2);
}

function usageText() {
  return [
    'go-cost.cjs - the OpenCode Go allowance and the money cost of the model calls',
    '',
    'Usage: node .zcode/scripts/go-cost.cjs [--days N] [--project [dir]] [--models] [--json]',
    '',
    '  --days N      the period, calendar days back from today, local time (default 1 - today)',
    '  --project     only the sessions of this project (no value - the current project root)',
    '  --models      the price and cap table from the Go models endpoint, no usage',
    '  --json        machine-readable output',
    '',
    'The money is an estimate by the Go price list; the official per-request opencode.allowance',
    'is not stored by the host - unknown, not 0. The estimate never enters a spend line.',
  ].join('\n');
}

async function main() {
  const cli = makeCli();
  if (cli.flag('help')) {
    process.stdout.write(usageText() + '\n');
    return;
  }
  const days = Math.max(1, Math.min(365, Number.parseInt(cli.arg('days', '1'), 10) || 1));
  const keyInfo = findKey();
  const hasKey = Boolean(keyInfo);
  const modelsInfo = await loadModels(hasKey ? keyInfo.key : null);

  if (cli.flag('models')) {
    process.stdout.write(renderModels(modelsInfo, hasKey) + '\n');
    return;
  }

  let project = null;
  if (cli.flag('project')) {
    const value = cli.arg('project', null);
    project = value ? path.resolve(value) : ROOT;
  }

  const since = sinceMs(days);
  let rows = readDbRows(since, project);
  let source = rows ? 'db' : null;
  if (!rows && !project) {
    const fallback = readRolloutRows(since);
    if (fallback) { rows = fallback; source = 'rollout'; }
  }
  if (!rows) rows = [];

  const limits = await loadLimits(hasKey ? keyInfo.key : null);
  const agg = aggregate(rows, modelsInfo.models);
  const report = {
    days,
    period: periodLabel(days, since),
    project: project ? project.replace(/\\/g, '/') : null,
    source,
    limits,
    usage: agg.models,
    total: agg.total,
    priceUnknownRows: agg.priceUnknownRows,
    inputUnknownRows: agg.inputUnknownRows,
  };
  process.stdout.write((cli.flag('json') ? renderJson(report) : renderHuman(report, hasKey)) + '\n');
}

module.exports = {
  findKey,
  normalizeModels,
  multiplierAt,
  costOf,
  aggregate,
  sinceMs,
  periodLabel,
  fmtTokens,
  fmtUsd,
  peakLabel,
  readDbRows,
  readRolloutRows,
};

if (require.main === module) {
  main().catch((e) => {
    process.stderr.write('go-cost: ' + (e && e.message ? e.message : String(e)) + '\n');
    process.exit(1);
  });
}
