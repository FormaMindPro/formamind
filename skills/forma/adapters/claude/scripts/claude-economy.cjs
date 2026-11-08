#!/usr/bin/env node
'use strict';

/**
 * The Claude Code economy adapter: a transcript / the result of a Claude call -> the canonical record
 * (.forma/manual/en/03-protocol/ECONOMY.md). The "variable -> source" table - `.claude/agents/on-demand/spend-line.md`.
 *
 * The only place where the Claude field names (`input_tokens`, `subagent_tokens`, `duration_ms`...)
 * are translated into the canonical ones. Users: subagent-transcript.cjs, card-session-spend.cjs,
 * session-economy.cjs; the line is assembled by .forma/dashboard/spend-line.cjs (`formatSpendLine`).
 *
 * What the source did not give - `null` (the `unknown` marker), never 0.
 *
 * CLI - the spend line of a subagent call from its `<usage>`:
 *   node .claude/scripts/claude-economy.cjs line --node Run --agent-id <agent_id> \
 *     --tokens <subagent_tokens> --duration-ms <duration_ms> [--tool-uses <tool_uses>] \
 *     [--date YYYY-MM-DD] [--desc "<what was done>"] [--split K --share I] [--write card-NNN]
 *   --write card-NNN - append the line with a "- " prefix to the end of the card's `## History` (as the
 *   SubagentStop hook does); a re-run with the same agent_id on the same card does not duplicate the line
 *   (a note is printed, the file is not changed).
 *   N and R are read from the call's transcript (N = Σ in+write+read+out; `--tokens` is the fallback value);
 *   no transcript - `(cache-read unknown)`, N from `--tokens` with a "context size" note in the description.
 *
 *   --split K --share I (1..K) - one `Spec`/`Kit` call kits up or slices K cards at once
 *   (a batch, AGENTS.md §3, "Any reach to a subagent is tied to a card"): the call's spend is divided
 *   over K cards, not attributed to each whole and not counted on it in full (that would be double
 *   counting when the board sums the lines). The share is integral, without a remainder: N (and R, and T)
 *   are divided by K, the first (N mod K) cards get 1 more - the sum of the shares over all K cards
 *   equals the original N/R/T without approximation. The agent_id of all K lines is the same (it is one
 *   call, not K); `tally.cjs` does not collapse them into a duplicate, because every line's numbers are
 *   its own - the dedup by [id, tokens, cache, seconds] diverges. The description gets a `batch I/K` mark.
 */

const { formatSpendLine } = require('../../.forma/dashboard/spend-line.cjs');
const { makeCli } = require('../../.forma/dashboard/lib/cli.cjs');
// Printed and written labels come from the core dictionary: English key in code, ru value as data.
const i18n = require('../../.forma/i18n/index.cjs');
const msg = (code, params) => i18n.message(code, params, 'ru');

const has = (o, k) => o != null && o[k] != null && Number.isFinite(Number(o[k]));
const pick = (o, k) => (has(o, k) ? Number(o[k]) : null);

/** One transcript step: Claude's `message.usage` -> tokens_in, tokens_out, cache_read, cache_write. */
function claudeUsage(u) {
  return {
    tokens_in: pick(u, 'input_tokens'),
    tokens_out: pick(u, 'output_tokens'),
    cache_read: pick(u, 'cache_read_input_tokens'),
    cache_write: pick(u, 'cache_creation_input_tokens'),
  };
}

/**
 * The result of an Agent call (+ a transcript, if any) -> the canonical card-line record.
 * @param usage { agent_id, subagent_tokens|tokens, tool_uses, duration_ms }
 * @param transcript the result of readSubagentTranscript or null
 */
function fromAgentResult(usage, transcript) {
  const u = usage || {};
  const ms = pick(u, 'duration_ms');
  const t = transcript || null;
  // `subagent_tokens` from `<usage>` - the context size at the last step, not the spend (measured
  // against transcripts: it matches them, and diverges from Σ by 10-40x). N by the contract is
  // Σ in+write+read+out over the steps; only a transcript yields it; without one the context from `<usage>` remains.
  const sum = t ? [t.input, t.cacheCreate, t.cacheRead, t.output] : null;
  const fromTranscript = sum && sum.every((x) => x != null && Number.isFinite(Number(x)));
  const tokens = fromTranscript ? sum.reduce((a, x) => a + Number(x), 0)
    : (pick(u, 'subagent_tokens') ?? pick(u, 'tokens'));
  return {
    tokens,
    tokens_basis: fromTranscript ? 'sum' : (tokens == null ? null : 'context'),
    cache_read: t ? t.cacheRead : null,
    // Not in `<usage>` - only from a transcript.
    cache_write: t ? t.cacheCreate : null,
    tokens_in: t ? t.input : null,
    tokens_out: t ? t.output : null,
    duration_s: ms == null ? null : Math.round(ms / 1000),
    call_id: u.agent_id ? String(u.agent_id) : null,
    tool_uses: pick(u, 'tool_uses'),
    // The witness of the sums' source: the transcript's steps and its owner engine (null - there was no transcript).
    steps: t ? (t.steps == null ? null : t.steps) : null,
    transcript_tag: t ? (t.tag || null) : null,
  };
}

/**
 * The share of card I (1..K) of the `total`, as an integer, without a remainder:
 * the first (total mod K) shares are 1 larger than the rest - the sum of all K shares equals `total`.
 * `null`/`undefined` (unknown) stays as it is - there is nothing to divide, the share is unknown too.
 */
function batchShare(total, k, i) {
  if (total == null) return total;
  const base = Math.floor(total / k);
  const extra = total % k;
  return base + (i <= extra ? 1 : 0);
}

/** A call record -> the record of one of the K cards of a batch (the economy fields divide, call_id shared). */
function splitForBatch(rec, k, i) {
  return {
    ...rec,
    tokens: batchShare(rec.tokens, k, i),
    cache_read: batchShare(rec.cache_read, k, i),
    cache_write: batchShare(rec.cache_write, k, i),
    tokens_in: batchShare(rec.tokens_in, k, i),
    tokens_out: batchShare(rec.tokens_out, k, i),
    duration_s: batchShare(rec.duration_s, k, i),
  };
}

// ───────── the main-session log (`Intent`) - the layout and format are the adapter's knowledge ─────────

const fs = require('fs');
const path = require('path');
const { transcriptsDir } = require('./dashboard-view.cjs');

/**
 * The main-session logs of this project: `~/.claude/projects/<slug>/*.jsonl` - one record per file,
 * `{ id, file }` (id - the file name without .jsonl). The layout rule - `dashboard-view.transcriptsDir`
 * (the slug encoding and the case fallback); `CLAUDE_SPEND_PROJECTS` overrides the directory (a trial
 * on synthetic data). No directory - an empty list: no logs, which is not zero.
 */
function mainSessions(root = process.cwd()) {
  const dir = process.env.CLAUDE_SPEND_PROJECTS || transcriptsDir(root);
  if (!dir || !fs.existsSync(dir)) return [];
  let files = [];
  try { files = fs.readdirSync(dir); } catch { return []; }
  return files.filter((f) => f.endsWith('.jsonl')).map((f) => ({ id: f.slice(0, -6), file: path.join(dir, f) }));
}

/**
 * One record of a Claude main-session log -> a normalized step
 * `{ ts, key, usage, toolCalls, human, model }`:
 *   ts - the record's time; key - message.id (one API answer is written by several records, the spend
 *   counts by the first); usage - `message.usage` (parsed by claudeUsage); toolCalls - the tool_use blocks;
 *   human - a human remark (user, not isMeta, with text); model - the answer's model.
 *   isSidechain (subagent branches - the caller writes their spend from `<usage>`) and records without
 *   a time - null: not a record. `prev` - the previous line of the log; the claude format does not need it,
 *   the signature is shared with the other engines' adapters.
 */
function mainStepOf(line) {
  if (!line || line.isSidechain || !line.timestamp) return null;
  const message = line.message || {};
  const assistant = line.type === 'assistant';
  const content = assistant && Array.isArray(message.content) ? message.content : [];
  const human = line.type === 'user' && !line.isMeta &&
    (typeof message.content === 'string' || (Array.isArray(message.content) && message.content.some((c) => c.type === 'text')));
  return {
    ts: line.timestamp,
    key: assistant && message.id ? message.id : null,
    usage: assistant && message.usage ? message.usage : null,
    toolCalls: content.filter((c) => c && c.type === 'tool_use'),
    human,
    model: (assistant && message.model) || null,
  };
}

module.exports = { claudeUsage, fromAgentResult, batchShare, splitForBatch, mainSessions, mainStepOf };

// ---- CLI ----
if (require.main === module) {
  const argv = process.argv.slice(2);
  const arg = makeCli(argv).value;
  if (argv[0] !== 'line' || !arg('node')) {
    console.error('usage: node .claude/scripts/claude-economy.cjs line --node <Node> --agent-id <id> --tokens <N> --duration-ms <ms> [--tool-uses <n>] [--date YYYY-MM-DD] [--desc "..."] [--split K --share I] [--write card-NNN]');
    process.exit(2);
  }
  const { readSubagentTranscript, NO_TRANSCRIPT } = require('../../.forma/dashboard/subagent-transcript.cjs');
  (async () => {
    const id = arg('agent-id');
    // The transcript is sought across ALL engine adapters: the file belongs to the engine that executed
    // the call, and with some engines it is temporary - alive while the call lives. The line's tag is set
    // by the caller, as before.
    const tr = id ? await readSubagentTranscript(id, undefined, null) : null;
    let rec = fromAgentResult({ agent_id: id, tokens: arg('tokens'), duration_ms: arg('duration-ms'), tool_uses: arg('tool-uses') }, tr);
    const k = arg('split'), i = arg('share');
    let batchNote = '';
    if (k != null) {
      if (i == null) { console.error(msg('spend.claude-economy.split_needs_share')); process.exit(2); }
      rec = splitForBatch(rec, Number(k), Number(i));
      batchNote = ` (batch ${i}/${k})`;
    }
    const why = [];
    if (rec.cache_read == null) why.push(msg('spend.claude-economy.r_unknown', { no_transcript: NO_TRANSCRIPT }));
    if (rec.tokens == null) why.push(msg('spend.claude-economy.n_missing'));
    else if (rec.tokens_basis === 'context') why.push(msg('spend.claude-economy.n_context'));
    if (rec.duration_s == null) why.push(msg('spend.claude-economy.t_missing'));
    if (rec.call_id == null) why.push(msg('spend.claude-economy.id_missing'));
    // The mark of a distinguishable source: the sums were taken from the live call's transcript, not from <usage>.
    const marks = [];
    if (rec.tokens_basis === 'sum') {
      const parts = ['N'];
      if (rec.cache_read != null) parts.push('R');
      if (rec.tokens_out != null) parts.push('out');
      marks.push(msg('spend.claude-economy.live_sums', { fields: parts.join(', '), steps: rec.steps == null ? '?' : rec.steps }));
    }
    const desc = (arg('desc') || msg('spend.claude-economy.default_desc')) + batchNote
      + (why.length ? ` (${why.join('; ')}.)` : '')
      + (marks.length ? ` (${marks.join('; ')}).` : '');
    const line = formatSpendLine({
      node: arg('node'),
      date: arg('date') || new Date().toISOString().slice(0, 10),
      engine: 'claude-code',
      desc,
      ...rec,
    });
    const target = arg('write');
    if (!target) { console.log(line); return; }
    const fs = require('fs');
    const path = require('path');
    const { accountedInCard, insertIntoHistory } = require('./ledger-recorder.cjs');
    const code = /card-\d{3}/.exec(String(target));
    const features = path.join(__dirname, '..', '..', '.devtool', 'features');
    const file = code && [features, path.join(features, 'done')].flatMap((d) => (fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.startsWith(code[0] + '-') && f.endsWith('.md')).map((f) => path.join(d, f)) : []))[0];
    if (!file) { console.error('--write: card not found: ' + target); process.exit(2); }
    const text = fs.readFileSync(file, 'utf8');
    const bullet = '- ' + line;
    const dup = id ? accountedInCard(text, id).lines > 0 : text.split(String.fromCharCode(10)).map((l) => l.trimEnd()).includes(bullet);
    if (dup) { console.error('already recorded for ' + code[0] + (id ? ' (' + id + ')' : '') + ': not duplicated'); return; }
    const next = insertIntoHistory(text, bullet);
    if (next == null) { console.error('--write: no History zone in ' + path.basename(file)); process.exit(2); }
    fs.writeFileSync(file, next, 'utf8');
    console.log(bullet);
  })();
}
