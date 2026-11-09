#!/usr/bin/env node
'use strict';

/**
 * Pilot counter of attempts/tokens/money over the cards' histories.
 * The data source is strictly the format of AGENTS.md section 3 (the key part is English
 * whatever the project's language):
 *   `Node`, YYYY-MM-DD: attempt, N tokens (R cache-read), T s, `<id>` — <what was done>
 *   `Node`, YYYY-MM-DD: attempt, N tokens, T s, $X.XXXXXX (provider/model) — <what was done>
 * The old lines' Russian form ("attempt, N tokens…") is read through toEnglish() (spend-line.cjs).
 * The money segment is optional - only for attempts through an external model, not the Agent tool.
 * Reads ready facts, evaluates nothing and guesses nothing.
 *
 * Usage:
 * Core: lives in .forma/dashboard/ next to economy.cjs; an engine adapter may keep a thin reference to this module.
 *   node tally.cjs <file-or-dir> [more file-or-dir ...]
 *   node tally.cjs <card-number> [...]              → "NNN", "card-NNN" or "N": the live board, then done/
 *   node tally.cjs --report [<file-or-dir> ...]     → the denominator, for the eyes
 *   node tally.cjs --routes [--json] [<file-or-dir> ...] → the cut by route-N/over-N/seg-N/wave-N
 *
 * The catalog is walked recursively, only *.md are taken.
 * The output is JSON on stdout, English keys: byNode and total, plus unparsed - lines
 * that look like an attempt record but were not recognized (for a manual format check).
 */

const fs = require('fs');
const path = require('path');
const economy = require('./economy.cjs');
const { walk } = require('./lib/fs.cjs');
const { frontmatterBlock } = require('./lib/card.cjs');
const engines = require('./lib/engines.cjs');
const { toEnglish, SPEND_SOURCE, CLAIM_RE, CACHE_UNKNOWN_RE, TOKENS_UNKNOWN_RE, ID_UNKNOWN_RE, toInt, outTokens, dedupKey } = require('./spend-line.cjs');

// Canonical English strings of this module's own CLI output live in the core dictionary; the log language is fixed.
const { message: coreMessage } = require('../i18n/index.cjs');
const logMsg = (key, params) => coreMessage(key, params, 'en');

// Three things on which this parsing broke or would break:
//   1. Number digits are written with spaces ("52 339 tokens") - a plain \d+ does not take such a string.
//   2. The cache-read (AGENTS.md §3) stands in parentheses right after the tokens.
//   3. Seconds cannot be mandatory: not every recorded line has them,
//      and demanding them would silently lose the whole attempt instead of one field.
// The groups are spend-line.cjs's; only the `^-` anchor and the description after the dash are added here.
const LINE_RE = new RegExp('^-\\s*' + SPEND_SOURCE + '—\\s*(.*)$', 'i');

// An external service counts in its own unit (Magnific - credits, another - minutes).
// The parsing does not know service names: it takes any "N <unit> (<service>/<operation>)".
// What tells a service from time is the form, not the word: a service has the parenthesis with a slash.
const SERVICE_RE = /(\d[\d\s\u00a0\u202f]*)\s*([A-Za-z\u0410-\u044f\u0401\u0451][A-Za-z\u0410-\u044f\u0401\u0451.]*)\s*\(([^)\/]+)\/([^)]+)\)/g;

// Lines that look like an attempt record (there is "attempt," and a date) but did not match LINE_RE -
// a reason to check the format by hand, not to lose the data silently. The "attempt N," form (the attempt
// number instead of tokens) is suspicious too.
const SUSPECT_RE = new RegExp('`[^`]+`,\\s*' + CLAIM_RE.source.replace('attempt,', 'attempt\\s*\\d*,'));

/** A card of a demonstration cycle (the `demo` label): not counted in the spend and the board's statistics. */
const isDemoCard = (file) => /^labels:\s*\[[^\]]*["']demo["']/m.test(fs.readFileSync(file, 'utf8'));

// The catalog is walked without demo cards; an explicitly named card is counted - that is how the demo's own total is read.
function collectFiles(targets) {
  const files = [];
  for (const target of targets) {
    const stat = fs.statSync(target);
    if (stat.isDirectory()) files.push(...walk(target, { ext: '.md', abs: true }).filter((f) => !isDemoCard(f)));
    else if (stat.isFile() && target.endsWith('.md')) files.push(target);
  }
  return files;
}

function tally(targets, canon) {
  return tallyFiles(collectFiles(targets), new Set(), undefined, canon);
}

/** The line's engine key: the tag after the dash; no tag - undefined (in the cut - `untagged`, economy.byEngine). */
const engineKey = (line) => { const m = /—\s*([a-z][a-z0-9-]*):/.exec(line); return m ? m[1] : undefined; };

/** The key with the tag's aliases reduced to the engine's main label (`canon` - a tag -> tag function; without it the key is as in the line). */
const canonKey = (line, canon) => { const k = engineKey(line); return k !== undefined && canon ? canon(k) : k; };

//** "N <unit> (<service>/<operation>)" from the line's tail: external services' spend. */
function serviceUnits(tail) {
  const ext = [];
  SERVICE_RE.lastIndex = 0;
  let sv;
  while ((sv = SERVICE_RE.exec(tail || '')) !== null) ext.push({ service: sv[3].trim(), unit: sv[2], amount: toInt(sv[1]) });
  return ext;
}

/** The call id at the end of the line's tail; `id unknown` or its absence - false/null. */
const callIdMatch = (line, tail) => !ID_UNKNOWN_RE.test(line) && /`([^`\s]+)`\s*$/.exec(tail || '');

// A line → the canonical variables (.forma/manual/en/03-protocol/ECONOMY.md); the counting - economy.cjs.
// null - the `unknown` marker (kept apart), undefined - the field not recorded.
function attemptRecord(m, line, idMatch, canon) {
  const [, node, , tokensStr, cacheStr, secondsStr, turnsStr, costStr, , tail] = m;
  return {
    node,
    engine: canonKey(line, canon),
    tokens: TOKENS_UNKNOWN_RE.test(line) ? null : toInt(tokensStr),
    cache_read: cacheStr != null ? toInt(cacheStr) : (CACHE_UNKNOWN_RE.test(line) ? null : undefined),
    tokens_out: outTokens(line), // null - "out unknown" and old lines without the segment
    duration_s: secondsStr == null ? undefined : (secondsStr === 'unknown' ? null : toInt(secondsStr)),
    turns: turnsStr == null ? undefined : toInt(turnsStr),
    call_id: ID_UNKNOWN_RE.test(line) ? null : (idMatch ? idMatch[1] : undefined),
    usd: costStr ? parseFloat(costStr) : undefined,
    ext_units: serviceUnits(tail),
  };
}

// What to do with a line: { unparsed } - name it; { dup } - the id is already counted; { rec } - record; {} - skip.
function readLine(raw, file, engine, seenIds, canon) {
  const line = toEnglish(raw.trim());
  const m = LINE_RE.exec(line);
  if (!m) return SUSPECT_RE.test(line) ? { unparsed: line } : {};
  // A match with the form is not yet a number: a line like "attempt, tokens not
  // recorded" once passed the parsing and carried the whole total into NaN. The second,
  // form-strictness-independent guard: a non-number never enters the sum,
  // and the line goes to unparsed - that is, is named by file and text.
  if (!TOKENS_UNKNOWN_RE.test(line) && !Number.isFinite(toInt(m[3]))) return { unparsed: line };
  if (engine && (canonKey(line, canon) || 'untagged') !== engine) return {};
  const idMatch = callIdMatch(line, m[9]);
  if (idMatch) {
    const key = dedupKey(line, file, idMatch[1], m);
    if (seenIds.has(key)) return { dup: true };
    seenIds.add(key);
  }
  return { rec: attemptRecord(m, line, idMatch, canon) };
}

function newTallyState() {
  // Cards where an attempt was recorded by anyone. Apart from `files` per node: a sum
  // by nodes counts one card as many times as there were nodes in it,
  // and the coverage would come out inflated.
  return { byNode: {}, records: [], engineFiles: {}, unparsed: [], filesWithAttempt: new Set() };
}

function absorb(st, file, res) {
  const name = path.basename(file);
  if (res.unparsed) { st.unparsed.push({ file: name, lineNo: res.lineNo, line: res.unparsed }); return; }
  if (res.dup) { st.filesWithAttempt.add(name); return; }
  const rec = res.rec;
  if (!rec) return;
  if (!st.byNode[rec.node]) st.byNode[rec.node] = Object.assign(economy.emptyAcc(), { files: new Set() });
  economy.addAttempt(st.byNode[rec.node], rec);
  st.records.push(rec);
  const ek = rec.engine || 'untagged';
  (st.engineFiles[ek] || (st.engineFiles[ek] = new Set())).add(name);
  st.byNode[rec.node].files.add(name);
  st.filesWithAttempt.add(name);
}

/** The cut by nodes and the total; external services' units are merged across all nodes. */
function summarizeNodes(byNode) {
  const services = {};
  for (const v of Object.values(byNode)) for (const [k, x] of Object.entries(v.services)) services[k] = (services[k] || 0) + x;
  const total = { attempts: 0, tokens: 0, tokensUnknown: 0, seconds: 0, secondsUnknown: 0, turns: 0, usd: 0, services };
  const nodesOut = {};
  for (const [node, v] of Object.entries(byNode)) {
    nodesOut[node] = {
      attempts: v.attempts,
      tokens: v.tokens,
      tokensUnknown: v.tokensUnknown,
      secondsUnknown: v.secondsUnknown,
      seconds: v.seconds,
      withSeconds: v.withSeconds,
      turns: v.turns,
      withTurns: v.withTurns,
      cacheRead: v.cacheRead,
      work: v.work,
      withCacheRead: v.withCacheRead,
      tokensWithCacheRead: v.tokensWithCacheRead,
      cacheUnknown: v.cacheUnknown,
      idUnknown: v.idUnknown,
      usd: Number(v.usd.toFixed(6)),
      files: v.files.size,
    };
    total.attempts += v.attempts;
    total.tokens += v.tokens;
    total.tokensUnknown += v.tokensUnknown;
    total.secondsUnknown += v.secondsUnknown;
    total.seconds += v.seconds;
    total.turns += v.turns;
    total.usd += v.usd;
  }
  total.usd = Number(total.usd.toFixed(6));
  return { nodesOut, total };
}

// By engines - economy.byEngine. The keys' tokens are not added together;
// `unknown` - a separate number per each field.
function summarizeEngines(records, engineFiles) {
  const byEngine = {};
  for (const [k, v] of Object.entries(economy.byEngine(records))) {
    byEngine[k] = {
      attempts: v.attempts, tokens: v.tokens, cacheRead: v.cacheRead, withCacheRead: v.withCacheRead,
      seconds: v.seconds, withSeconds: v.withSeconds, usd: Number(v.usd.toFixed(6)),
      cards: engineFiles[k] ? engineFiles[k].size : 0,
      unknown: economy.unknownCount(v),
    };
  }
  return byEngine;
}

// seenIds is passed from outside so that the cut by routes (byRoute) collapses a shared id
// the same way as the through count: one call - once over the whole corpus.
// engine - an optional filter by the engine key (`untagged` - lines without a tag):
// the cut of one engine, so that different engines' tokens do not meet in one sum.
// One call that served several cards is recorded in each by the same line
// (AGENTS.md §3, the call id). Counted once - by id.
// Lines without an id (`id unknown`, an attempt without a separate call) are not collapsed.
function tallyFiles(files, seenIds, engine, canon) {
  const st = newTallyState();
  for (const file of files) {
    fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((raw, i) => {
      const res = readLine(raw, file, engine, seenIds, canon);
      if (res.unparsed) res.lineNo = i + 1;
      absorb(st, file, res);
    });
  }
  const { nodesOut, total } = summarizeNodes(st.byNode);
  return {
    filesProcessed: files.length,
    cardsWithAttempt: st.filesWithAttempt.size,
    byNode: nodesOut,
    byEngine: summarizeEngines(st.records, st.engineFiles),
    total,
    unparsed: st.unparsed,
  };
}

// ─────────────────────────── the cut by routes ───────────────────────────
// Route labels - AGENTS.md §6 and .forma/manual/en/03-protocol/ROUTES.md §3: route-0…route-8,
// over-1…over-4 (overlays, counted by their own table: a card may carry several
// of them), seg-N and wave-N (slices of route-8). The old `route-intent-run` = `route-2`.
// The preparation share - the spend of Spec + Kit against the spend of the route's cards; on route-4 Kit is
// the executor, there the preparation is Spec only. Returns - the executor's attempts (Run;
// on route-4 - Kit) beyond the first one on the card: tally did not count them separately.
// A card without a route label - the "no route" row.

const ROUTE_ALIAS = { 'route-intent-run': 'route-2' };
const NO_ROUTE = logMsg('tally.routes.no_route');

function readLabels(text) {
  const fm = frontmatterBlock(text);
  const m = fm && /^labels:\s*\[(.*)\]\s*$/m.exec(fm);
  if (!m) return [];
  return m[1].split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
    .map((l) => ROUTE_ALIAS[l] || l);
}

function emptyRow(key) {
  return { key, cards: 0, attempts: 0, tokens: 0, tokensUnknown: 0, cacheRead: 0, cacheUnknown: 0,
    seconds: 0, secondsUnknown: 0, turns: 0, returns: 0, prepTokens: 0, prepNodes: 'Spec+Kit' };
}

function byRoute(targets, engine, canon) {
  const files = collectFiles(targets);
  const seenIds = new Set();
  const tables = { route: {}, over: {}, seg: {}, wave: {} };
  for (const file of files) {
    const labels = readLabels(fs.readFileSync(file, 'utf8'));
    const t = tallyFiles([file], seenIds, engine, canon);
    if (engine && !Object.keys(t.byNode).length) continue;
    const route = labels.find((l) => /^route-\d+$/.test(l));
    const prep = route === 'route-4' ? ['Spec'] : ['Spec', 'Kit'];
    const executor = route === 'route-4' ? 'Kit' : 'Run';
    const keys = [['route', route || NO_ROUTE]];
    for (const l of labels) {
      const k = /^(over|seg|wave)-\d+$/.exec(l);
      if (k) keys.push([k[1], l]);
    }
    for (const [table, key] of keys) {
      const row = tables[table][key] || (tables[table][key] = emptyRow(key));
      if (table === 'route' && route === 'route-4') row.prepNodes = 'Spec';
      row.cards += 1;
      for (const [node, v] of Object.entries(t.byNode)) {
        row.attempts += v.attempts;
        row.tokens += v.tokens;
        row.tokensUnknown += v.tokensUnknown;
        row.cacheRead += v.cacheRead;
        row.cacheUnknown += v.cacheUnknown;
        row.seconds += v.seconds;
        row.secondsUnknown += v.secondsUnknown;
        row.turns += v.turns;
        if (prep.includes(node)) row.prepTokens += v.tokens;
        if (node === executor) row.returns += Math.max(0, v.attempts - 1);
      }
    }
  }
  const order = (a, b) => (a.key === NO_ROUTE) - (b.key === NO_ROUTE)
    || a.key.localeCompare(b.key, 'en', { numeric: true });
  const out = {};
  for (const [name, rows] of Object.entries(tables)) {
    out[name] = Object.values(rows).sort(order).map((r) => ({
      ...r, prepShare: r.tokens ? Math.round((r.prepTokens / r.tokens) * 100) : null,
    }));
  }
  return out;
}

function routeReport(targets) {
  const t = byRoute(targets);
  const L = [logMsg('tally.routes.title'), '='.repeat(64)];
  const head = logMsg('tally.routes.th_label').padEnd(14) + logMsg('tally.routes.th_cards').padStart(6) + logMsg('tally.routes.th_attempts').padStart(7) + logMsg('tally.routes.th_tokens').padStart(12) +
    'cache-read'.padStart(12) + logMsg('tally.routes.th_seconds').padStart(8) + logMsg('tally.routes.th_turns').padStart(8) + logMsg('tally.routes.th_returns').padStart(7) + logMsg('tally.routes.th_prep');
  for (const [name, title] of [['route', logMsg('tally.routes.section_route')], ['over', logMsg('tally.routes.section_over')], ['seg', logMsg('tally.routes.section_seg')], ['wave', logMsg('tally.routes.section_wave')]]) {
    if (!t[name].length) continue;
    L.push('', title, head);
    for (const r of t[name]) {
      const unk = [];
      if (r.tokensUnknown) unk.push(logMsg('tally.routes.unknown_tokens', { n: r.tokensUnknown }));
      if (r.cacheUnknown) unk.push(`cache-read unknown: ${r.cacheUnknown}`);
      if (r.secondsUnknown) unk.push(logMsg('tally.routes.unknown_seconds', { n: r.secondsUnknown }));
      const turnsStr = r.turns > 0 ? String(r.turns) : '—';
      L.push(r.key.padEnd(14) + String(r.cards).padStart(6) + String(r.attempts).padStart(7) +
        groups(r.tokens).padStart(12) + groups(r.cacheRead).padStart(12) + groups(r.seconds).padStart(8) +
        turnsStr.padStart(8) + String(r.returns).padStart(7) + '  ' + (r.prepShare == null ? NOT_RECORDED : `${r.prepShare}% (${r.prepNodes})`) +
        (unk.length ? `\n${' '.repeat(14)}${unk.join('; ')} ${logMsg('tally.routes.unknown_suffix')}` : ''));
    }
  }
  L.push('', logMsg('tally.routes.foot_prep'));
  L.push(logMsg('tally.routes.foot_returns'));
  return L.join('\n');
}

// ─────────────────────────── the denominator ───────────────────────────
// The measure of useful work - a CLOSED CARD, not a burnt token. The ratio
// "re-reading / tokens" falls also because the task simply became longer.
// THE RULE OF THIS REPORT: next to each quantity stands its coverage,
// and a quantity with zero coverage is not counted at all - "not recorded" is printed.
// Zero and "not recorded" already looked identical once.

const FEATURES_DIR = path.resolve(__dirname, '..', '..', '.devtool', 'features');
const NOT_RECORDED = logMsg('tally.report.not_recorded');

function countClosedCards() {
  const dir = path.join(FEATURES_DIR, 'done');
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).length;
  } catch { return 0; }
}

/** Digit-group spaces - so a long number is read by the eyes, not recomputed. */
const groups = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** The caption's numeral: 1 token / 2 tokens / 5 tokens. */
function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}
const tokenWord = (n) => plural(n, logMsg('tally.words.token_one'), logMsg('tally.words.token_few'), logMsg('tally.words.token_many'));
const wordAttempts = (n) => plural(n, logMsg('tally.words.attempt_one'), logMsg('tally.words.attempt_few'), logMsg('tally.words.attempt_many'));
const fileWord = (n) => plural(n, logMsg('tally.words.file_one'), logMsg('tally.words.file_few'), logMsg('tally.words.file_many'));

/**
 * One report line. The only place where "a number or 'not recorded'" is decided:
 * the COVERAGE decides, not the value. cover = { done, all } - attempts with the quantity, of all.
 */
function metricLine(label, cover, compute, unit) {
  const head = label.padEnd(34);
  const pad = ' '.repeat(34);
  if (!cover.done) {
    return `${head}${NOT_RECORDED}\n${pad}${logMsg('tally.report.metric_cover_none', { all: groups(cover.all) })}`;
  }
  const share = Math.round((cover.done / cover.all) * 100);
  return `${head}${compute()} ${unit}\n${pad}${logMsg('tally.report.metric_cover', { done: groups(cover.done), all: groups(cover.all), share })}`;
}

/** The header: the corpus, "tokens not returned by the engine" and the cache-read state. */
function corpusLines(c) {
  const L = [logMsg('tally.report.title'), '='.repeat(64)];
  L.push(logMsg('tally.report.corpus', {
    files: groups(c.filesProcessed), files_word: fileWord(c.filesProcessed),
    attempts: groups(c.attempts), attempts_word: wordAttempts(c.attempts),
    tokens: groups(c.allTokens), tokens_word: tokenWord(c.allTokens),
    closed: groups(c.closed),
  }));
  if (c.tokensUnknown) L.push(logMsg('tally.report.tokens_unknown', { n: groups(c.tokensUnknown), word: wordAttempts(c.tokensUnknown) }));

  /* TWO STATES AT ONCE - the corpus's norm, not a report failure.
     R is restored from the attempt's transcript, and early attempts have none. */
  const withoutCache = c.attempts - c.withCache;
  if (c.withCache && withoutCache) {
    L.push(logMsg('tally.report.cache_present', {
      count: groups(c.withCache),
      count_word: plural(c.withCache, logMsg('tally.words.attempt_gen_one'), logMsg('tally.words.attempt_gen_few'), logMsg('tally.words.attempt_gen_many')),
      attempts: groups(c.attempts),
      rest: groups(withoutCache),
    }));
    L.push(logMsg('tally.report.cache_note1'));
    L.push(logMsg('tally.report.cache_note2'));
  } else if (!c.withCache && c.attempts) {
    L.push(logMsg('tally.report.cache_none', { attempts: groups(c.attempts) }));
  }
  L.push('');
  return L;
}

// 2. Attempts per closed card. Printed as the INVERSE fraction when there are fewer attempts
// than cards: the leading zero reads to the eyes as "almost nothing".
function attemptsPerCardLines(c) {
  const label = logMsg('tally.report.apc_label').padEnd(34);
  const pad = ' '.repeat(34);
  if (!c.closed || !c.cardsWithAttempt) {
    return [`${label}${NOT_RECORDED}`, `${pad}${logMsg('tally.report.apc_cover_none')}`];
  }
  const value = c.attempts >= c.closed
    ? logMsg('tally.report.apc_value_direct', { v: (c.attempts / c.closed).toFixed(1) })
    : logMsg('tally.report.apc_value_inverse', { v: (c.closed / c.attempts).toFixed(1) });
  return [
    `${label}${value}`,
    `${pad}${logMsg('tally.report.apc_cover', { cards: groups(c.cardsWithAttempt), closed: groups(c.closed) })}`,
    `${pad}${logMsg('tally.report.apc_bound1', { attempts: groups(c.attempts) })}`,
    `${pad}${logMsg('tally.report.apc_bound2')}`,
  ];
}

// 4. Steps per attempt - R divided by one node-step's weight.
function stepsPerAttempt(byNode, weights) {
  const parts = [];
  for (const [node, v] of Object.entries(byNode)) {
    if (!v.withCacheRead || !weights) continue;
    const w = weights().byNode[node];
    if (!w) continue;
    parts.push(`${node} ${(v.cacheRead / v.withCacheRead / w.perStep).toFixed(1)}`);
  }
  return parts.length ? parts.join(', ') : NOT_RECORDED;
}

/** The report's four quantities, each with its coverage. */
function metricLines(c, byNode, weights) {
  const cover = { done: c.withCache, all: c.attempts };
  const pad = ' '.repeat(34);
  const L = [];
  // 1. Re-reads per closed card - coverage over attempts with a recorded R.
  L.push(metricLine(logMsg('tally.report.metric_reread_label'), cover,
    () => groups(Math.round(c.cacheRead / Math.max(1, c.closed))), logMsg('tally.report.metric_reread_unit')), '');
  L.push(...attemptsPerCardLines(c), '');
  // 3. The re-read share in the window - divided by the tokens of THE SAME attempts that have R recorded.
  // The charter - ~4% of R, the rest is the conversation sent again.
  L.push(metricLine(logMsg('tally.report.metric_share_label'), cover,
    () => Math.round((c.cacheRead / Math.max(1, c.tokensWithCache)) * 100) + '%', ''));
  L.push(`${pad}${logMsg('tally.report.share_note1')}`);
  L.push(`${pad}${logMsg('tally.report.share_note2')}`, '');
  L.push(metricLine(logMsg('tally.report.metric_steps_label'), cover, () => stepsPerAttempt(byNode, weights), logMsg('tally.report.metric_steps_unit')), '');
  return L;
}

// THE FLOOR. The fastest way to drop the instruction share - throw AGENTS.md out.
// So the floor is named always, even when the share itself is not yet computed.
function floorLines(weights) {
  const L = ['-'.repeat(64), logMsg('tally.report.floor_title')];
  if (weights) {
    const w = weights();
    for (const [node, v] of Object.entries(w.byNode)) {
      L.push(logMsg('tally.report.floor_node', { node: node.padEnd(8), tokens: groups(v.perStep), word: tokenWord(v.perStep) }));
    }
    L.push(logMsg('tally.report.floor_common', { files: w.common.files.map((f) => f.file).join(' + '), tokens: groups(w.common.tokens), word: tokenWord(w.common.tokens) }));
    L.push(logMsg('tally.report.floor_estimate'));
  } else {
    L.push(logMsg('tally.report.floor_unavailable'));
  }
  L.push(logMsg('tally.report.floor_law'), '');
  L.push(logMsg('tally.report.approximation'));
  return L;
}

function unparsedLines(unparsed) {
  if (!unparsed.length) return [];
  return ['', logMsg('tally.report.unparsed_header', { n: unparsed.length }),
    ...unparsed.slice(0, 5).map((s) => `  ${s.file}${s.lineNo ? ':' + s.lineNo : ''}: ${s.line}`)];
}

function report(targets) {
  const { byNode, total, filesProcessed, cardsWithAttempt, unparsed } = tally(targets);
  // The instruction weight is the engine adapter's business; no adapter - the floor is named as unavailable.
  const weights = engines.first(path.resolve(__dirname, '..', '..'), 'instructionWeight');
  const sum = (key) => Object.values(byNode).reduce((s, v) => s + v[key], 0);
  const c = {
    filesProcessed, cardsWithAttempt, attempts: total.attempts, allTokens: total.tokens,
    tokensUnknown: total.tokensUnknown, closed: countClosedCards(),
    withCache: sum('withCacheRead'), cacheRead: sum('cacheRead'), tokensWithCache: sum('tokensWithCacheRead'),
  };
  return [...corpusLines(c), ...metricLines(c, byNode, weights), ...floorLines(weights), ...unparsedLines(unparsed)].join('\n');
}

/** A card reference ("NNN", "card-NNN", "N") into its file's path: the live board, then done/. */
function resolveCardRef(arg) {
  if (fs.existsSync(arg)) return arg;
  const m = /^(?:card-)?(\d{1,4})$/.exec(arg);
  if (!m) return arg;
  const suffix = 'card-' + String(Number(m[1])).padStart(3, '0') + '-';
  for (const dir of [FEATURES_DIR, path.join(FEATURES_DIR, 'done')]) {
    let hits = [];
    try { hits = fs.readdirSync(dir).filter((f) => f.startsWith(suffix) && f.endsWith('.md')).sort(); } catch { hits = []; }
    if (hits.length === 1) return path.join(dir, hits[0]);
    if (hits.length > 1) return { ambiguous: hits.map((f) => path.join(dir, f)) };
  }
  return arg;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--routes')) {
    const rest = argv.filter((a) => a !== '--routes' && a !== '--json');
    const targets = rest.length ? rest : [FEATURES_DIR];
    const text = argv.includes('--json') ? JSON.stringify(byRoute(targets), null, 2) : routeReport(targets);
    process.stdout.write(text + '\n');
    return;
  }
  if (argv.includes('--report')) {
    const rest = argv.filter((a) => a !== '--report');
    const targets = rest.length ? rest : [FEATURES_DIR];
    const missing = targets.filter((a) => !fs.existsSync(a));
    if (missing.length) { console.error(logMsg('tally.cli.not_found') + missing.join(', ')); process.exit(1); }
    process.stdout.write(report(targets) + '\n');
    return;
  }
  const args = argv;
  if (args.length === 0) {
    console.error(logMsg('tally.cli.usage'));
    process.exit(1);
  }
  const targets = args.map(resolveCardRef);
  const ambiguous = targets.filter((t) => t && t.ambiguous);
  if (ambiguous.length) {
    console.error(logMsg('tally.cli.ambiguous') + ambiguous.flatMap((t) => t.ambiguous).join(', '));
    process.exit(1);
  }
  const missing = targets.filter((a) => !fs.existsSync(a));
  if (missing.length) {
    console.error(logMsg('tally.cli.not_found') + missing.join(', '));
    process.exit(1);
  }
  const result = tally(targets);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

module.exports = { tally, byRoute, readLabels, main };
if (require.main === module) main();
