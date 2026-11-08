'use strict';

// §3 and ECONOMY.md ("`Intent` in the shared session"): the description of a spend line opens with the engine tag, and a numeric `0 tokens` is a violation:
// zero is allowed only as the `unknown tokens` marker with a reason; an event without work is written without `attempt`.
// The boundary is strictly later than the day of entry, for the same reason as in the `agent-id` check.

const i18n = require('../../i18n/index.cjs');
const { toEnglish, SPEND_TOKENS_OR_UNKNOWN_RE, engineTagRe } = require('../../dashboard/spend-line.cjs');
const { cardLines, bulletList } = require('./support/lines.cjs');

function run({ root, since }) {
  const tagRe = engineTagRe(root);
  // The engine is off or removed - its past lines stay in the cards (prohibition 5): a tag like `name:` after the dash
  // is accepted without a loaded adapter too. A violation - a line with no tag at all.
  const shapedRe = /\s—\s*[a-z][a-z0-9-]*:/;
  const known = require('../../dashboard/lib/engines.cjs').spendTags(root);
  const untagged = [];
  const zero = [];
  for (const { file, line } of cardLines(root)) {
    const t = toEnglish(line.trim());
    const m = SPEND_TOKENS_OR_UNKNOWN_RE.exec(t);
    if (!m || m[2] < since) continue;
    if (!tagRe.test(t) && !shapedRe.test(t)) untagged.push(`${file}: ${m[1]} ${m[2]}`);
    if (m[3] !== 'unknown' && Number(m[3].replace(/[\s\u00A0\u202F]/g, '')) === 0) zero.push(`${file}: ${m[1]} ${m[2]}`);
  }
  const problems = [];
  if (untagged.length) {
    problems.push(i18n.message('board.engine-tag.untagged', { n: untagged.length, since, known: known.join(' / ') || i18n.message('board.engine-tag.no_adapters', null, 'ru') }, 'ru') + bulletList(untagged));
  }
  if (zero.length) {
    problems.push(i18n.message('board.engine-tag.zero', { n: zero.length, since }, 'ru') + bulletList(zero));
  }
  return problems;
}

module.exports = { id: 'engine-tag', since: 'engine-tag', run };
