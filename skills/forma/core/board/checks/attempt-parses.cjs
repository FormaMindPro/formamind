'use strict';

// The line declares itself a spend record (there is a "DATE: attempt,") and does not fit the §3 format - so the
// spend happened, but did not land in the tally. The claim - CLAIM_LINE_RE; the full format - PARSES_RE (the
// same one the dashboard parser uses). Most often the cause is not the numbers but the node label: the format
// expects `Node` at the very start of the line, and a number behind a note is read by nothing, silently.

const i18n = require('../../i18n/index.cjs');
const { toEnglish, CLAIM_LINE_RE, PARSES_RE } = require('../../dashboard/spend-line.cjs');
const { cardLines, bulletList } = require('./support/lines.cjs');

function run({ root }) {
  const bad = [];
  for (const { file, line } of cardLines(root)) {
    const t = toEnglish(line.trim());
    if (CLAIM_LINE_RE.test(t) && !PARSES_RE.test(t)) bad.push(`${file}: ${t.replace(/^-\s*/, '').slice(0, 90)}`);
  }
  if (!bad.length) return [];
  return [i18n.message('board.attempt-parses.header', { n: bad.length }, 'ru') + bulletList(bad)];
}

module.exports = { id: 'attempt-parses', since: null, run };
