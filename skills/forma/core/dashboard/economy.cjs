'use strict';

/**
 * The economy's math - one for all the engines.
 * The variables' contract: .forma/manual/en/03-protocol/ECONOMY.md (ru - .forma/manual/ru/03-protocol/ECONOMY.md).
 *
 * The module reads ONLY the canonical variables. Where to fetch them from and how to name
 * one's engine's fields - the engine adapter's business (§8 of its file), not this module's.
 * The engine's name arrives here only as the value of the `engine` field (the line's tag) and is not
 * compared against any constant.
 *
 * The three states of a field - without them, an incomplete record is indistinguishable from cheapness:
 *   a number    - recorded;
 *   null        - the `unknown` marker: the engine did not return it, the node named it; counted SEPARATELY;
 *   undefined   - the field not recorded at all (a line older than the rule); not counted in any way.
 */

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isUnknown = (v) => v === null;

/** The empty accumulator over the attempts (the cards' lines). */
function emptyAcc() {
  return {
    attempts: 0,
    tokens: 0, tokensUnknown: 0,
    seconds: 0, withSeconds: 0, secondsUnknown: 0,
    turns: 0, withTurns: 0,
    cacheRead: 0, withCacheRead: 0, cacheUnknown: 0, tokensWithCacheRead: 0,
    work: 0,
    idUnknown: 0,
    usd: 0,
    services: {},
  };
}

/**
 * One attempt into the accumulator. rec - the canonical variables:
 *   tokens (N, the total), cache_read (R), duration_s (T), turns, call_id, usd, ext_units [{unit, service, amount}].
 * The old convention "R larger than N" (N recorded without R) is normalized: by §3, N includes R.
 */
function addAttempt(acc, rec) {
  acc.attempts += 1;
  let tokens = rec.tokens;
  if (isNum(tokens) && isNum(rec.cache_read) && rec.cache_read > tokens) tokens += rec.cache_read;
  if (isNum(tokens)) acc.tokens += tokens; else if (isUnknown(tokens)) acc.tokensUnknown += 1;
  if (isNum(rec.duration_s)) { acc.seconds += rec.duration_s; acc.withSeconds += 1; }
  else if (isUnknown(rec.duration_s)) acc.secondsUnknown += 1;
  if (isNum(rec.turns)) { acc.turns += rec.turns; acc.withTurns += 1; }
  if (isNum(rec.cache_read)) {
    acc.cacheRead += rec.cache_read;
    acc.withCacheRead += 1;
    if (isNum(tokens)) { acc.work += Math.max(0, tokens - rec.cache_read); acc.tokensWithCacheRead += tokens; }
  } else if (isUnknown(rec.cache_read)) acc.cacheUnknown += 1;
  if (isUnknown(rec.call_id)) acc.idUnknown += 1;
  if (isNum(rec.usd)) acc.usd += rec.usd;
  for (const u of rec.ext_units || []) {
    const key = u.service + ' (' + u.unit + ')';
    acc.services[key] = (acc.services[key] || 0) + u.amount;
  }
  return acc;
}

/** The sum of the accumulators (card -> epic -> cycle: the same operation). */
function merge(into, acc) {
  for (const k of Object.keys(into)) {
    if (k === 'services') {
      for (const [s, v] of Object.entries(acc.services)) into.services[s] = (into.services[s] || 0) + v;
    } else into[k] += acc[k];
  }
  return into;
}

/** The breakdown of the attempts by a key (a node, a card, an epic, a cycle, an engine tag). */
function groupBy(records, keyFn) {
  const out = {};
  for (const r of records) {
    const k = keyFn(r);
    addAttempt(out[k] || (out[k] = emptyAcc()), r);
  }
  return out;
}

/** The breakdown by an engine tag. A line without a tag - the `untagged` key. The tokens of different keys are not summed. */
const byEngine = (records) => groupBy(records, (r) => r.engine || 'untagged');

/**
 * The cache share: R against the tokens of THE SAME attempts whose R is recorded.
 * No coverage - null ("not recorded"), not zero.
 */
function cacheShare(acc) {
  return acc.withCacheRead && acc.tokensWithCacheRead ? acc.cacheRead / acc.tokensWithCacheRead : null;
}

/** How many attempts carry the `unknown` marker in at least one field - a separate figure of the report. */
const unknownCount = (acc) => ({ tokens: acc.tokensUnknown, cache_read: acc.cacheUnknown, duration_s: acc.secondsUnknown, call_id: acc.idUnknown });

/**
 * The trend of a series [{key, value}] (a null value - a gap, not zero): the least-squares slope over the
 * points carrying a number. Fewer than two points - null.
 */
function trend(series) {
  const pts = series.map((p, i) => [i, p.value]).filter(([, v]) => isNum(v));
  if (pts.length < 2) return null;
  const n = pts.length;
  const mx = pts.reduce((a, [x]) => a + x, 0) / n;
  const my = pts.reduce((a, [, y]) => a + y, 0) / n;
  const den = pts.reduce((a, [x]) => a + (x - mx) ** 2, 0);
  return den ? pts.reduce((a, [x, y]) => a + (x - mx) * (y - my), 0) / den : 0;
}

// ───────── model calls (the transcripts) - the same variables, per call ─────────

/** The empty accumulator over the model calls. */
const emptyUsage = () => ({ calls: 0, tokens_in: 0, tokens_out: 0, cache_read: 0, cache_write: 0 });

/** One model call: u - the canonical tokens_in, tokens_out, cache_read, cache_write. */
function addUsage(acc, u) {
  acc.calls += 1;
  acc.tokens_in += u.tokens_in || 0;
  acc.tokens_out += u.tokens_out || 0;
  acc.cache_read += u.cache_read || 0;
  acc.cache_write += u.cache_write || 0;
  return acc;
}

/** The N of a §3 line: everything that passed through the window. */
const usageTokens = (u) => u.tokens_in + u.cache_write + u.cache_read + u.tokens_out;
/** The work - everything except the cache-read (N − R). */
const usageWork = (u) => u.tokens_in + u.tokens_out + u.cache_write;
/** The re-reading per an output token; no output - null. */
const readPerOutput = (u) => (u.tokens_out ? u.cache_read / u.tokens_out : null);

module.exports = {
  emptyAcc, addAttempt, merge, groupBy, byEngine, cacheShare, unknownCount, trend,
  emptyUsage, addUsage, usageTokens, usageWork, readPerOutput,
};
