#!/usr/bin/env node
/**
 * Session economy: re-reading versus work.
 *
 * Run: node .claude/scripts/session-economy.cjs  ->  .forma/dashboard/.cache/session-economy.json
 *      node .claude/scripts/session-economy.cjs --print   (also the report to the console)
 *
 * Counts over the transcripts of `~/.claude/projects/<project>/*.jsonl` - the very records
 * the engine keeps itself. The model is never called: this is arithmetic over files.
 *
 * Three things that are easy to get silently wrong here, and are therefore pinned in code:
 *
 * 1. DEDUPLICATION BY `requestId` - a correctness condition, not an optimization. One and the
 *    same usage record sits in the transcript many times (conversation branches are rebuilt).
 *    Without deduplication the count is inflated exactly tenfold, and the plausibility of the
 *    number does not show it. So below there is a self-check against the `cost-state` record -
 *    the engine's own bookkeeping - and it prints the deviation ALWAYS, not only when all matched.
 * 2. STREAMING READ. The largest file is near a gigabyte, the whole corpus 1.7 GB. No file is
 *    read whole into memory, and before `JSON.parse` there is a cheap substring pre-filter:
 *    the needed lines are percents, and parsing every line costs minutes.
 * 3. READ ONLY. The `~/.claude/projects/` directory belongs to another: those are session
 *    transcripts. The script writes and deletes nothing there; the only write is its own cache
 *    in `.forma/dashboard/.cache/`.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const economy = require('../../.forma/dashboard/economy.cjs');
// The Claude Code adapter: the engine's `usage` fields -> canonical variables (.forma/manual/en/03-protocol/ECONOMY.md).
const { claudeUsage, mainSessions: claudeMainSessions } = require('./claude-economy.cjs');
const { readJson } = require('../../.forma/dashboard/lib/fs.cjs');
const { makeCli } = require('../../.forma/dashboard/lib/cli.cjs');
// Main-session logs of every engine of the project - through the adapters (the core knows no paths).
const engines = require('../../.forma/dashboard/lib/engines.cjs');
// Printed labels come from the core dictionary: English key in code, ru value as data - the
// report prints the same ru lines as before the translation.
const i18n = require('../../.forma/i18n/index.cjs');
const msg = (code, params) => i18n.message(code, params, 'ru');

const ROOT = path.resolve(__dirname, '..', '..');
const CACHE_DIR = path.join(ROOT, '.forma/dashboard', '.cache');
const OUT_FILE = path.join(CACHE_DIR, 'session-economy.json');

/* Method version. Changes together with the arithmetic - by it the cache tells its own from
   another's. Forgetting to raise it on a counting edit is the only way to get a mix of old
   and new numbers here, which is why it stands as the first line of the settings. */
const METHOD_VERSION = 3;

// Every session counts, any size: a short session is spend too.
const MIN_SIZE = 0;
// A deviation from `cost-state` above this is suspicious, flagged on screen.
const SUSPECT_PCT = 2;
// A week with output below this is not a reading but the noise of one short session.
const WEEK_MIN_OUTPUT = 10000;
// A file touched recently counts as a live session: its numbers are incomplete by definition.
const LIVE_WINDOW_MS = 30 * 60 * 1000;

/* The API price per token. Derived from the `cost-state` record's equation for `opus` and matched
   its own fact to 0.0067%. This is an ESTIMATE and a fallback path: where a session has a
   `cost-state`, the money is taken from there - the engine's are exact, inventing them is pointless. */
const PRICE = {
  opus:   { cr: 0.5e-6, cc: 10e-6,   in: 5e-6, out: 25e-6 },
  sonnet: { cr: 0.3e-6, cc: 3.75e-6, in: 3e-6, out: 15e-6 },
  haiku:  { cr: 0.1e-6, cc: 1.25e-6, in: 1e-6, out: 5e-6 },
};
const priceOf = (model) => {
  const m = String(model || '').toLowerCase();
  if (m.includes('haiku')) return PRICE.haiku;
  if (m.includes('sonnet')) return PRICE.sonnet;
  return PRICE.opus;
};

/** The transcript directory of this project. The engine builds the name from the path: everything
 *  that is not a letter or a digit becomes a hyphen. The rule is undocumented, so there is a
 *  fallback: with no exact match, search case-insensitively among the existing ones. */
function transcriptDir() {
  const base = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(base)) return null;
  const encoded = ROOT.replace(/[^A-Za-z0-9]/g, '-');
  const candidates = [encoded, encoded.charAt(0).toLowerCase() + encoded.slice(1)];
  for (const c of candidates) {
    const p = path.join(base, c);
    if (fs.existsSync(p)) return p;
  }
  const want = encoded.toLowerCase();
  const found = fs.readdirSync(base).find((d) => d.toLowerCase() === want);
  return found ? path.join(base, found) : null;
}

/** The parse state of one transcript: sums over the session, deduplication, the trail of calls and the anchor. */
function newParseState() {
  return {
    seen: new Set(),
    total: economy.emptyUsage(),
    first: null, last: null,
    // The snapshot at the moment of the last `cost-state`: accumulates in parallel, frozen on the line.
    anchor: null,
    byModel: {},
    /* The per-call trail - only (time, R, creation, output), a few thousand numbers per session.
       It exists for the sake of the check: `cost-state` counts from its own `startTime`, and the
       transcript carries calls inherited from the previous session before it (continuing after a
       compaction copies the history together with their `requestId`). Checking against those would
       accuse the engine of undercounting where the counting boundaries differ, not the numbers. */
    trail: [],
  };
}

/** The snapshot at a `cost-state` line: our count over the trail and the engine's count. An empty
 *  record (the session spent nothing) cannot be an anchor - then null. */
function costStateAnchor(j, trail) {
  const mu = j.modelUsage || {};
  const sum = (k) => Object.values(mu).reduce((a, m) => a + (m[k] || 0), 0);
  const cr = sum('cacheReadInputTokens');
  if (!(cr > 0)) return null;
  // Our count up to this line, but from the same starting point as the engine's.
  const startedAt = Number(j.startTime) || 0;
  const mine = { cr: 0, cc: 0, out: 0, calls: 0, inherited: 0 };
  for (const c of trail) {
    if (c.ts < startedAt) { mine.inherited += 1; continue; }
    mine.calls += 1; mine.cr += c.cr; mine.cc += c.cc; mine.out += c.out;
  }
  return {
    startedAt,
    mine,
    // The engine's count on the same line.
    theirs: {
      cr,
      cc: sum('cacheCreationInputTokens'),
      out: sum('outputTokens'),
      costUsd: Number(j.totalCostUSD) || 0,
    },
  };
}

/** A record with usage: into the session and model sums (once per `requestId`), into the trail of calls. */
function addCall(st, j) {
  const u = j.message && j.message.usage;
  if (!u || u.cache_read_input_tokens == null) return;
  const key = j.requestId || j.uuid; // see point 1 in the header
  if (st.seen.has(key)) return;
  st.seen.add(key);

  const cu = claudeUsage(u);
  economy.addUsage(st.total, cu);
  const model = (j.message && j.message.model) || 'unknown';
  economy.addUsage(st.byModel[model] || (st.byModel[model] = economy.emptyUsage()), cu);

  if (j.timestamp) { if (!st.first) st.first = j.timestamp; st.last = j.timestamp; }
  st.trail.push({
    ts: j.timestamp ? Date.parse(j.timestamp) : 0,
    cr: u.cache_read_input_tokens,
    cc: u.cache_creation_input_tokens || 0,
    out: u.output_tokens || 0,
  });
}

/** One transcript line into the parse state. */
function readTranscriptLine(st, line) {
  // Cheap pre-parse filter - see point 2 in the header.
  const hasUsage = line.includes('cache_read_input_tokens');
  const hasCost = line.includes('"cost-state"');
  if (!hasUsage && !hasCost) return;

  let j;
  try { j = JSON.parse(line); } catch { return; /* a truncated line */ }

  if (j.type === 'cost-state') {
    const anchor = costStateAnchor(j, st.trail);
    if (anchor) st.anchor = anchor;
    return;
  }
  addCall(st, j);
}

/** The price-table estimate - per model, else a sonnet session would be priced as opus. */
function estimateUsd(byModel) {
  return Object.entries(byModel).reduce((a, [m, v]) => {
    const p = priceOf(m);
    return a + v.cache_read * p.cr + v.cache_write * p.cc + v.tokens_in * p.in + v.tokens_out * p.out;
  }, 0);
}

/** The check against another's bookkeeping: printed always, including when everything matched. */
function reconcile(anchor) {
  if (!(anchor && anchor.theirs.cr)) return null;
  const rel = (mine, theirs) => (theirs ? ((mine - theirs) / theirs) * 100 : null);
  const crPct = rel(anchor.mine.cr, anchor.theirs.cr);
  const ccPct = rel(anchor.mine.cc, anchor.theirs.cc);
  const outPct = rel(anchor.mine.out, anchor.theirs.out);
  return {
    crPct: Number(crPct.toFixed(2)),
    ccPct: ccPct == null ? null : Number(ccPct.toFixed(2)),
    outPct: outPct == null ? null : Number(outPct.toFixed(2)),
    mine: anchor.mine,
    theirs: anchor.theirs,
    // How many calls in the file are older than the engine's starting point - inherited history.
    inheritedCalls: anchor.mine.inherited,
    suspect: Math.abs(crPct) > SUSPECT_PCT,
  };
}

/** A session row from the parse state. */
function sessionRow(st) {
  const t = st.total;
  const { anchor } = st;
  return {
    calls: t.calls,
    cacheRead: t.cache_read,
    cacheCreate: t.cache_write,
    input: t.tokens_in,
    output: t.tokens_out,
    // "Work" here is the model's output: the tokens produced. It is the very quantity against
    // which re-reading is measured; named on screen directly so it is not confused with
    // "everything that is not cache-read".
    ratio: t.tokens_out ? Number(economy.readPerOutput(t).toFixed(1)) : null,
    estUsd: Number(estimateUsd(st.byModel).toFixed(4)),
    // The engine's money is exact; our estimate stays beside it, the deviation is visible.
    costUsd: anchor ? Number(anchor.theirs.costUsd.toFixed(4)) : null,
    models: Object.keys(st.byModel).sort(),
    first: st.first, last: st.last,
    check: reconcile(anchor),
  };
}

/** Parsing one transcript as a stream. Returns the sums over the session and, separately, the
 *  snapshot at the line of the last `cost-state` record - that snapshot is the anchor. */
async function parseSession(file) {
  const st = newParseState();
  const rl = readline.createInterface({
    input: fs.createReadStream(file),
    crlfDelay: Infinity,
  });
  for await (const line of rl) readTranscriptLine(st, line);
  return sessionRow(st);
}

/** An ISO week - a key like 2031-W38. The time trend is shown by weeks: by days the noise of
 *  sessions drowns the trend, and one number shows no trend at all. */
function isoWeek(iso) {
  const d = new Date(iso);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t - y0) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** A session row from the cache (same size and mtime) or a fresh parse; null - the file did not parse. */
async function cachedOrParsed(full, name, stat, hit) {
  if (hit && hit.size === stat.size && hit.mtimeMs === stat.mtimeMs) return { row: hit.row, cached: true };
  try { return { row: await parseSession(full), cached: false }; } catch (e) {
    console.error(msg('spend.session-economy.skip', { name, message: e.message }));
    return null;
  }
}

/** All files of the directory -> session rows, the updated cache and the run counters. */
async function collectSessions(dir, files, cache, now) {
  const out = { sessions: [], nextCache: {}, parsed: 0, fromCache: 0, skipped: 0 };
  for (const f of files) {
    const full = path.join(dir, f);
    const st = fs.statSync(full);
    if (st.size < MIN_SIZE) { out.skipped += 1; continue; }
    const sessionId = f.replace(/\.jsonl$/, '');
    const got = await cachedOrParsed(full, f, st, cache[sessionId]);
    if (!got) continue;
    if (got.cached) out.fromCache += 1; else out.parsed += 1;
    out.nextCache[sessionId] = { size: st.size, mtimeMs: st.mtimeMs, row: got.row };
    if (!got.row.calls) continue;
    out.sessions.push({
      sessionId,
      // A live session is counted up to the last record on disk - its numbers are incomplete.
      live: now - st.mtimeMs < LIVE_WINDOW_MS,
      sizeBytes: st.size,
      ...got.row,
    });
  }
  return out;
}

function sumTotals(sessions) {
  const S = (k) => sessions.reduce((a, s) => a + (s[k] || 0), 0);
  const totals = {
    sessions: sessions.length,
    calls: S('calls'),
    cacheRead: S('cacheRead'),
    cacheCreate: S('cacheCreate'),
    input: S('input'),
    output: S('output'),
    estUsd: Number(S('estUsd').toFixed(2)),
    // The engine's money - only over the sessions where a `cost-state` exists; summing it with
    // the estimate into one number is not allowed, so the coverage of this quantity stands beside.
    costUsd: Number(sessions.reduce((a, s) => a + (s.costUsd || 0), 0).toFixed(2)),
    costUsdSessions: sessions.filter((s) => s.costUsd != null).length,
    // The best known fact about every session: the engine's figure, and where it is absent - the estimate.
    bestUsd: Number(sessions.reduce((a, s) => a + (s.costUsd != null ? s.costUsd : s.estUsd), 0).toFixed(2)),
  };
  totals.ratio = totals.output ? Number((totals.cacheRead / totals.output).toFixed(1)) : null;
  return totals;
}

// The weekly trend - the answer to "falling or growing", which one number does not give.
function weeklyTrend(sessions) {
  const weeks = {};
  for (const s of sessions) {
    if (!s.first) continue;
    const k = isoWeek(s.first);
    const w = weeks[k] || (weeks[k] = { week: k, sessions: 0, cacheRead: 0, output: 0, calls: 0, estUsd: 0 });
    w.sessions += 1; w.cacheRead += s.cacheRead; w.output += s.output;
    w.calls += s.calls; w.estUsd += s.estUsd;
  }
  return Object.values(weeks)
    .sort((a, b) => a.week.localeCompare(b.week))
    /* A week where there was almost no work (a session opened and closed) yields a ratio that
       looks like a reading and is not one. Such a week stands in the trend as a gap - by the
       tab's rule: missing data is shown as missing. */
    .map((w) => ({
      ...w,
      estUsd: Number(w.estUsd.toFixed(2)),
      thin: w.output < WEEK_MIN_OUTPUT,
      ratio: w.output >= WEEK_MIN_OUTPUT ? Number((w.cacheRead / w.output).toFixed(1)) : null,
    }));
}

function verifyAgainstCostState(sessions) {
  const checked = sessions.filter((s) => s.check);
  return {
    sessionsChecked: checked.length,
    sessionsTotal: sessions.length,
    // The worst deviation - the one the method is judged by; the average would hide an outlier.
    worstCrPct: checked.length ? checked.reduce((a, s) => (Math.abs(s.check.crPct) > Math.abs(a) ? s.check.crPct : a), 0) : null,
    suspectCount: checked.filter((s) => s.check.suspect).length,
    suspectThresholdPct: SUSPECT_PCT,
    rows: checked.map((s) => ({ sessionId: s.sessionId, date: (s.first || '').slice(0, 10), crPct: s.check.crPct, ccPct: s.check.ccPct, outPct: s.check.outPct, inheritedCalls: s.check.inheritedCalls, suspect: s.check.suspect })),
  };
}

async function build() {
  const dir = transcriptDir();
  if (!dir) {
    return { error: msg('spend.session-economy.dir_missing'), sessions: [] };
  }

  // Cache by sessionId + file size (and mtime): only what changed is rebuilt.
  let cache = {};
  // The cache holds only for the same method version: the arithmetic changed - the stored rows
  // were counted the old way, and silently carrying an edit over they must not. No cache - rebuild.
  const prev = readJson(OUT_FILE, null);
  if (prev && prev.method === METHOD_VERSION) cache = prev.cache || {};

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  const { sessions, nextCache, parsed, fromCache, skipped } = await collectSessions(dir, files, cache, Date.now());
  sessions.sort((a, b) => String(a.first).localeCompare(String(b.first)));

  return {
    generatedAt: new Date().toISOString(),
    method: METHOD_VERSION,
    transcriptDir: dir,
    run: { parsed, fromCache, skippedSmall: skipped, filesSeen: files.length },
    totals: sumTotals(sessions),
    sessions,
    byWeek: weeklyTrend(sessions),
    verification: verifyAgainstCostState(sessions),
    cache: nextCache,
  };
}

function print(data) {
  if (data.error) { console.log(data.error); return; }
  const n = (x) => Math.round(x).toLocaleString('ru-RU');
  console.log(msg('spend.session-economy.parsed', { parsed: data.run.parsed, total: data.run.parsed + data.run.fromCache, cached: data.run.fromCache }));
  console.log('');
  console.log(msg('spend.session-economy.table_header'));
  for (const s of data.sessions) {
    console.log(
      String(s.first || '?').slice(0, 10).padEnd(12) +
      String(s.calls).padStart(7) +
      (s.cacheRead / 1e6).toFixed(1).padStart(9) +
      (s.output / 1e3).toFixed(0).padStart(11) +
      String(s.ratio ?? '—').padStart(9) +
      ('$' + (s.costUsd ?? s.estUsd).toFixed(0)).padStart(7) +
      (s.live ? msg('spend.session-economy.live_yes') : '     '));
  }
  console.log('-'.repeat(64));
  console.log(msg('spend.session-economy.total_row') + String(data.totals.calls).padStart(7) +
    (data.totals.cacheRead / 1e6).toFixed(0).padStart(9) +
    (data.totals.output / 1e3).toFixed(0).padStart(11) +
    String(data.totals.ratio).padStart(9) +
    ('$' + n(data.totals.bestUsd)).padStart(7));
  console.log(msg('spend.session-economy.money_coverage', { covered: data.totals.costUsdSessions, total: data.totals.sessions }));
  console.log('');
  console.log(msg('spend.session-economy.weekly_header'));
  for (const w of data.byWeek) console.log(`  ${w.week}  ${String(w.ratio ?? '—').padStart(6)}   ${msg('spend.session-economy.week_sessions', { sessions: w.sessions })}${w.thin ? msg('spend.session-economy.thin_week') : ''}`);
  console.log('');
  const v = data.verification;
  console.log(msg('spend.session-economy.check_header', { checked: v.sessionsChecked, total: v.sessionsTotal }));
  for (const r of v.rows) {
    console.log(msg('spend.session-economy.check_row', {
      date: r.date,
      cr: (r.crPct > 0 ? '+' : '') + r.crPct,
      cc: (r.ccPct > 0 ? '+' : '') + r.ccPct,
      out: (r.outPct > 0 ? '+' : '') + r.outPct,
      inherited: r.inheritedCalls,
      suspect: r.suspect ? msg('spend.session-economy.suspect') : '',
    }));
  }
  console.log(msg('spend.session-economy.worst', { worst: v.worstCrPct, threshold: v.suspectThresholdPct }));
}

/* The "Intent <-> human, current session" item (AGENTS.md §3). Only the top-level main-session
   logs of every engine of the project - each adapter yields its own (`mainSessions`, subagent
   logs are not among them: their spend is already written into the cards' `## History`, and is
   not counted twice). The own engine (claude) parses with the cost-state anchor, others - through
   their adapter (`mainStepOf` + `parseUsage`). "Current" - live, touched within LIVE_WINDOW_MS:
   several sessions may be open in parallel, and picking one by mtime would be a guess.
   `--session <id>` - one, explicitly. The cache and the MIN_SIZE threshold do not participate
   here: the files are live and small. */
const CURRENT_FILE = path.join(CACHE_DIR, 'session-current.json');

/** Sources of live logs: the own adapter (claude, parsed with the cost-state anchor) first, then the other engines. */
function currentSources() {
  const own = require('../forma-adapter.cjs');
  const out = [];
  const seen = new Set();
  for (const s of claudeMainSessions(ROOT)) {
    if (!s || !s.file || seen.has(s.file)) continue;
    seen.add(s.file);
    out.push({ tag: own.spendTag || own.engine || own.id, id: s.id, file: s.file, legacy: true });
  }
  for (const s of engines.mainSessions(ROOT)) {
    if (!s || !s.file || seen.has(s.file)) continue;
    seen.add(s.file);
    out.push({ tag: s.tag, id: s.id, file: s.file, legacy: false, stepOf: s.stepOf, parseUsage: s.parseUsage });
  }
  return out;
}

/** Parsing another engine's log through its adapter: a step is `mainStepOf`, dedup by the step key, sums - `parseUsage`. */
async function parseNeutral(file, src) {
  const st = { seen: new Set(), total: economy.emptyUsage(), byModel: {}, first: null, last: null, prev: null };
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    let row = null;
    try { row = src.stepOf(j, st.prev); } catch { row = null; }
    st.prev = j;
    if (!row) continue;
    const fresh = row.key == null || !st.seen.has(row.key);
    if (row.key != null) st.seen.add(row.key);
    if (!fresh) continue;
    if (row.ts) { if (!st.first) st.first = row.ts; st.last = row.ts; }
    if (row.usage && src.parseUsage) {
      const u = src.parseUsage(row.usage);
      economy.addUsage(st.total, u);
      if (row.model) economy.addUsage(st.byModel[row.model] || (st.byModel[row.model] = economy.emptyUsage()), u);
    }
  }
  const t = st.total;
  // The row contract is the legacy parseSession's: buildCurrent reads estUsd/costUsd (usd = costUsd ?? estUsd).
  return {
    calls: t.calls, input: t.tokens_in, output: t.tokens_out,
    cacheCreate: t.cache_write, cacheRead: t.cache_read,
    estUsd: Number(estimateUsd(st.byModel).toFixed(4)),
    costUsd: null,
    first: st.first, last: st.last,
  };
}

async function buildCurrent(id) {
  const now = Date.now();
  const live = [];
  for (const src of currentSources()) {
    let mtime;
    try { mtime = fs.statSync(src.file).mtimeMs; } catch { continue; }
    if (id && id !== 'current' ? src.id !== id : now - mtime >= LIVE_WINDOW_MS) continue;
    live.push(src);
  }
  if (!live.length && !currentSources().length) return { error: msg('spend.session-economy.current_dirs_missing'), sessions: [] };
  const sessions = [];
  for (const src of live) {
    const row = src.legacy ? await parseSession(src.file) : await parseNeutral(src.file, src);
    if (!row.calls) continue;
    sessions.push({
      sessionId: src.id,
      engine: src.tag,
      calls: row.calls, input: row.input, output: row.output,
      cacheCreate: row.cacheCreate, cacheRead: row.cacheRead,
      // Work - everything except cache-read; the same item as `N tokens (R cache-read)` in §3.
      work: economy.usageWork({ tokens_in: row.input, tokens_out: row.output, cache_write: row.cacheCreate }),
      usd: row.costUsd != null ? row.costUsd : row.estUsd,
      usdExact: row.costUsd != null,
      first: row.first, last: row.last,
    });
  }
  const S = (k) => sessions.reduce((a, s) => a + (s[k] || 0), 0);
  return {
    generatedAt: new Date().toISOString(),
    method: METHOD_VERSION,
    selector: id || 'current',
    sessions,
    totals: { sessions: sessions.length, calls: S('calls'), work: S('work'), cacheRead: S('cacheRead'), output: S('output'), usd: Number(S('usd').toFixed(2)) },
  };
}

(async () => {
  const cli = makeCli();
  if (cli.flag('session')) {
    const data = await buildCurrent(cli.value('session'));
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(CURRENT_FILE, JSON.stringify(data, null, 2), 'utf8');
    const n = (x) => Math.round(x).toLocaleString('ru-RU');
    for (const s of data.sessions) console.log(`${s.engine ? '[' + s.engine + '] ' : ''}${s.sessionId}  ${msg('spend.session-economy.current_row', { calls: s.calls, work: n(s.work), cacheRead: n(s.cacheRead), usd: s.usd.toFixed(2), mark: s.usdExact ? '' : msg('spend.session-economy.estimated') })}`);
    if (data.error) console.log(data.error);
    console.log(`→ ${path.relative(ROOT, CURRENT_FILE)}`);
    return;
  }
  const data = await build();
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(data, null, 2), 'utf8');
  if (!data.error) {
    console.log(msg('spend.session-economy.parsed', { parsed: data.run.parsed, total: data.run.parsed + data.run.fromCache, cached: data.run.fromCache }));
    const v = data.verification;
    console.log(msg('spend.session-economy.check_summary', { checked: v.sessionsChecked, total: v.sessionsTotal, worst: v.worstCrPct, suspect: v.suspectCount, threshold: v.suspectThresholdPct }));
  }
  if (cli.flag('print')) { console.log(''); print(data); }
  console.log(`→ ${path.relative(ROOT, OUT_FILE)}`);
})();
