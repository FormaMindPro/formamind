#!/usr/bin/env node
'use strict';

/**
 * The transcript of a subagent call - the source of `R`.
 *
 * For half a year the call line stood without cache-read, because the return of an Agent call
 * does not give it: `<usage>` carries `subagent_tokens`, `tool_uses`, `duration_ms` - and that is all.
 * The fork was resolved by a find: the `SubagentStop` event has the field
 * `agent_transcript_path`, that is EVERY subagent call has its own transcript on disk:
 *
 *   <the project's transcript directory>/<sessionId>/subagents/agent-<agent_id>.jsonl
 *   <the project's transcript directory>/<sessionId>/subagents/agent-<agent_id>.meta.json
 *
 * The layout belongs to the engine adapter: its declared `findSubagent(agentId, root)` returns the file
 * itself (a host may keep transcripts its own way), and its `stepOf(line)` - the usage, requestId, model
 * and time of a step; the core keeps the deduplication and the sums, and knows no engine field names.
 *
 * `.meta.json` carries `agentType`, `description`, `toolUseId`, `spawnDepth`.
 * The `.jsonl` holds ordinary records with `message.usage`; the four fields are taken from there.
 *
 * THREE THINGS IT IS EASY TO GET SILENTLY WRONG HERE - the same as in the adapter's
 * `session-economy.cjs`, where the method is already debugged and checked against the engine's
 * bookkeeping (a 0.25% deviation). They are repeated here not out of politeness but because
 * each of them once produced a wrong number:
 *
 * 1. DEDUPLICATION BY `requestId` - a correctness condition, not an optimization. One and the same
 *    usage record sits in the file many times (conversation branches are rebuilt). On the shared
 *    session the lack of deduplication inflated the count tenfold, and the plausibility of the number
 *    does not show it. A measurement on `agent-a3f3f8bf86f7eae4f.jsonl`: 24 lines with
 *    `cache_read_input_tokens`, unique `requestId` - 11. Eleven is the steps.
 * 2. THE ABSENCE OF A TRANSCRIPT IS NOT ZERO. Transcripts live with the session: forty past calls
 *    do not have them and never will. The function returns `null`, and no path out of here returns
 *    zeros: a leading zero reads to the eye as "almost free" - exactly the error the denominator
 *    exists for.
 * 3. READ ONLY. The engine's transcript directory belongs to another. Nothing is written here.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
// Labels come from the core dictionary: English key in code, ru value as data (the same ru words as
// before the translation - the constant is consumed by the spend scripts and asserted by tests).
const i18n = require('../../.forma/i18n/index.cjs');
const msg = (code, params) => i18n.message(code, params, 'ru');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const economy = require('./economy.cjs');
// The transcript directory and the parsing of a step's `message.usage` into canonical variables - the
// engine adapter's knowledge (the core-adapter boundary: `lib/engines.cjs`). No adapter - no transcript,
// which is not zero.
const engines = require('./lib/engines.cjs');

/** The words naming the absence of a transcript. One place for the whole project - so that a "zero"
 *  leaks neither into a log, nor into a report, nor into a call line. */
const NO_TRANSCRIPT = msg('spend.transcript.missing');

/** The project's transcript directories by engine tag - as in `card-move.cjs` (`readTranscript`): `[{ tag, dir, parseUsage }]`
 *  through `engines.transcriptDirs`. With a tag - only that engine's; without - all adapters' (the freshest file wins).
 *  No adapter is picked: a transcript belongs to the engine whose tag stands in the call line.
 *  Hardcoding a project path here would make the script unportable on the very day
 *  the "Forma" plugin moves to another project. */
function transcriptDirs(root = PROJECT_ROOT, tag = null) {
  return engines.transcriptDirs(root).filter((d) => !tag || d.tag === tag);
}

/** Seeks a call transcript by id among the engines (`tag`) or all. The adapter knows the layout: an engine with
 *  `findSubagent(agentId, root)` - its answer (`{ file, sessionId? }`); the others - the `agent-<id>.jsonl`
 *  layout over the sessions of the directory. The session is not given from outside: the caller knows the
 *  `agent_id` from the call's return and does not know the `sessionId`. No directory for the tag - `null`. */
function findTranscript(agentId, root = PROJECT_ROOT, tag = null) {
  if (!agentId || !/^[A-Za-z0-9_-]+$/.test(agentId)) return null;
  let newest = null;
  for (const d of transcriptDirs(root, tag)) {
    if (typeof d.findSubagent === 'function') {
      let f = null;
      try { f = d.findSubagent(agentId, root); } catch { f = null; }
      if (!f || !f.file) continue;
      let st;
      try { st = fs.statSync(f.file); } catch { continue; }
      if (!st.isFile()) continue;
      /* The same id may theoretically occur in two sessions. The freshest wins:
         the call line is written right after the return, that is, about the last call. */
      if (!newest || st.mtimeMs > newest.mtimeMs) {
        newest = { file: f.file, mtimeMs: st.mtimeMs, sessionId: f.sessionId || null, tag: d.tag, parseUsage: d.parseUsage, stepOf: d.stepOf };
      }
      continue;
    }
    let sessions;
    try { sessions = fs.readdirSync(d.dir, { withFileTypes: true }); } catch { continue; }
    for (const s of sessions) {
      if (!s.isDirectory()) continue;
      const file = path.join(d.dir, s.name, 'subagents', `agent-${agentId}.jsonl`);
      let st;
      try { st = fs.statSync(file); } catch { continue; }
      if (!st.isFile()) continue;
      /* The same id may theoretically occur in two sessions. The freshest wins:
         the call line is written right after the return, that is, about the last call. */
      if (!newest || st.mtimeMs > newest.mtimeMs) {
        newest = { file, mtimeMs: st.mtimeMs, sessionId: s.name, tag: d.tag, parseUsage: d.parseUsage, stepOf: d.stepOf };
      }
    }
  }
  return newest;
}

function readMeta(jsonlFile) {
  const metaFile = jsonlFile.replace(/\.jsonl$/, '.meta.json');
  try { return JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch { return null; }
}

/**
 * Parsing a transcript as a stream. A call file is small (tens-hundreds of lines), but the method
 * is the same as on the gigabyte corpus of the shared session: a cheap substring pre-filter before
 * `JSON.parse`, deduplication by `requestId`.
 *
 * @returns {Promise<null|{agentId, sessionId, file, tag, agentType, description, toolUseId,
 *   spawnDepth, steps, cacheRead, cacheCreate, input, output, models, first, last}>}
 *   `null` - no transcript. That is NOT zero, see point 2 in the header.
 */
async function readSubagentTranscript(agentId, root = PROJECT_ROOT, tag = null) {
  const found = findTranscript(agentId, root, tag);
  if (!found || typeof found.parseUsage !== 'function') return null;
  const parseUsage = found.parseUsage;

  const seen = new Set();
  const t = economy.emptyUsage();
  const models = new Set();
  let first = null, last = null;

  const rl = readline.createInterface({
    input: fs.createReadStream(found.file),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!found.stepOf && !line.includes('cache_read_input_tokens')) continue; // the pre-parse filter
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    // The step is parsed by the adapter (stepOf: usage, requestId, time), if it declared one; otherwise - the message.usage layout.
    let u, key, ts;
    if (typeof found.stepOf === 'function') {
      let st = null;
      try { st = found.stepOf(j); } catch { st = null; }
      if (!st || !st.usage) continue;
      u = st.usage; key = st.requestId; ts = st.timestamp;
      if (st.model) models.add(st.model);
    } else {
      u = j.message && j.message.usage;
      if (!u || u.cache_read_input_tokens == null) continue;
      key = j.requestId || j.uuid; // see point 1 in the header
      ts = j.timestamp;
    }
    if (key != null) { if (seen.has(key)) continue; seen.add(key); } // without a key an engine's steps do not collapse

    economy.addUsage(t, parseUsage(u));
    if (j.message && j.message.model) models.add(j.message.model);
    if (ts) { if (!first) first = ts; last = ts; }
  }

  // The file exists but not a single step with usage - that is not "zero spend" but an unreadable
  // transcript. It is named the same as its absence, and for the same reason.
  if (!t.calls) return null;

  const meta = readMeta(found.file) || {};
  return {
    agentId,
    sessionId: found.sessionId,
    file: found.file,
    tag: found.tag || null,
    agentType: meta.agentType || null,
    description: meta.description || null,
    toolUseId: meta.toolUseId || null,
    spawnDepth: meta.spawnDepth == null ? null : meta.spawnDepth,
    steps: t.calls,
    cacheRead: t.cache_read,
    cacheCreate: t.cache_write,
    input: t.tokens_in,
    output: t.tokens_out,
    usage: { tokens_in: t.tokens_in, tokens_out: t.tokens_out, cache_read: t.cache_read, cache_write: t.cache_write },
    models: [...models].sort(),
    first, last,
  };
}

module.exports = { readSubagentTranscript, findTranscript, transcriptDirs, NO_TRANSCRIPT };

// ---- CLI: node .forma/dashboard/subagent-transcript.cjs <agent_id> [...] ----
if (require.main === module) {
  const ids = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (!ids.length) {
    console.error('usage: node .forma/dashboard/subagent-transcript.cjs <agent_id> [<agent_id> ...]');
    process.exit(2);
  }
  (async () => {
    const groups = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    for (const id of ids) {
      const r = await readSubagentTranscript(id);
      if (!r) {
        // Neither a number nor a zero - only words.
        console.log(`${id}  ${NO_TRANSCRIPT}`);
        continue;
      }
      console.log(msg('spend.transcript.cli_row', {
        id,
        node: r.agentType || '?',
        steps: r.steps,
        read: groups(r.cacheRead),
        create: groups(r.cacheCreate),
        input: groups(r.input),
        output: groups(r.output),
      }));
    }
  })();
}
