'use strict';

/**
 * The call ledger of the MiniMax engine: the raw fact is the only source of a spend line (§3).
 *
 * Contract 5, honestly: the LINE is derived, not written by hand, - `deriveSpendLineForCall` turns a
 * ledger record into a line through the shared formatter `.forma/dashboard/spend-line.cjs`.
 * The core reconciles the ledger with the card by the check `.forma/board/checks/ledger-parity.cjs` -
 * it finds the ledger by the convention: `<the adapter's directory>/.ledger/calls.jsonl`; for my zone
 * that is `.minimax/.ledger/calls.jsonl`.
 *
 * The WRITE is platform-side: the plugin package's hook (`SubagentStop`) writes it, and the numbers
 * are taken from the runtime's session transcript, where they are real. Before the package appeared,
 * the node itself wrote the record with the `--append` command - then the core's check compared the
 * node's word with the node's word. What that changes - in the zone's §8, contract 5.
 *
 * While the platform does not write the record, only what the node actually read from the call's
 * return is put into it; the unread stays `unknown`, not zero and not a guess.
 *
 * The ledger record format (shared with the Gemini mirror):
 *   { "timestamp": "2000-01-02T10:00:00.000Z", "conversationId": "…",
 *     "input_tokens": 1200, "output_tokens": 300, "cache_read_tokens": 450, "duration_s": 5 }
 *
 * Run:
 *   node .minimax/scripts/sync-ledger.cjs --append '<json record>'
 *   node .minimax/scripts/sync-ledger.cjs --derive  '<json record>' 'Spec' 'description'
 *   node .minimax/scripts/sync-ledger.cjs --derive-all 'description'
 *   node .minimax/scripts/sync-ledger.cjs --backfill
 *   node .minimax/scripts/sync-ledger.cjs --list
 */

const fs = require('fs');
const path = require('path');
const { formatSpendLine, ATTEMPT_FORMAT_RE, toInt } = require('../../.forma/dashboard/spend-line.cjs');
// Printed and written labels come from the core dictionary: English key in code, ru value as data.
const i18n = require('../../.forma/i18n/index.cjs');
const msg = (code, params) => i18n.message(code, params, 'ru');

const ROOT = path.resolve(__dirname, '..', '..');
const LEDGER = path.join(ROOT, '.minimax', '.ledger', 'calls.jsonl');
const ENGINE_TAG = 'minimax';

/** The card file on the board by number. */
function cardFile(num) {
  for (const dir of [path.join(ROOT, '.devtool', 'features'), path.join(ROOT, '.devtool', 'features', 'done')]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith(`card-${num}-`) && f.endsWith('.md')) return path.join(dir, f);
    }
  }
  return null;
}

/**
 * Already recorded in the card under this call: the sum of N, R and O over the lines with its id.
 * The call may continue (Contract 4): then the full transcript is larger than the snapshot, and the
 * new line must carry only the DELTA - else the card would count the same spend twice.
 */
function accountedInCard(file, callId) {
  if (!file || !fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  const re = new RegExp(ATTEMPT_FORMAT_RE.source, 'g');
  let tokens = 0;
  let cache = 0;
  let out = 0;
  let lines = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes('`' + callId + '`')) continue;
    re.lastIndex = 0;
    const m = re.exec(line);
    if (!m) continue;
    tokens += toInt(m[3]);
    if (m[4]) cache += toInt(m[4].replace(/[^\d]/g, ''));
    if (m[5]) out += toInt(m[5].replace(/[^\d]/g, ''));
    lines += 1;
  }
  return lines ? { tokens, cache, out, lines } : null;
}

function readLedger(file = LEDGER) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function appendCall(rec, file = LEDGER) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(rec) + '\n', 'utf8');
  return rec;
}

/**
 * A ledger record -> a §3 spend line. The numbers come from the call; the unknown stays the `unknown`
 * marker (not zero) - the shared core's formatter is built that way.
 *
 * The ECONOMY.md canon: N - the full spend of a call, INCLUDING the cache-read:
 *   N = tokens_in + cache_write + cache_read + tokens_out, and the work = N − R.
 * The core reads N without the cache as "N recorded without the cache" and adds R - but only when R > N.
 * At R ≤ N the total would be understated, and the "work" (N − R) counted wrongly.
 *
 * THE LEDGER RECORD is a snapshot at the moment of `SubagentStop`: the call's transcript is appended
 * after the stop, and the ledger record stays what the hook saw. So the spend line takes the numbers
 * from the FULL transcript of the call, not from the snapshot: that is what the whole call costs.
 * Old ledger records and card lines are not rewritten (prohibition 5) - the "snapshot against full"
 * divergence is checked by a test as a property, not as an error.
 */
function fullUsage(rec) {
  const id = rec.conversationId || rec.call_id;
  if (!id) return null;
  try {
    const reader = require(path.join(ROOT, 'miniapps', 'minimax-engine', 'scripts', 'transcripts.cjs'));
    const u = reader.readUsage(id);
    if (!u || !Number.isFinite(u.input)) return null;
    return {
      input_tokens: u.input,
      output_tokens: u.output,
      cache_read_tokens: u.cache_read,
      cache_write_tokens: u.cache_write,
      model: u.model,
      note: msg('spend.minimax-sync.full_note'),
    };
  } catch {
    return null;
  }
}

function deriveSpendLineForCall(rec, node, desc, options = {}) {
  const date = String(rec.timestamp || rec.date || '').slice(0, 10);
  const full = fullUsage(rec);
  const src = full || rec;
  const input = Number.isFinite(src.input_tokens) ? src.input_tokens : null;
  const output = Number.isFinite(src.output_tokens) ? src.output_tokens : null;
  const cacheRead = Number.isFinite(src.cache_read_tokens) ? src.cache_read_tokens : null;
  const cacheWrite = Number.isFinite(src.cache_write_tokens) ? src.cache_write_tokens : null;
  const parts = [input, output, cacheRead, cacheWrite];
  const tokens = parts.every((v) => v !== null) ? parts.reduce((s, v) => s + v, 0) : null;
  const duration = Number.isFinite(rec.duration_s) ? rec.duration_s : null;
  let n = tokens;
  let r = cacheRead;
  let o = output;
  if (options.accounted) {
    // The call continued: the line carries only the delta against what the card has recorded already.
    n = tokens == null ? null : Math.max(0, tokens - options.accounted.tokens);
    r = cacheRead == null ? null : Math.max(0, cacheRead - options.accounted.cache);
    o = output == null ? null : Math.max(0, output - options.accounted.out);
    if (!n && !r && !o) return null; // no new spend
  }
  return formatSpendLine({
    node,
    date,
    tokens: n,
    cache_read: r,
    tokens_out: o,
    duration_s: duration,
    call_id: rec.conversationId || rec.call_id || null,
    engine: ENGINE_TAG,
    desc: desc || '',
  });
}

function main() {
  const argv = process.argv.slice(2);
  const opt = (name) => {
    const i = argv.indexOf('--' + name);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
  };
  if (argv[0] === '--append') {
    const rec = JSON.parse(argv[1]);
    appendCall(rec);
    console.log(msg('spend.minimax-sync.appended', { record: JSON.stringify(rec) }));
    return;
  }
  if (argv[0] === '--derive') {
    const rec = JSON.parse(argv[1]);
    const options = {};
    const cardNum = opt('card');
    if (cardNum) {
      const acc = accountedInCard(cardFile(cardNum), rec.conversationId);
      if (acc) options.accounted = acc;
    }
    const line = deriveSpendLineForCall(rec, argv[2] || 'Run', argv[3] || '', options);
    console.log(line || msg('spend.minimax-sync.no_new'));
    return;
  }
  if (argv[0] === '--derive-record') {
    // The record is taken from the ledger by the call id - without passing the JSON through the command line.
    const id = argv[1];
    const rec = readLedger().find((r) => r.conversationId === id);
    if (!rec) {
      console.log(msg('spend.minimax-sync.no_such_id'));
      return;
    }
    const options = {};
    const cardNum = opt('card');
    if (cardNum) {
      const acc = accountedInCard(cardFile(cardNum), rec.conversationId);
      if (acc) options.accounted = acc;
    }
    const line = deriveSpendLineForCall(rec, argv[2] || rec.node || 'Run', argv[3] || '', options);
    console.log(line || msg('spend.minimax-sync.no_new'));
    return;
  }
  if (argv[0] === '--derive-all') {
    // Spend lines over the whole ledger: the platform records without a manual JSON typing.
    for (const rec of readLedger()) {
      console.log(deriveSpendLineForCall(rec, rec.node || 'Run', argv[1] || ''));
    }
    return;
  }
  if (argv[0] === '--backfill') {
    // Fill in the numbers of the records where they are unknown. The source is the runtime's session
    // transcript, the same one the hook reads: nothing is invented, only what the platform has already
    // counted is put in. A normalized transcript is written along the way - the dashboard reads it
    // (the window half and the slices by models).
    const reader = require(path.join(ROOT, 'miniapps', 'minimax-engine', 'scripts', 'transcripts.cjs'));
    const transcriptsDir = path.join(ROOT, '.minimax', '.transcripts');
    const recs = readLedger();
    let filled = 0;
    let written = 0;
    for (const rec of recs) {
      const steps = reader.readSteps(rec.conversationId);
      if (steps.length) {
        const lines = reader.normalizedLines(steps);
        if (lines) {
          fs.mkdirSync(transcriptsDir, { recursive: true });
          const call = String(rec.conversationId).replace(/[^\w.-]/g, '_');
          fs.writeFileSync(path.join(transcriptsDir, call + '.jsonl'), lines + '\n', 'utf8');
          // The layout the core reads (`card-move.cjs --agent-id` -> `readTranscript`):
          // <the transcripts directory>/<the call>/subagents/agent-<the call>.jsonl. The deduplication
          // key - `requestId` - per step, else the core, counting one API answer as several lines,
          // would take only the first step of the turn.
          const core = reader.coreLines ? reader.coreLines(steps) : lines;
          const nested = path.join(transcriptsDir, call, 'subagents', `agent-${call}.jsonl`);
          fs.mkdirSync(path.dirname(nested), { recursive: true });
          fs.writeFileSync(nested, core + '\n', 'utf8');
          written += 1;
        }
      }
      if (rec.input_tokens !== null && rec.input_tokens !== undefined) continue;
      const u = reader.readUsage(rec.conversationId);
      if (!u) continue;
      rec.input_tokens = u.input;
      rec.output_tokens = u.output;
      rec.cache_read_tokens = u.cache_read;
      rec.cache_write_tokens = u.cache_write;
      rec.model = u.model;
      rec.note = msg('spend.minimax-sync.backfill_note');
      filled += 1;
    }
    if (filled) {
      fs.writeFileSync(LEDGER, recs.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
    }
    console.log(msg('spend.minimax-sync.backfilled', { filled, total: recs.length, written }));
    return;
  }
  if (argv[0] === '--list') {
    for (const rec of readLedger()) console.log(JSON.stringify(rec));
    return;
  }
  console.log('usage: sync-ledger.cjs --append <json> | --derive <json> <node> <desc> | --derive-all <desc> | --list');
  process.exit(2);
}

if (require.main === module) main();

module.exports = { deriveSpendLineForCall, appendCall, readLedger, LEDGER, ENGINE_TAG, accountedInCard, cardFile, fullUsage };
