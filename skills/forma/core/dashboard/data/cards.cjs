'use strict';

/**
 * Cards for the spend count: attempts, services, the closure date - and the folds by epic and by board.
 * A separate parse from the board's (`board.cjs`): the count needs only the spend lines, the board - the card's fields whole.
 */

const fs = require('fs');
const path = require('path');
const { walk } = require('../lib/fs.cjs');
const { boardDir, parseFrontmatter, cardTitle } = require('../lib/card.cjs');
const { parseAttempts, parseServiceLines, parseMalformedAttempts, parseClosedDate } = require('./attempts.cjs');

/** A card's/epic's tokens by engine tag; `unknown tokens` - a counter beside it, not a zero. */
function tokensByEngine(attempts) {
  const out = {};
  for (const z of attempts) {
    const o = out[z.engine] || (out[z.engine] = { tokens: 0, attempts: 0, tokensUnknown: 0 });
    o.attempts += 1;
    if (z.tokensUnknown) o.tokensUnknown += 1; else o.tokens += z.tokens;
  }
  return out;
}

/** Folds the per-engine cut `add` into `acc` (different engines' tokens are not mixed with each other). */
function addByEngine(acc, add) {
  for (const [k, v] of Object.entries(add)) {
    const o = acc[k] || (acc[k] = { tokens: 0, attempts: 0, tokensUnknown: 0 });
    o.tokens += v.tokens; o.attempts += v.attempts; o.tokensUnknown += v.tokensUnknown;
  }
  return acc;
}

/**
 * One call recorded in several cards with the same numbers is counted once; a shared id with different numbers - different windows, all are counted - the key is the same as in `tally.cjs`.
 * The key is `dedupKey` from spend-line.cjs (the session markers and `batch I/K` are accounted there). `seen` accumulates the keys across all cards.
 */
function dedupeAttempts(attempts, file, seen) {
  return attempts.filter((z) => {
    if (!z.dedupKey) return true;
    const key = z.dedupKey;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The closure date is written by THE board extension itself - the `completedAt` field in the frontmatter, when the card moves
 * into `done/`. It is a mechanical record: the day the card was accepted. The closure line from `Core` is a second,
 * later mark: the day the cycle was taken apart in substance. The first is more reliable and older, so it is the main one.
 */
function closedDateOf(fm, raw) {
  return (fm.completedAt && String(fm.completedAt).slice(0, 10)) || parseClosedDate(raw) || null;
}

/** Card kind: the word after the middle dot in the first task field (code · kind | ...); no field — empty. Task heading is matched in ru (escaped) and en. */
function kindOf(raw) {
  const m = /^##\s+(?:\u0417\u0430\u0434\u0430\u0447\u0430|Task)\s*$/m.exec(raw);
  if (!m) return '';
  const first = raw.slice(m.index + m[0].length).split(/\r?\n/).find((l) => l.trim()) || '';
  return (first.split('|')[0].split('\u00b7')[1] || '').trim();
}

function spendCard({ projectRoot, file, raw, fm }, seen) {
  const attempts = dedupeAttempts(parseAttempts(raw, file), file, seen);
  return {
    id: fm.id,
    title: cardTitle(raw) || fm.id,
    status: fm.status || null,
    kind: kindOf(raw),
    priority: fm.priority || null,
    assignee: fm.assignee || null,
    epic: fm.epic || null,
    labels: fm.labels || [],
    done: file.includes(`${path.sep}done${path.sep}`),
    path: path.relative(projectRoot, file).replace(/\\/g, '/'),
    attempts,
    serviceLines: parseServiceLines(raw),
    malformed: parseMalformedAttempts(raw),
    closedDate: closedDateOf(fm, raw),
    // Tokens go by the engine tag: different engines do not go into one sum.
    tokensByEngine: tokensByEngine(attempts),
    costUsdTotal: attempts.reduce((s, z) => s + z.costUsd, 0),
  };
}

/** Board cards (and `done/`) with attempts and services. A file without an `id` in the frontmatter is not a card. */
function readSpendCards(projectRoot) {
  const dir = boardDir(projectRoot);
  const files = fs.existsSync(dir) ? walk(dir, { ext: '.md', abs: true }) : [];
  const cards = [];
  const seen = new Set();
  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8');
    const fm = parseFrontmatter(raw);
    if (!fm.id) continue;
    if ((fm.labels || []).includes('demo')) continue; // a demonstration cycle - not the project's spend
    cards.push(spendCard({ projectRoot, file, raw, fm }, seen));
  }
  return cards;
}

/** Epics: cards, statuses, tokens by engines, attempts. The key is the epic's name. */
function groupEpics(cards) {
  const epics = {};
  for (const c of cards) {
    const key = c.epic || '(no epic)';
    if (!epics[key]) {
      epics[key] = { epic: key, cardCount: 0, byStatus: {}, tokensByEngine: {}, costUsdTotal: 0, attemptCount: 0, cards: [] };
    }
    const e = epics[key];
    e.cardCount += 1;
    e.byStatus[c.status] = (e.byStatus[c.status] || 0) + 1;
    addByEngine(e.tokensByEngine, c.tokensByEngine);
    e.costUsdTotal += c.costUsdTotal;
    e.attemptCount += c.attempts.length;
    e.cards.push(c);
  }
  return epics;
}

/** Totals across the whole board. */
function cardTotals(cards, epics) {
  const totals = {
    cardCount: cards.length,
    tokensByEngine: cards.reduce((acc, c) => addByEngine(acc, c.tokensByEngine), {}),
    costUsdTotal: Number(cards.reduce((s, c) => s + c.costUsdTotal, 0).toFixed(6)),
    attemptCount: cards.reduce((s, c) => s + c.attempts.length, 0),
    byStatus: {},
    epicCount: Object.keys(epics).length,
  };
  for (const c of cards) {
    totals.byStatus[c.status] = (totals.byStatus[c.status] || 0) + 1;
  }
  return totals;
}

module.exports = { readSpendCards, groupEpics, cardTotals };
