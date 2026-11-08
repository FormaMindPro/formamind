'use strict';

// Card keys are English only, whatever the project language (AGENTS.md §6): zone headings, kind, the "Kit" keys,
// history verbs. Texts (values, descriptions) stay in the project language. A violation - a card that
// `migrate-keys.cjs` would change: the address - the file, the expected value - the English key.

const fs = require('fs');
const path = require('path');
const i18n = require('../../i18n/index.cjs');
const { cardFiles } = require('../../dashboard/lib/card.cjs');
const { migrate } = require('../migrate-keys.cjs');
const { bulletList } = require('./support/lines.cjs');

function run({ root }) {
  const bad = [];
  for (const file of cardFiles(root, /^card-\d+.*\.md$/)) {
    const text = fs.readFileSync(file, 'utf8');
    const r = migrate(text);
    if (!r.changed) continue;
    const c = r.counts;
    const was = text.split('\n'), now = r.text.split('\n');
    const i = was.findIndex((l, k) => l !== now[k]);
    bad.push(`${path.basename(file)}:${i + 1}: ` +
      i18n.message('board.key-language.line', { was: was[i].trim().slice(0, 50), now: now[i].trim().slice(0, 50), headings: c.headings, kind: c.kind, kit: c.kit, history: c.verbs }, 'ru'));
  }
  if (!bad.length) return [];
  return [i18n.message('board.key-language.header', { n: bad.length }, 'ru') + bulletList(bad)];
}

module.exports = { id: 'key-language', since: null, run };
