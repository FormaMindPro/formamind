'use strict';

// Cards in `done` with `assignee: "Core"` - accepted by the human, waiting for the `Core` cycle closing (§7, "`done` - two
// states in one column"). This is a normal queue, not a violation: cards accumulate until the cycle reaches its volume
// or the human calls `Core`. So the check returns nothing into the violations - it only puts one info line into `ctx.info`
// (if the runner gave it). The queue is never red.
//
// Cards closed BEFORE the rule was introduced do not land here: they have `assignee: null`.

const fs = require('fs');
const path = require('path');
const i18n = require('../../i18n/index.cjs');
const { boardDir } = require('../../dashboard/lib/card.cjs');

function run({ root, info }) {
  const done = path.join(boardDir(root), 'done');
  if (!info || !fs.existsSync(done)) return [];
  let waiting = 0;
  for (const f of fs.readdirSync(done)) {
    if (!f.endsWith('.md')) continue;
    const m = fs.readFileSync(path.join(done, f), 'utf8').match(/^assignee:\s*"?([^"\n]*)"?\s*$/m);
    if (m && m[1].trim() === 'Core') waiting++;
  }
  if (waiting) info.push(i18n.message('board.core-closing.queue', { n: waiting }, 'ru'));
  return [];
}

module.exports = { id: 'core-closing', since: null, run };
