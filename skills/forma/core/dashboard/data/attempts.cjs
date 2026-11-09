'use strict';
const i18n = require('../../i18n/index.cjs');

/**
 * Spend lines in a card: node attempts, services, malformed entries, closure date.
 * The format is fixed in AGENTS.md §3:
 *   `Node`, YYYY-MM-DD: attempt, N tokens (R cache-read), T s - <what was done>.
 *   `Node`, YYYY-MM-DD: attempt, N tokens (R cache-read), T s, $X.XXXXXX (provider/model) - ...
 * The money segment is optional - external model only, not the Agent tool (subscription).
 *
 * Cache-read and seconds parse as optional: old lines without them read as before
 * and differ from new ones not by a zero but by a "not recorded" marker (`null`).
 * "token / tokens" - the numeral agrees in Russian, and the parser must know this.
 * The number MUST start with a digit: the class `[\d\s\u00a0]+` also matched spaces alone,
 * so a line "attempt, tokens not recorded" parsed as a well-formed entry with NaN
 * and dragged the whole count into NaN. `\d[\d\s\u00a0]*` requires at least one digit, and "4 787 590"
 * parses exactly as before: the spaces sit inside the number, not before it.
 * The canonical key part is English; Russian lines are reduced by `toEnglish()` before parsing.
 */

const { toEnglish, SPEND_SOURCE, ID_UNKNOWN_RE, CLAIM_RE, sessionWindowEnd, outTokens, dedupKey } = require('../spend-line.cjs');

const ATTEMPT_RE = new RegExp(SPEND_SOURCE, 'g');

const num = (s) => parseInt(String(s).replace(/[\s\u00a0]/g, ''), 10);

/**
 * A second defense, independent of the first. The strict digit in parsing closes the known case;
 * this check closes the unknown ones: a non-number NEVER enters the sum. NaN is contagious: one value
 * drags any total it lands in, and this cannot be debugged from a report. A line with a non-number goes up
 * as malformed and is named by the card's address (`data.economy.malformed`).
 * Returns ready numbers or `null` - "this is not a spend entry, it cannot be counted".
 */
function attemptNumbers(m) {
  // `unknown tokens` (ECONOMY.md, "The `unknown` marker") - the attempt is there, the number is not: null, not zero, not an omission.
  const tokensUnknown = m[3] === 'unknown';
  const tokens = tokensUnknown ? null : num(m[3]);
  if (!tokensUnknown && !Number.isFinite(tokens)) return null;
  const cacheRead = m[4] != null ? num(m[4]) : null;
  if (cacheRead != null && !Number.isFinite(cacheRead)) return null;
  const seconds = m[5] != null && m[5] !== 'unknown' ? num(m[5]) : null;
  if (seconds != null && !Number.isFinite(seconds)) return null;
  return { tokens, tokensUnknown, cacheRead, seconds, secondsUnknown: m[5] === 'unknown' };
}

// An external service counts in its own unit: Magnific has credits, another may have requests or minutes.
// The service-name parser does NOT know the names: it takes any "N <unit> (<service>/<operation>)" and groups by the pair
// service+unit. Otherwise every new service would require a code change, and until then its spend would silently go uncounted.
// Dollars stay a separate segment: they have their own, long-standing record `$X (provider/model)`.
const SERVICE_RE = /(\d[\d\s\u00a0]*)\s*([A-Za-z\u0410-\u042f\u0430-\u044f\u0401\u0451][A-Za-z\u0410-\u042f\u0430-\u044f\u0401\u0451.]*)\s*\(([^)/]+)\/([^)]+)\)/g;

function parseServices(tail) {
  const out = [];
  if (!tail) return out;
  SERVICE_RE.lastIndex = 0;
  let m;
  while ((m = SERVICE_RE.exec(tail)) !== null) {
    // A service cannot be told from time by the unit's name: "12 minutes (aura/build)" is a legitimate service
    // unit, not an attempt's time. The form tells them apart: a service has a parenthesis with a slash.
    out.push({ amount: num(m[1]), unit: m[2], service: m[3].trim(), operation: m[4].trim() });
  }
  return out;
}

// A service's spend is not always born inside a node's attempt: a human may trigger the generation directly,
// and such an event has no tokens at all. Hence a separate line form, not a fake attempt:
//   `- Service, YYYY-MM-DD: 1160 credits (magnific/tripo-image-to-3d-high) - what was done.`
const SERVICE_LINE_RE = new RegExp('^-\\s*(?:' + i18n.alt('service') + '),\\s*(\\d{4}-\\d{2}-\\d{2}):([^\\n—]*)', 'gm');

function parseServiceLines(raw) {
  const out = [];
  SERVICE_LINE_RE.lastIndex = 0;
  let m;
  while ((m = SERVICE_LINE_RE.exec(raw)) !== null) {
    for (const sv of parseServices(m[2])) out.push({ date: m[1], node: null, ...sv });
  }
  return out;
}

/**
 * Lines with the word "attempt" that did NOT parse as a spend entry. Not the same as a legitimate zero:
 * `Intent` in the main session writes "attempt, 0 tokens, 0 s" - there the numbers EXIST and are true. Here spend happened,
 * but there is no number at all - such lines silently fell out of the count while no one showed them outward.
 * What is matched is the FORM of the entry (date, colon, "attempt,"), not the word: prose is full of it.
 */
function parseMalformedAttempts(raw) {
  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    const t = toEnglish(line.trim());
    if (!/^-\s/.test(t) || !CLAIM_RE.test(t)) continue;
    ATTEMPT_RE.lastIndex = 0;
    const m = ATTEMPT_RE.exec(t);
    // Matching the form does not yet mean well-formed: the numbers may turn out to be non-numbers. Then the line is NAMED.
    if (m && attemptNumbers(m)) continue;
    out.push(t.replace(/^-\s*/, '').slice(0, 180));
  }
  return out;
}

// The card's closure date. It is not in the frontmatter and will not be (§6: the board extension writes these files, and whether it keeps
// an unfamiliar key is not established). The source is a history line with the constant closure prefix, which
// `Intent` writes on closing. No line - null, and the display takes the last attempt's date, labeling it approximate.
const CLOSED_RE = new RegExp('^-\\s*`([^`]+)`,\\s*(\\d{4}-\\d{2}-\\d{2}):\\s*(?:' + i18n.alt('hist.closed') + ')\\s*—', 'm');

function parseClosedDate(raw) {
  const m = CLOSED_RE.exec(raw);
  return m ? m[2] : null;
}

// A spend entry is an ITEM of the `## History` list, not every place where the form occurs: parsing across the
// whole file body would count a verbatim quote of an accounting line in prose as another attempt. The same rule -
// in `parseMalformedAttempts`, `tally.cjs`, `sync-engines.cjs`. The groups match ATTEMPT_RE.
const ATTEMPT_LINE_RE = new RegExp('^-\\s*' + ATTEMPT_RE.source);

/** An attempt entry from match `m` and line `line`; a non-number - `null` (`parseMalformedAttempts` names it). */
function attemptRecord(m, line, file) {
  const n = attemptNumbers(m);
  if (n === null) return null;
  const english = toEnglish(line.trim());
  const { cacheRead } = n;
  // economy.cjs canon: R greater than N means N was written without cache, total N + R.
  const tokens = n.tokens != null && cacheRead != null && cacheRead > n.tokens ? n.tokens + cacheRead : n.tokens;
  // The engine tag is the first word of the description (AGENTS.md §3); no tag - `untagged`.
  const tag = /—\s*([a-z][a-z0-9-]*):/.exec(english);
  // The call id - so that one call recorded in several cards is counted once (as in tally.cjs).
  const idm = !ID_UNKNOWN_RE.test(english) && /`([^`\s]+)`\s*$/.exec(m[9] || '');
  const record = {
    callId: idm ? idm[1] : null,
    // The dedup key is shared with tally.cjs (spend-line.cjs `dedupKey`); without a call id there is no dedup.
    dedupKey: idm && file ? dedupKey(line, file, idm[1], m) : null,
    sessionSpend: /card-session-spend/.test(line),
    tokensUnknown: n.tokensUnknown,
    node: m[1],
    engine: tag ? tag[1] : 'untagged',
    date: m[2],
    tokens,
    // Cache-read is the call's fixed overhead: loading the law and the role (§3). This is the "briefing";
    // the rest is the work on the card itself. It does not divide finer inside one call.
    cacheRead,
    // Output tokens: a number or `null` - "out unknown" and an old line without the segment (read as is, not as 0).
    tokensOut: outTokens(english),
    // Three states (ECONOMY.md, "The `unknown` marker"): the number is recorded; the field is absent altogether (an old line); the engine
    // returned none and the node NAMED it. The third is counted as a separate quantity and never summed as zero.
    cacheReadUnknown: /cache-read unknown/.test(m[0]),
    work: cacheRead != null && tokens != null ? Math.max(0, tokens - cacheRead) : null,
    seconds: n.seconds,
    secondsUnknown: n.secondsUnknown,
    costUsd: m[7] ? parseFloat(m[7]) : 0,
    provider: m[8] || null,
    services: parseServices(m[9]),
  };
  // The window-boundary marker (main-session line, `card-session-spend`): one session's increments are told apart by it.
  // The field exists only with the marker - entries without it stay as they were, the data snapshot does not change.
  const windowEnd = sessionWindowEnd(line);
  if (windowEnd != null) record.windowEnd = windowEnd;
  return record;
}

/** Node attempts from the card's spend lines. */
function parseAttempts(raw, file) {
  const attempts = [];
  for (const line of raw.split(/\r?\n/)) {
    const m = ATTEMPT_LINE_RE.exec(toEnglish(line.trim()));
    if (m === null) continue;
    // The only place where a spend entry is born - hence also the only gate for a non-number.
    const record = attemptRecord(m, line, file);
    if (record !== null) attempts.push(record);
  }
  return attempts;
}

module.exports = { parseAttempts, parseServiceLines, parseMalformedAttempts, parseClosedDate };
