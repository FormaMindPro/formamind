'use strict';

// The call identifier of a spend line. The law (AGENTS.md §3): the id stands last in the spend block, right before the dash -
//   `Node`, YYYY-MM-DD: attempt, N tokens (R cache-read), T s, `<call id>` - what was done.
// It is the only field shared by the card and the tool journal: the journal knows the id and does not know the cards,
// the card knows the task and does not know the id.
//
// The date boundary - strictly AFTER the day of entry, not "from that day": lines written on the very day the field
// was introduced do not carry it yet, and there is nothing to fill them with - the id does not survive the call return.
// A check red from day one on the unfixable stops being readable (that is what happened with R and T).

const i18n = require('../../i18n/index.cjs');
const { toEnglish, SPEND_TOKENS_RE, HAS_CALL_ID_RE } = require('../../dashboard/spend-line.cjs');
const { cardLines, bulletList } = require('./support/lines.cjs');

function run({ root, since }) {
  // The claim of a spend record - SPEND_TOKENS_RE. The id - the last field of the spend block before the dash (HAS_CALL_ID_RE): the
  // identifier itself, or the unknown marker (ECONOMY.md, "The `unknown` marker"): the engine never returned it, the node said so,
  // and the line stays complete.
  const missing = [];
  for (const { file, line } of cardLines(root)) {
    const t = toEnglish(line.trim());
    const m = SPEND_TOKENS_RE.exec(t);
    if (!m || m[2] < since) continue;
    // A legitimate zero: the node worked inside the shared session, there was no separate call - so there is nowhere for an id to come from.
    if (Number(m[3].replace(/[\s\u00A0\u202F]/g, '')) === 0) continue;
    if (!HAS_CALL_ID_RE.test(t)) missing.push(`${file}: ${m[1]} ${m[2]}`);
  }
  if (!missing.length) return [];
  return [i18n.message('board.agent-id.header', { n: missing.length, since }, 'ru') + bulletList(missing)];
}

module.exports = { id: 'agent-id', since: 'agent-id', run };
