'use strict';

// Shared by the board checks: a list of findings as one block line, and line-by-line reading of cards.

const fs = require('fs');
const path = require('path');
const i18n = require('../../../i18n/index.cjs');
const { cardFiles } = require('../../../dashboard/lib/card.cjs');

const MAX_SHOWN = 6;

/** First six items, each on its own line under the indent, then "… and N more". The check names the problem, it does not flood the output. */
function bulletList(items) {
  return items.slice(0, MAX_SHOWN).join('\n      ') +
    (items.length > MAX_SHOWN ? '\n      ' + i18n.message('board.lines.more', { n: items.length - MAX_SHOWN }, 'ru') : '');
}

/** Lines of all board cards (live and closed): `[{ file, line }]`, `file` - the card file name. */
function cardLines(root) {
  const out = [];
  for (const file of cardFiles(root)) {
    const name = path.basename(file);
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) out.push({ file: name, line });
  }
  return out;
}

module.exports = { bulletList, cardLines };
