#!/usr/bin/env node
'use strict';

/**
 * The automatic spend recording of a Claude Code subagent call: the `SubagentStop` hook -> ledger -> a line into the card.
 * The contract - .forma/manual/en/03-protocol/ECONOMY.md, "Automatic recording (adapter duty)".
 *
 * The input is the hook's JSON on stdin (expected: agent_id, agent_type, agent_transcript_path, session_id, cwd; fields are not guaranteed).
 * 1. Reads the call transcript (the path from the event, else the search by agent_id as in subagent-transcript.cjs):
 *    the steps deduplicate by requestId; N = in + write + read + out; T = from the first to the last record, whole seconds.
 * 2. Appends a record to `.claude/.ledger/calls.jsonl`: { timestamp, conversationId: agent_id, engine: 'claude-code',
 *    node: agent_type, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, duration_s, cards }.
 *    The record's numbers are the transcript's running totals. The record carries `until` - the mark of the last counted
 *    step; the continuation's T (`active_s`, into the card) - the time of the records after it only. A repeated
 *    SubagentStop of the same agent_id (a SendMessage continuation) - a new record with continuation: true; the same totals
 *    without growth - not written.
 * The record carries `first_response_s` - the seconds from the prompt message to the first assistant record (for a
 * continuation - from the continuation message to the first new record); null when it cannot be told.
 * 3. Into the `## History` of every card from cards (the `card-NNN` numbers from the transcript's first user message
 *    (the rule - `cardsIn`)) found on the board or in done/, appends a §3 line through formatSpendLine. K>1 found cards -
 *    N, R, O, T are divided (splitForBatch, a `batch I/K` mark). The card gets the share minus what is counted already
 *    under this call id (a continuation - the delta); a non-continuation with this call id already in the card (written
 *    by hand) - not duplicated.
 * Any error -> exit 0, the reason on stderr and in `.claude/.ledger/errors.log`. The hook never blocks.
 * CLAUDE_LEDGER_DEBUG=1 - the raw input into `.claude/.ledger/raw-last.json`. CLAUDE_LEDGER_ROOT - the project root (tests).
 *
 * A continuation line carries `attempt,` (as the board's parsing requires) and a `continuation` mark in the description
 * after the dash (the ru wording from the dictionary, as before the translation).
 *
 * Run: node .claude/scripts/ledger-recorder.cjs < event.json
 */

const fs = require('fs');
const path = require('path');

const { formatSpendLine, ATTEMPT_FORMAT_RE, outTokens, toInt } = require('../../.forma/dashboard/spend-line.cjs');
const economy = require('../../.forma/dashboard/economy.cjs');
const { findTranscript } = require('../../.forma/dashboard/subagent-transcript.cjs');
const { cardFiles } = require('../../.forma/dashboard/lib/card.cjs');
const i18n = require('../../.forma/i18n/index.cjs');
// Printed and written labels come from the core dictionary: English key in code, ru value as data.
const msg = (code, params) => i18n.message(code, params, 'ru');
const { claudeUsage, splitForBatch, batchShare } = require('./claude-economy.cjs');

const ENGINE_TAG = 'claude-code';
const DEFAULT_ROOT = path.resolve(__dirname, '..', '..');

const NODE_BY_TYPE = { kit: 'Kit', spec: 'Spec', core: 'Core', intent: 'Intent', 'plumb-haiku': 'Plumb', 'plumb-glmflash': 'Plumb' };
/** agent_type -> the node name in a line: kit->Kit, spec->Spec, core->Core, intent->Intent, run*->Run, plumb-haiku and
 *  plumb-glmflash->Plumb (the built-in Plumb executor is named after its engine's small model); anything else - as is. */
function nodeOf(agentType) {
  const t = String(agentType || '').trim();
  if (!t) return 'unknown';
  if (NODE_BY_TYPE[t]) return NODE_BY_TYPE[t];
  if (/^run($|[-_])/i.test(t)) return 'Run';
  return t;
}

function ledgerDir(root) { return path.join(root, '.claude', '.ledger'); }

function logError(root, message) {
  const text = `[ledger-recorder] ${message}`;
  try { process.stderr.write(text + '\n'); } catch {}
  try {
    fs.mkdirSync(ledgerDir(root), { recursive: true });
    fs.appendFileSync(path.join(ledgerDir(root), 'errors.log'), `${new Date().toISOString()} ${text}\n`, 'utf8');
  } catch {}
}

/** The call transcript: steps by requestId, the time by the first and last record, the first user message. */
function readCall(file) {
  const seen = new Set();
  const t = economy.emptyUsage();
  let first = null, last = null, prompt = null, lastStep = null;
  const stamps = [];
  const prompts = [], replies = []; // the stamps of user messages (not tool results) and assistant records
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    const ts = j.timestamp ? Date.parse(j.timestamp) : NaN;
    if (Number.isFinite(ts)) {
      if (j.type === 'assistant') replies.push(ts);
      else if (j.type === 'user' && j.message && j.message.role === 'user') {
        const c = j.message.content;
        const own = typeof c === 'string' ? c.trim() !== ''
          : Array.isArray(c) && c.some((b) => b && b.type === 'text') && !c.some((b) => b && b.type === 'tool_result');
        if (own) prompts.push(ts);
      }
    }
    if (Number.isFinite(ts)) { stamps.push(ts); if (first == null || ts < first) first = ts; if (last == null || ts > last) last = ts; }
    if (prompt == null && j.type === 'user' && j.message && j.message.role === 'user') {
      const c = j.message.content;
      const text = typeof c === 'string' ? c
        : Array.isArray(c) ? c.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n') : '';
      if (text) prompt = text;
    }
    const u = j.message && j.message.usage;
    if (!u || u.cache_read_input_tokens == null) continue;
    const key = j.requestId || j.uuid;
    if (seen.has(key)) continue;
    seen.add(key);
    economy.addUsage(t, claudeUsage(u));
    if (Number.isFinite(ts) && (lastStep == null || ts > lastStep)) lastStep = ts;
  }
  if (!t.calls) return null;
  return {
    steps: t.calls, tokens_in: t.tokens_in, tokens_out: t.tokens_out, cache_read: t.cache_read, cache_write: t.cache_write,
    duration_s: first != null && last != null ? Math.round((last - first) / 1000) : null,
    prompt: prompt || '', stamps, until: lastStep, prompts, replies,
  };
}

/**
 * The delay to the first answer, whole seconds: from the user message to the first assistant record after it.
 * The first call (no `after`) - from the first message (the call's prompt); a continuation - from the first message
 * after the `after` mark (the boundary of the ledger's past record). No message or answer found - null.
 */
function firstResponse(call, after = null) {
  if (!call) return null;
  const from = after == null ? call.prompts[0] : call.prompts.find((x) => x > after);
  if (from == null) return null;
  const reply = call.replies.filter((x) => x >= from).sort((a, b) => a - b)[0];
  return reply == null ? null : Math.round((reply - from) / 1000);
}

function readLedger(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

/** Already counted in the card by call id: Σ N, R, O, T over the spend lines with this id. */
function accountedInCard(text, callId) {
  const re = new RegExp(ATTEMPT_FORMAT_RE.source, 'g');
  const acc = { tokens: 0, cache: 0, out: 0, seconds: 0, lines: 0 };
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('- ') || !line.includes('`' + callId + '`')) continue;
    re.lastIndex = 0;
    const m = re.exec(line);
    if (!m) continue;
    acc.tokens += toInt(m[3]);
    if (m[4]) acc.cache += toInt(m[4].replace(/[^\d]/g, ''));
    const o = outTokens(line);
    if (o != null) acc.out += o;
    if (m[5]) acc.seconds += toInt(m[5].replace(/[^\d]/g, ''));
    acc.lines += 1;
  }
  return acc;
}

/** The line - to the end of the "History" zone (before the result zone), as card-move.cjs does. */
function insertIntoHistory(text, spendLine) {
  const lines = text.split('\n');
  const head = i18n.headingRe('zone.history', '');
  const i = lines.findIndex((l) => head.test(l.replace(/\r$/, '')));
  if (i < 0) return null;
  let end = lines.findIndex((l, k) => k > i && l.startsWith('## '));
  if (end < 0) end = lines.length;
  let at = end;
  while (at > i + 1 && !lines[at - 1].trim()) at--;
  lines.splice(at, 0, spendLine);
  return lines.join('\n');
}

/**
 * A card served - only the one whose number stands (a) in a "Card: ..." line (the label matched through the
 * i18n dictionary, both languages) or (b) in a file path `.devtool/features/card-NNN-...` / `done/card-NNN-...`
 * of the prompt. Other mentions (`after-card-NNN`, "see card-NNN", "after card-NNN") do not count.
 * None found - [].
 */
function cardsIn(prompt) {
  const set = new Set();
  const text = String(prompt);
  for (const line of text.split(/\r?\n/)) {
    if (!new RegExp('^\\s*(?:' + i18n.alt('hist.card') + ')\\s*:', 'i').test(line)) continue;
    for (const m of line.matchAll(/(?<![\w-])card-(\d{3})(?!\d)/g)) set.add(m[1]);
  }
  for (const m of text.matchAll(/\.devtool[\/]features[\/](?:done[\/])?card-(\d{3})-/g)) set.add(m[1]);
  return [...set].sort();
}

function record(payload, opts = {}) {
  const root = opts.root || process.env.CLAUDE_LEDGER_ROOT || DEFAULT_ROOT;
  const result = { recorded: false, lines: [], skipped: [] };
  const agentId = payload && payload.agent_id ? String(payload.agent_id) : '';
  if (!/^[A-Za-z0-9_-]+$/.test(agentId)) throw new Error(msg('spend.ledger-recorder.bad_agent_id'));

  let file = payload.agent_transcript_path && fs.existsSync(payload.agent_transcript_path) ? payload.agent_transcript_path : null;
  if (!file) { const f = findTranscript(agentId, root, ENGINE_TAG); file = f ? f.file : null; }
  const call = file ? readCall(file) : null;

  const ledgerFile = path.join(ledgerDir(root), 'calls.jsonl');
  const prior = readLedger(ledgerFile).filter((r) => r.conversationId === agentId);
  const continuation = prior.length > 0;
  const cards = call ? cardsIn(call.prompt) : [];
  const nowIso = (opts.now || new Date()).toISOString();
  let meta = {};
  if (file) { try { meta = JSON.parse(fs.readFileSync(file.replace(/\.jsonl$/, '.meta.json'), 'utf8')); } catch {} }
  const agentType = payload.agent_type || meta.agentType || null;
  const node = nodeOf(agentType);

  const rec = {
    timestamp: nowIso, conversationId: agentId, engine: ENGINE_TAG, node: agentType,
    input_tokens: call ? call.tokens_in : null, output_tokens: call ? call.tokens_out : null,
    cache_read_tokens: call ? call.cache_read : null, cache_write_tokens: call ? call.cache_write : null,
    duration_s: call ? call.duration_s : null, cards,
    until: call && call.until != null ? new Date(call.until).toISOString() : null,
    first_response_s: firstResponse(call),
  };
  // A continuation's T - the time of the transcript's new records only (after the `until` boundary of the
  // past record), without the idle time between the stops.
  let activeNew = null;
  if (continuation) {
    rec.continuation = true;
    const p = prior[prior.length - 1];
    const pu = p.until ? Date.parse(p.until) : NaN;
    if (call && Number.isFinite(pu)) {
      const fresh = call.stamps.filter((x) => x > pu);
      activeNew = fresh.length ? Math.round((Math.max(...fresh) - Math.min(...fresh)) / 1000) : 0;
      rec.active_s = activeNew;
    }
    rec.first_response_s = Number.isFinite(pu) ? firstResponse(call, pu) : null;
    const same = ['input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens'].every((k) => p[k] === rec[k]);
    if (same && call) { result.skipped.push(msg('spend.ledger-recorder.no_growth')); return result; }
  }
  fs.mkdirSync(ledgerDir(root), { recursive: true });
  fs.appendFileSync(ledgerFile, JSON.stringify(rec) + '\n', 'utf8');
  result.recorded = true;

  // The cards found on the board or in done/.
  const found = [];
  for (const num of cards) {
    const f = cardFiles(root, (n) => n.startsWith(`card-${num}-`) && n.endsWith('.md'))[0];
    if (f) found.push({ num, file: f });
    else result.skipped.push(msg('spend.ledger-recorder.card_absent', { num }));
  }
  const total = call ? {
    tokens: call.tokens_in + call.cache_write + call.cache_read + call.tokens_out,
    cache_read: call.cache_read, tokens_out: call.tokens_out, duration_s: call.duration_s,
  } : { tokens: null, cache_read: null, tokens_out: null, duration_s: null };
  const K = found.length;
  found.forEach((c, idx) => {
    const share = K > 1 ? splitForBatch(total, K, idx + 1) : total;
    const text = fs.readFileSync(c.file, 'utf8');
    const acc = accountedInCard(text, agentId);
    let { tokens, cache_read: r, tokens_out: o, duration_s: s } = share;
    if (acc.lines) {
      if (!continuation) { result.skipped.push(msg('spend.ledger-recorder.line_exists', { num: c.num })); return; }
      if (tokens == null || tokens - acc.tokens <= 0) { result.skipped.push(msg('spend.ledger-recorder.no_new_spend', { num: c.num })); return; }
      const d = (v, a) => (v == null ? null : Math.max(0, v - a));
      tokens = d(tokens, acc.tokens); r = d(r, acc.cache); o = d(o, acc.out);
      s = activeNew != null ? (K > 1 ? batchShare(activeNew, K, idx + 1) : activeNew) : d(s, acc.seconds);
    }
    const what = (meta.description || '').replace(/\s+/g, ' ').trim();
    const desc = (acc.lines ? msg('spend.ledger-recorder.desc_cont') : '') + msg('spend.ledger-recorder.desc_base')
      + (what ? ` (${what.replace(/—/g, '-')})` : '') + (K > 1 ? ` (batch ${idx + 1}/${K})` : '') + '.'
      + (call ? '' : msg('spend.ledger-recorder.desc_no_call'));
    const line = '- ' + formatSpendLine({
      node, date: nowIso.slice(0, 10), tokens, cache_read: r, tokens_out: o, duration_s: s,
      call_id: agentId, engine: ENGINE_TAG, desc,
    });
    const next = insertIntoHistory(text, line);
    if (next == null) { result.skipped.push(msg('spend.ledger-recorder.no_history', { num: c.num })); return; }
    fs.writeFileSync(c.file, next, 'utf8');
    result.lines.push({ card: c.num, line });
  });
  return result;
}

module.exports = { record, readCall, firstResponse, nodeOf, cardsIn, accountedInCard, insertIntoHistory };

if (require.main === module) {
  const root = process.env.CLAUDE_LEDGER_ROOT || DEFAULT_ROOT;
  try {
    let raw = '';
    try { raw = fs.readFileSync(0, 'utf8'); } catch {}
    if (process.env.CLAUDE_LEDGER_DEBUG === '1') {
      try { fs.mkdirSync(ledgerDir(root), { recursive: true }); fs.writeFileSync(path.join(ledgerDir(root), 'raw-last.json'), raw, 'utf8'); } catch {}
    }
    const payload = JSON.parse(raw);
    const r = record(payload, { root });
    for (const s of r.skipped) process.stderr.write(`[ledger-recorder] ${s}\n`);
  } catch (e) {
    logError(root, e && e.message ? e.message : String(e));
  }
  process.exit(0);
}
