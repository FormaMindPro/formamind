'use strict';

/**
 * The spend line (AGENTS.md §3) - one encoding for all the counters.
 *
 * The canon is English, whatever the project's language:
 *   `Node`, YYYY-MM-DD: attempt, N tokens (R cache-read), O out, T s, `<id>` — <the description in the card's language>
 * The "O out" segment is the output tokens; "out unknown" - the engine did not return them. Old lines without the
 * segment read as "out unknown" and are not rewritten (prohibition 5).
 * The Russian legacy form (an "attempt" synonym, "N tokens" in Russian, the cache-read-unknown and
 * id-unknown wordings - held below as \u escapes, not quoted here: the source stays ASCII)
 * is only READ: old lines are not rewritten (prohibition 5).
 * `toEnglish()` brings the key part to the canon - everything up to the first dash; the description is not touched.
 *
 * Users: tally.cjs, sync-engines.cjs, tool-usage.cjs, .forma/dashboard/generate.js.
 * The digit groups - ` `/` ` as escape sequences, not literals: a literal
 * non-breaking space in a class is not found by `Edit` (project/experience/razborschiki-stroki-rashoda.md).
 */

const path = require('path');
const engines = require('./lib/engines.cjs');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DIGITS = '\\d[\\d \\u00a0\\u202f]*?';

function toEnglish(line) {
  const s = String(line);
  const cut = s.indexOf('—');
  const head = cut === -1 ? s : s.slice(0, cut);
  const rest = cut === -1 ? '' : s.slice(cut);
  const en = head
    // The legacy Russian wordings are matched as \u escapes: the source stays ASCII, the patterns
    // match the same characters as before the translation.
    .replace(/(\d{4}-\d{2}-\d{2}:\s*)\u0437\u0430\u0445\u043e\u0434,/g, '$1attempt,')
    .replace(new RegExp('(attempt,\\s*' + DIGITS + ')\\s*\u0442\u043e\u043a\u0435\u043d[\u0430-\u044f\u0451]*', 'gu'), '$1 tokens')
    .replace(/\(\s*tokens unknown\s*\)/g, 'unknown tokens')
    .replace(/\(\s*time unknown\s*\)/g, 'unknown s')
    .replace(/\(\s*\u043a\u044d\u0448-\u0447\u0442\u0435\u043d\u0438\u0435 \u043d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u043e\s*\)/g, '(cache-read unknown)')
    .replace(/(\d)\s*\u043a\u044d\u0448[^)]*\)/g, '$1 cache-read)')
    .replace(/id \u043d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u0435\u043d/g, 'id unknown')
    .replace(/(,\s*\d+)\s*\u0441(?![\u0430-\u044f\u0451])/g, '$1 s');
  return en + rest;
}

/**
 * The key part is written off-canon: from the date to the dash there is Cyrillic (the legacy Russian
 * wordings for "attempt", "tokens", "cache-read", seconds, or a service unit instead of tokens).
 * The node's signature before the date is not checked - it is a name, not a key.
 */
function isNonCanonical(line) {
  const s = String(line);
  const d = s.search(/\d{4}-\d{2}-\d{2}:/);
  if (d === -1) return false;
  const cut = s.indexOf('—', d);
  return /[\u0400-\u04ff]/.test(s.slice(d, cut === -1 ? s.length : cut));
}

// The output-tokens segment: ", O out" or ", out unknown"; captures nothing, does not shift the group numbers below.
const OUT_SEGMENT = '(?:,\\s*(?:' + DIGITS + '\\s*out(?![A-Za-z])|out unknown))?';
const OUT_RE = new RegExp(',\\s*(' + DIGITS + ')\\s*out(?![A-Za-z])');

// Groups: 1 node, 2 date, 3 tokens (a number or unknown), 4 cache-read, 5 seconds, 6 turns, 7 $, 8 provider, 9 the tail up to the dash.
const SPEND_SOURCE =
  '`([^`]+)`,\\s*(\\d{4}-\\d{2}-\\d{2}):\\s*attempt,\\s*(' + DIGITS + '|unknown)\\s*tokens?(?![A-Za-z])' +
  '(?:\\s*\\(\\s*(' + DIGITS + ')\\s*cache-read\\s*\\)|\\s*\\(\\s*cache-read unknown\\s*\\))?' +
  OUT_SEGMENT +
  '(?:,\\s*(\\d+|unknown)\\s*s(?![A-Za-z]))?' +
  '(?:,\\s*(\\d+)\\s*turns?(?![A-Za-z]))?' +
  '(?:,\\s*\\$([\\d.]+)\\s*\\(([^)]+)\\))?' +
  '([^\\n—]*)';

/** A claim of a spend record (in the canon): a date, "attempt,". */
const CLAIM_RE = /\d{4}-\d{2}-\d{2}:\s*attempt,/;
const CACHE_UNKNOWN_RE = /\(\s*cache-read unknown\s*\)/;
const TOKENS_UNKNOWN_RE = /attempt,\s*unknown\s*tokens?/;
const ID_UNKNOWN_RE = /`?id unknown`?\s*—/;

const toInt = (s) => parseInt(String(s).replace(/[\s  ]/g, ''), 10);

/** The output tokens of a spend line: a number or `null` ("out unknown" and an old line without the segment). */
function outTokens(line) {
  const s = String(line);
  const cut = s.indexOf('—');
  const m = OUT_RE.exec(cut === -1 ? s : s.slice(0, cut));
  return m ? toInt(m[1]) : null;
}

/**
 * The canonical record -> a spend line (without the leading "- "). Engine-neutral: the record
 * is brought by the engine adapter (for Claude - claude-economy.cjs). `null` -> the `unknown` marker, not 0.
 * rec: node, date, tokens, cache_read, duration_s, turns, call_id, engine, desc.
 */
function formatSpendLine(rec) {
  const g = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const known = (v) => typeof v === 'number' && Number.isFinite(v);
  const N = known(rec.tokens) ? `${g(rec.tokens)} tokens` : 'unknown tokens';
  const R = known(rec.cache_read) ? `(${g(rec.cache_read)} cache-read)` : '(cache-read unknown)';
  const O = known(rec.tokens_out) ? `, ${g(rec.tokens_out)} out` : ', out unknown';
  const T = known(rec.duration_s) ? `${rec.duration_s} s` : 'unknown s';
  const K = known(rec.turns) ? `, ${rec.turns} turns` : '';
  const id = rec.call_id ? `\`${rec.call_id}\`` : '`id unknown`';
  // The engine tag is not duplicated: a description already starting with "<engine>:" gets no second tag.
  const desc = String(rec.desc || '');
  const tail = rec.engine && !desc.trimStart().startsWith(`${rec.engine}:`) ? `${rec.engine}: ${desc}` : desc;
  return `\`${rec.node}\`, ${rec.date}: attempt, ${N} ${R}${O}, ${T}${K}, ${id} — ${tail}`;
}

/**
 * The regexes of the board checks and the counting by identifiers - everything that reads a spend line
 * lives in this module. Each has its own strictness (the format check is stricter than the counting);
 * merging them into one would change which lines the board names a violation, so these are different
 * expressions, not one with flags.
 * The digit groups - ` `/` ` as escape sequences, not literals (see the comment at the top of the file).
 */
// The line claims itself a spend record: a list item, a date, the legacy Russian "attempt" wording
// (matched as a \u escape, see toEnglish) or the canonical "attempt,".
const RU_CLAIM_LINE_RE = /^-\s.*?(\d{4}-\d{2}-\d{2}):\s*\u0437\u0430\u0445\u043e\u0434,/;
const EN_CLAIM_LINE_RE = /^-\s.*?(\d{4}-\d{2}-\d{2}):\s*attempt,/;
const CLAIM_LINE_RE = /^-\s.*\d{4}-\d{2}-\d{2}:\s*attempt,/;
// The full §3 format - a node, a date, a token number or unknown, the word token.
const PARSES_RE = /`([^`]+)`,\s*\d{4}-\d{2}-\d{2}:\s*attempt,\s*(?:(?=[\d\s ]*\d)[\d\s ]+|unknown)\s*token/;
// The token number (1 node, 2 date, 3 tokens), without unknown; and with unknown.
const SPEND_TOKENS_RE = /`([^`]+)`,\s*(\d{4}-\d{2}-\d{2}):\s*attempt,\s*((?=[\d\s  ]*\d)[\d\s  ]+)\s*token/;
const SPEND_TOKENS_OR_UNKNOWN_RE = /`([^`]+)`,\s*(\d{4}-\d{2}-\d{2}):\s*attempt,\s*((?=[\d\s  ]*\d)[\d\s  ]+|unknown)\s*token/;
// The tokens, cache-read and seconds at once (a global one: a pass over the card's text; the caller resets lastIndex).
const ATTEMPT_FORMAT_RE = /`([^`]+)`,\s*(\d{4}-\d{2}-\d{2}):\s*attempt,\s*((?=[\d\s  ]*\d)[\d\s  ]+?)\s*tokens?(?![A-Za-z])(\s*\(\s*(?=[\d\s  ]*\d)[\d\s  ]+\s*cache-read\s*\)|\s*\(\s*cache-read unknown\s*\))?(?:,\s*(?:\d[\d   ]*?\s*out(?![A-Za-z])|out unknown))?(,\s*\d+\s*s(?![A-Za-z]))?/g;
// The call identifier - the last field of the spend block before the dash: the id itself (a Claude agent_id -
// hex/uuid, bare or in backticks; an external provider's identifier - in backticks, letters/digits/dashes,
// external ids do not reduce to hex, AGENTS.md §3 "External model") or the unknown marker.
const HAS_CALL_ID_RE = /,\s*(?:`?(?:[0-9a-f]{8,}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})`?|`[A-Za-z][\w-]{9,}`|`?id unknown`?)\s*—/i;
// The engine tag after the dash is built from the loaded adapters' tags (`spendTag`, `engine`, `id`): no engine
// name is hardcoded here. A tag outside the list - a violation. No adapters - nothing to judge by: any `name:` tag fits.
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ANY_TAG = '[a-z][a-z0-9-]*';
// Without an adapter list: any `name:` tag fits (the same as `engineTagRe` with an empty list).
const ENGINE_TAG_RE = new RegExp('\\s—\\s*' + ANY_TAG + ':');
function engineTagRe(root) {
  const tags = engines.spendTags(root || PROJECT_ROOT);
  const alt = tags.length ? tags.map(escapeRe).join('|') : ANY_TAG;
  return new RegExp('\\s—\\s*(?:' + alt + '):');
}
// The identifier for stitching a card with the tool ledger: 1 node, 2 date, 3 id (or the unknown marker).
// An external id (the `[A-Za-z][\w-]{9,}` branch) is unknown to the tool ledger - it gives no stitch, but the
// line stays parseable, not discarded as defective.
const CALL_ID_RE = /`([^`]+)`,\s*(\d{4}-\d{2}-\d{2}):\s*attempt,[^\n—]*?,\s*`?([0-9a-f]{8,}|[A-Za-z][\w-]{9,})`?\s*—/;
const CALL_ID_UNKNOWN_RE = /^-\s*`([^`]+)`,\s*(\d{4}-\d{2}-\d{2}):\s*attempt,[^\n—]*?`?id unknown`?\s*—/;

// The right boundary of a main-session line's window (card-session-spend): the exact mark in the description after the dash.
// One session over one card is written by several lines - each only for the new answers; the mark is
// the "already counted" boundary for a re-write and a part of the deduplication key in the counters. No mark - null.
const SESSION_WINDOW_END_RE = new RegExp('(?:' + require('../i18n/index.cjs').alt('hist.window_end') + ') (\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z)');
const sessionWindowEnd = (line) => { const m = SESSION_WINDOW_END_RE.exec(line); return m ? Date.parse(m[1]) : null; };

// The deduplication key of a spend line - one for tally.cjs and the tab (data/attempts.cjs): else the totals diverge.
// A main-session line (card-session-spend) carries the session id, shared by all the session's cards, while each card's share is its own:
// the key - card + id + the window boundary (one session's increments all count; without the mark, cumulative lines collapse into the first).
// A batch call (Spec/Kit, kit.md "Task kitting"): the spend is divided between the cards, and the shares may coincide by chance;
// the `batch I/K` mark - the key takes the card's file and the share itself, not the numbers. Ordinary lines: the id plus the call's numbers
// (one call in two cards with the same numbers - a duplicate; a shared id with different numbers - different windows).
// `m` - an SPEND_SOURCE match: 3 tokens, 4 cache-read, 5 seconds.
const BATCH_SHARE_RE = /\(batch\s+(\d+)\/(\d+)\)/;

function dedupKey(line, file, id, m) {
  if (/card-session-spend/.test(line)) return path.basename(file) + '|' + id + '|' + (sessionWindowEnd(line) ?? '');
  const batch = BATCH_SHARE_RE.exec(line);
  if (batch) return path.basename(file) + '|' + id + '|batch|' + batch[1] + '/' + batch[2];
  return [id, m[3], m[4] ?? '', m[5] ?? ''].join('|');
}

module.exports = {
  SESSION_WINDOW_END_RE, sessionWindowEnd, BATCH_SHARE_RE, dedupKey,
  formatSpendLine, outTokens, toEnglish, isNonCanonical, SPEND_SOURCE, CLAIM_RE, CACHE_UNKNOWN_RE, TOKENS_UNKNOWN_RE, ID_UNKNOWN_RE, toInt,
  RU_CLAIM_LINE_RE, EN_CLAIM_LINE_RE, CLAIM_LINE_RE, PARSES_RE, SPEND_TOKENS_RE, SPEND_TOKENS_OR_UNKNOWN_RE,
  ATTEMPT_FORMAT_RE, HAS_CALL_ID_RE, ENGINE_TAG_RE, engineTagRe, CALL_ID_RE, CALL_ID_UNKNOWN_RE,
};
