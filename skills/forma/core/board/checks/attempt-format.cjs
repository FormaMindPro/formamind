'use strict';

// Completeness of the spend line: cache-read and time. The law (AGENTS.md §3) requires writing the attempt as
//   `Node`, YYYY-MM-DD: attempt, N tokens (R cache-read), T s, `<id>` - what was done.
// The cache-read is the constant overhead of a call, loading the rules and the role; by it and only by it "briefing"
// differs from "production". The past values cannot be restored: call metadata is not kept, so only the attempts
// from the rule's day of entry and later are checked. The past is not rewritten (prohibition 5): demanding the fields
// from lines there is nothing to fill them with means keeping the check red forever and teaching it to be unread.

const fs = require('fs');
const path = require('path');
const i18n = require('../../i18n/index.cjs');
const { toEnglish, ATTEMPT_FORMAT_RE } = require('../../dashboard/spend-line.cjs');
const { cardFiles } = require('../../dashboard/lib/card.cjs');
const { bulletList } = require('./support/lines.cjs');

const CACHE_UNKNOWN_RE = /\(\s*cache-read unknown\s*\)/;

/** The file line holding the found match - whole. */
function lineAt(body, idx) {
  const s = body.lastIndexOf('\n', idx) + 1;
  const e = body.indexOf('\n', idx);
  return body.slice(s, e === -1 ? body.length : e);
}

/**
 * What the attempt lacks: `['cache-read', 'time']` or an empty list. A legitimate zero - the node worked inside the
 * shared session, there was no separate call: "0 tokens, 0 s" is complete by itself (§3; the same exception - in the
 * `agent-id` check). An unknown, written as a fact (ECONOMY.md, "The `unknown` marker"): "(cache-read unknown)" in the
 * place of "(R cache-read)" - the line is complete. The marker is searched in the line itself, not by the parse group:
 * the cache parenthesis of the regex carries non-breaking digit spaces.
 */
function lacksOf(m, body) {
  if (Number(String(m[3]).replace(/[\s\u00A0\u202F]/g, '')) === 0) return [];
  const lacks = [];
  if (!m[4] && !CACHE_UNKNOWN_RE.test(lineAt(body, m.index))) lacks.push(i18n.message('board.attempt-format.lack_cache', null, 'ru'));
  if (!m[5]) lacks.push(i18n.message('board.attempt-format.lack_time', null, 'ru'));
  return lacks;
}

function run({ root, since }) {
  const RE = ATTEMPT_FORMAT_RE;
  const missing = [];
  for (const file of cardFiles(root)) {
    const f = path.basename(file);
    const body = fs.readFileSync(file, 'utf8').split(/\r?\n/).map(toEnglish).join('\n');
    RE.lastIndex = 0;
    let m;
    while ((m = RE.exec(body)) !== null) {
      if (m[2] < since) continue;
      const lacks = lacksOf(m, body);
      if (lacks.length) missing.push(`${f}: ${m[1]} ${m[2]} — ${i18n.message('board.attempt-format.lacks', { lacks: lacks.join(' ' + i18n.message('board.attempt-format.and', null, 'ru') + ' ') }, 'ru')}`);
    }
  }
  if (!missing.length) return [];
  // One line with the list, not a line per attempt: the check names the problem, it does not flood the output.
  return [i18n.message('board.attempt-format.header', { n: missing.length, since }, 'ru') + bulletList(missing)];
}

module.exports = { id: 'attempt-format', since: 'attempt-format', run };
