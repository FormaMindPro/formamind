#!/usr/bin/env node
'use strict';

/**
 * card-subagent-spend.cjs - a §3 spend line of a subagent call into the card, one command
 * after the return (a background call - earlier is fine too, while it is alive: with some
 * engines the transcript exists only while the call lives).
 *
 * The mechanism is the caller's command, not a hook: with engines without a proven hook package
 * there is no writer; the caller's hand leaves the loop of collecting the numbers but not the
 * loop of the command. The sums are canonical, from the call's transcript through
 * `subagent-spend.cjs` (spendOf: engine adapters, dedup by requestId); N = Σ in+write+read+out.
 * No transcript - the unknown markers with a reason, never zero: the file may have been deleted
 * when the call ended; that is the norm, not a read failure.
 *
 *   node .claude/scripts/card-subagent-spend.cjs <NNN|card path> <agent_id> [--node Run] [--engine <tag>] [--write] [--desc "..."]
 *
 * Prints a §3-format line; without --write - print only, with --write - appends to the end of the
 * card's ## History zone (CLAUDE_SPEND_ROOT - the project root, by default where the script sits).
 * A re-run with the same call id - "already recorded", exit 0 (idempotency).
 * The transcript is not found - `--engine <the calling engine's tag>` is required: the tag of the
 * line; a found transcript carries its owner's tag itself, and an absent one has no source for it.
 *
 * Exit: 0 - a line exists or existed already; 1 - the card has no History zone; 2 - the card or the arguments.
 */

const fs = require('fs');
const path = require('path');
const { spendOf } = require('./subagent-spend.cjs');
const { formatSpendLine, CLAIM_LINE_RE } = require('../../.forma/dashboard/spend-line.cjs');
const { NO_TRANSCRIPT } = require('../../.forma/dashboard/subagent-transcript.cjs');
const { cardFiles, HISTORY_HEADING_RE } = require('../../.forma/dashboard/lib/card.cjs');
// Printed and written labels come from the core dictionary: English key in code, ru value as data.
const i18n = require('../../.forma/i18n/index.cjs');
const msg = (code, params) => i18n.message(code, params, 'ru');

const root = process.env.CLAUDE_SPEND_ROOT || path.resolve(__dirname, '..', '..');

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? String(argv[i + 1] || '') : null;
};
// Positional: everything that is not a flag and not the value of a named flag.
const named = ['node', 'engine', 'desc'];
const positional = argv.filter((a, i) => {
  if (a.startsWith('--')) return false;
  const prev = argv[i - 1];
  return !(prev && prev.startsWith('--') && named.includes(prev.slice(2)));
});

const ref = positional[0];
const agentId = positional[1];
const NODE = flag('node') || 'Run';
const ENGINE = flag('engine');
const DESC = flag('desc');
const WRITE = argv.includes('--write');

if (!ref || !agentId || !/^[A-Za-z0-9_-]+$/.test(agentId)) {
  console.error(msg('spend.card-subagent.usage'));
  process.exit(2);
}

/** The card by number (the card-NNN- prefix) or by a direct path; none - null. */
function resolveCard(r) {
  if (/^\d{1,4}$/.test(r)) {
    const num = r.padStart(3, '0');
    return cardFiles(root, (name) => name.startsWith(`card-${num}-`))[0] || null;
  }
  const abs = path.resolve(r);
  return fs.existsSync(abs) ? abs : null;
}

/** Appends the line to the end of the History zone (before the next zone), keeping the line endings. */
function appendToHistory(card, text, line) {
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  const rows = text.split(/\r?\n/);
  const h = rows.findIndex((row) => HISTORY_HEADING_RE.test(row));
  if (h < 0) { console.error(msg('spend.card-subagent.no_history')); process.exit(1); }
  let end = rows.findIndex((row, i) => i > h && /^## /.test(row));
  if (end < 0) end = rows.length;
  while (end > h + 1 && !rows[end - 1].trim()) end--;
  rows.splice(end, 0, line);
  fs.writeFileSync(card, rows.join(nl));
  console.log(msg('spend.card-subagent.written', { file: path.relative(root, card) }));
}

(async () => {
  const card = resolveCard(ref);
  if (!card) { console.error(msg('spend.card-subagent.card_missing', { ref })); process.exit(2); }
  const text = fs.readFileSync(card, 'utf8');

  // Idempotency: a spend line with this call id is in the card already - a second one is not written.
  const seen = text.split(/\r?\n/).some((l) => CLAIM_LINE_RE.test(l) && l.includes('`' + agentId + '`'));
  if (seen) { console.log(msg('spend.card-subagent.already', { id: agentId })); return; }

  const s = await spendOf(agentId);
  const date = new Date().toISOString().slice(0, 10);
  const descSuffix = DESC ? `, ${DESC}` : '';
  let rec;
  if (s) {
    rec = {
      node: NODE, date,
      tokens: s.tokens_n, cache_read: s.cache_read, tokens_out: s.tokens_out, duration_s: s.duration_s,
      call_id: String(agentId), engine: s.engine,
      desc: msg('spend.card-subagent.desc_live', { steps: s.steps, desc: descSuffix }),
    };
  } else {
    if (!ENGINE) {
      console.error(msg('spend.card-subagent.need_engine', { no_transcript: NO_TRANSCRIPT }));
      process.exit(2);
    }
    rec = {
      node: NODE, date,
      tokens: null, cache_read: null, tokens_out: null, duration_s: null,
      call_id: String(agentId), engine: ENGINE,
      desc: msg('spend.card-subagent.desc_unknown', { no_transcript: NO_TRANSCRIPT, desc: descSuffix }),
    };
  }

  const line = '- ' + formatSpendLine(rec);
  console.log(line);
  if (WRITE) appendToHistory(card, text, line);
})();
