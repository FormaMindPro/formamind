'use strict';

// Parity of the call journal and the task cards - in both directions.
// For every adapter with a `<dir>/.ledger/calls.jsonl` file (adapters - from loadAdapters):
//   journal → card: a call not older than `since` (conversationId without `unknown`) whose id is absent from any
//     spend line of the cards - a finding;
//   card → journal: a spend line with this adapter's engine tag, with a call id (not `id unknown`, not a line of
//     the main `card-session-spend` session), dated no earlier than `since` and strictly later than the first day
//     of this adapter's journal (the lines of the journal-install day partly precede the hook, and the line carries
//     only a date - there is nothing to reconcile against):
//     • the id is in the journal - the numbers are reconciled. A mismatch of the per-card sums against the journal's
//       running totals (N, cache-read, out) - a finding; seconds are not reconciled: the journal and the line have
//       different T bases (the transcript against the call's duration_ms), continuations and batches give allowed deviations;
//     • the id is not in the journal - an info note in `ctx.info` ("the journal does not cover"), not a violation: lines
//       are written by hand as well as by an engine without the hook, and the absence of a journal record does not prove
//       wrong numbers. The journal exists but is empty - the same note (silence would be a false "ok", and it must not be red).
// No journal file - the adapter is not reconciled. The engine is determined by the `spendTag` label after the dash.
// `extraRows` - `[{ file, line }]`, spend lines not yet on the board (the early check of a card handoff before the
// file is written, card-move.cjs): parsed on a par with the read ones.

const fs = require('fs');
const path = require('path');
const i18n = require('../../i18n/index.cjs');
const { cardLines, bulletList } = require('./support/lines.cjs');
const { toEnglish, SPEND_SOURCE, outTokens, toInt } = require('../../dashboard/spend-line.cjs');
const { loadAdapters } = require('../../dashboard/lib/engines.cjs');

const LINE_DATE_RE = /(\d{4}-\d{2}-\d{2}):\s*attempt,/;
const LINE_ID_RE = /,\s*`([^`\s]+)`\s*—/;
const LINE_TAG_RE = /—\s*([a-z][a-z0-9-]*):/;
const SPEND_ROW_RE = new RegExp(SPEND_SOURCE); // SPEND_SOURCE - the segment template of a spend line

/** Calls of an adapter's journal; `null` - no file, `[]` - the file exists but is empty. */
function readLedger(root, adapter) {
  const ledgerPath = path.join(root, adapter.dir, '.ledger', 'calls.jsonl');
  if (!fs.existsSync(ledgerPath)) return null;
  const calls = [];
  let text = '';
  try { text = fs.readFileSync(ledgerPath, 'utf8'); } catch { return null; }
  for (const rl of text.split(/\r?\n/).filter(Boolean)) {
    try {
      const item = JSON.parse(rl);
      if (item.conversationId && !String(item.conversationId).includes('unknown')) calls.push(item);
    } catch {}
  }
  return calls;
}

/** A spend line → `{ file, date, id, tag, session, tokens, cache, out }`; no numbers - `null` (not zero). */
function spendRow(file, line) {
  const t = toEnglish(line.trim());
  const d = LINE_DATE_RE.exec(t);
  if (!d || !/^-\s/.test(t)) return null;
  const idm = LINE_ID_RE.exec(t);
  const id = idm && !idm[1].includes('unknown') ? idm[1].trim() : null;
  const tag = LINE_TAG_RE.exec(t);
  const m = SPEND_ROW_RE.exec(t);
  return {
    file, date: d[1], id, tag: tag ? tag[1] : null,
    session: /card-session-spend/.test(t),
    tokens: m && m[3] && m[3] !== 'unknown' ? toInt(m[3]) : null,
    cache: m && m[4] != null ? toInt(m[4]) : null,
    out: outTokens(t),
  };
}

/** Spend lines of the cards: `{ file, date, id, tag, session, tokens, cache, out }`. */
function spendRows(root, extraRows) {
  const rows = [];
  for (const { file, line } of cardLines(root)) {
    const r = spendRow(file, line);
    if (r) rows.push(r);
  }
  for (const { file, line } of Array.isArray(extraRows) ? extraRows : []) {
    const r = spendRow(file, line);
    if (r) rows.push(r);
  }
  return rows;
}

function run({ root, since, info, extraRows }) {
  const problems = [];
  const notes = Array.isArray(info) ? info : null; // the "journal does not cover" note - not a violation; no sink - silence
  const rows = spendRows(root, extraRows);
  const cardCallIds = new Set(rows.filter((r) => r.id).map((r) => r.id));

  const ledgers = [];
  for (const a of loadAdapters(root)) {
    const calls = readLedger(root, a);
    if (calls) ledgers.push({ adapter: a, calls });
  }

  // journal → card
  const orphanCalls = [];
  for (const { calls } of ledgers) {
    for (const call of calls) {
      const callDate = (call.timestamp || '').slice(0, 10);
      if (since && callDate < since) continue;
      if (!cardCallIds.has(call.conversationId)) {
        orphanCalls.push(i18n.message('board.ledger-parity.orphan_call', { id: call.conversationId, date: callDate }, 'ru'));
      }
    }
  }
  if (orphanCalls.length > 0) {
    problems.push(i18n.message('board.ledger-parity.orphan_header', { n: orphanCalls.length }, 'ru') + bulletList(orphanCalls));
  }

  // card → journal
  const uncovered = []; // "the journal does not cover" - a note
  const mismatch = [];  // a numeric mismatch - a violation
  for (const { adapter, calls } of ledgers) {
    const tag = adapter.spendTag || adapter.tag || adapter.engine;
    const first = calls.map((c) => (c.timestamp || '').slice(0, 10)).filter(Boolean).sort()[0];
    const inWindow = rows.filter((r) => r.tag === tag && !r.session && r.id && (!since || r.date >= since));
    if (!calls.length) {
      if (inWindow.length && notes) notes.push(i18n.message('board.ledger-parity.empty_journal', { dir: adapter.dir, n: inWindow.length, tag }, 'ru'));
      continue;
    }
    // Running totals of the journal: the last record per id (continuations repeat the totals cumulatively).
    const totals = new Map();
    for (const c of calls) {
      const known = [c.input_tokens, c.output_tokens, c.cache_read_tokens, c.cache_write_tokens].every((x) => x == null || Number.isFinite(Number(x)));
      if (!known) continue;
      totals.set(c.conversationId, {
        tokens: [c.input_tokens, c.output_tokens, c.cache_read_tokens, c.cache_write_tokens].every((x) => x == null) ? null
          : [c.input_tokens, c.output_tokens, c.cache_read_tokens, c.cache_write_tokens].reduce((a, x) => a + (Number(x) || 0), 0),
        cache: c.cache_read_tokens, out: c.output_tokens,
      });
    }
    // Per-card sums: batches (fractions) and continuations (deltas) summed over all lines of an id give the journal's total.
    const sums = new Map();
    for (const r of inWindow) {
      if (first && r.date <= first) continue;
      if (!totals.has(r.id)) {
        uncovered.push(i18n.message('board.ledger-parity.uncovered_row', { file: r.file, date: r.date, id: r.id, dir: adapter.dir }, 'ru'));
        continue;
      }
      if (r.tokens == null) continue; // "unknown tokens" - nothing to reconcile, this is not zero
      const s = sums.get(r.id) || { tokens: 0, cache: 0, out: 0, cacheKnown: true, outKnown: true, files: new Set() };
      s.tokens += r.tokens;
      if (r.cache != null) s.cache += r.cache; else s.cacheKnown = false;
      if (r.out != null) s.out += r.out; else s.outKnown = false;
      s.files.add(r.file);
      sums.set(r.id, s);
    }
    for (const [id, s] of sums) {
      const t = totals.get(id);
      const parts = [];
      if (t.tokens != null && t.tokens !== s.tokens) parts.push(i18n.message('board.ledger-parity.diff_tokens', { s: s.tokens, t: t.tokens }, 'ru'));
      if (t.cache != null && s.cacheKnown && t.cache !== s.cache) parts.push(i18n.message('board.ledger-parity.diff_cache', { s: s.cache, t: t.cache }, 'ru'));
      if (t.out != null && s.outKnown && t.out !== s.out) parts.push(i18n.message('board.ledger-parity.diff_out', { s: s.out, t: t.out }, 'ru'));
      if (parts.length) mismatch.push({ id, parts, files: [...s.files] });
    }
  }
  if (uncovered.length && notes) notes.push(i18n.message(uncovered.length === 1 ? 'board.ledger-parity.uncovered_note_one' : 'board.ledger-parity.uncovered_note_many', { n: uncovered.length }, 'ru') + bulletList(uncovered));
  if (mismatch.length > 0) {
    problems.push(i18n.message('board.ledger-parity.mismatch_header', { n: mismatch.length }, 'ru')
      + bulletList(mismatch.map(({ id, parts, files }) => i18n.message('board.ledger-parity.mismatch_row', { id, parts: parts.join('; '), files: files.join(', ') }, 'ru'))));
  }

  return problems;
}

module.exports = { id: 'ledger-parity', since: 'ledger-parity', run };
