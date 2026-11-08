'use strict';

// Language of the key part of the spend line. The key part (everything before the dash) is English only, whatever the
// project language (AGENTS.md §3): `attempt, N tokens (R cache-read), T s, `<id>``. The description after the dash - the card's language.
// Old lines with a Russian key part keep being read by the tallies; they are not rewritten (prohibition 5).
// Only a line dated AFTER the rule's day of entry counts as a deviation.

const i18n = require('../../i18n/index.cjs');
const { RU_CLAIM_LINE_RE, EN_CLAIM_LINE_RE, isNonCanonical } = require('../../dashboard/spend-line.cjs');
const { cardLines, bulletList } = require('./support/lines.cjs');

function run({ root, since }) {
  const bad = [];
  for (const { file, line } of cardLines(root)) {
    const t = line.trim();
    const m = RU_CLAIM_LINE_RE.exec(t) || EN_CLAIM_LINE_RE.exec(t);
    if (!m || m[1] <= since) continue;
    if (isNonCanonical(t)) bad.push(`${file}: ${t.replace(/^-\s*/, '').slice(0, 90)}`);
  }
  if (!bad.length) return [];
  return [i18n.message('board.spend-language.header', { n: bad.length, since }, 'ru') + bulletList(bad)];
}

module.exports = { id: 'spend-language', since: 'spend-english', run };
