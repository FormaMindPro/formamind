#!/usr/bin/env node
// The spend accounting of standing subagents - a companion to AGENTS.md §3 "the call" in the card,
// but across the subagent's whole life, not per one task (the `kit.md` task "the spend accounting
// of standing subagents", the memory project_kit_subagent_infra_housekeeping.md).
//
// The critical fact: subagent_tokens in <usage> is
// a running total over the subagent's whole life (the current context size), not the spend of a
// call. So every record stores and uses the DELTA (the current raw value minus the previously
// stored one), not the raw number itself - otherwise the spend double-counts the whole
// previous context. See .forma/dashboard/subagents.log - the format is described there, in detail.
//
// The same node that writes the call line into the card's ## History writes this too - not a separate
// process: one operation right after the return from the Agent call.
//
// CACHE READ (R, AGENTS.md §3) was added later. About cache_read_input_tokens one must NOT
// repeat on faith what was established about subagent_tokens. Measured
// on a live session transcript (12 consecutive node steps):
// the per-step cache_read_input_tokens is NOT a running sum of the earlier reads
// (28049 -> 72904, while the sum of the first two would give 56098) but the size of the cached
// prefix at that step, exactly cr(n+1) = cr(n) + cc(n), six pairs in a row without
// exceptions. Exactly one thing follows, and no more: the field neither resets nor
// decreases over the subagent's life.
//
// What this is NOT: a proof that the R value of a whole Agent call is
// a snapshot (then the delta holds, as with tokens) or a sum over steps (then the raw
// number holds). From inside the node the <usage> of its own call is invisible, and there is
// nothing to invent here. So the nature is not declared but established by data:
//   - by default the delta is counted - as with tokens;
//   - a negative delta of a field that measurably does not decrease is PROOF that the call's
//     value is per-call, not a snapshot. Then the record neither silences nor clamps to zero:
//     the nature is fixed in the registry as `per-call`, the raw number counts as the spend,
//     and the log line says so.
// Until the two records exist, the nature stands honestly as `not established`.
//
// THE SOURCE OF R. All the reasoning above is about R mined from
// the call's return, where it is exactly absent. Now there is a second path, better than the first:
// each subagent call has its own transcript on disk (`subagent-transcript.cjs`),
// and R lies there per step. The sum over the deduplicated steps is the spend of THIS
// call, not a running total; so no delta needs computing and no nature needs establishing -
// it is known from the source's construction. The `--raw-cache-read` path
// is kept as it was: it does not interfere and will serve if an engine one day starts giving the field.
//
// A missing transcript NEVER becomes zero - neither in the log, nor in the registry, nor in the
// §3 line. The forty past calls do not have it and will not: transcripts live with the
// session. That is the norm of the corpus, not a shortfall, and it is named in words.
//
// CLI:      node .forma/dashboard/subagents-log.cjs record --agent <id> --role "<text>"
//             --raw-tokens <N> --duration-s <T> [--raw-cache-read <R>] [--from-transcript]
//             [--card <id>] --summary "<text>" [--node <Node>] [--date <YYYY-MM-DD>]
// Programmatically: const { recordSubagentCall, historyLine } = require('./subagents-log.cjs');
//
// Printed labels come from the core dictionary: English key in code, ru value as data.

const fs = require('fs');
const path = require('path');
const { readSubagentTranscript, NO_TRANSCRIPT } = require('./subagent-transcript.cjs');
const { readJson, writeJsonAtomic } = require('./lib/fs.cjs');
const { parseOptions } = require('./lib/cli.cjs');
const i18n = require('../i18n/index.cjs');
const msg = (code, params) => i18n.message(code, params, 'ru');

const ROOT = __dirname;
const CACHE_DIR = path.join(ROOT, '.cache');
const LOG_FILE = path.join(ROOT, 'subagents.log');
const REGISTRY_FILE = path.join(CACHE_DIR, 'subagents-registry.json');

// The same casual time format as graphify.log:
// YYYY-MM-DD HH:MM (an ISO slice without strict timezone handling) - consistent with
// .forma/dashboard/generate.js:timeAgo(), which parses this same shape.
function nowStamp() {
  return new Date().toISOString().slice(0, 16).replace('T', ' ');
}

function readRegistry() {
  return readJson(REGISTRY_FILE, {});
}

// The token delta: the first record - the raw number, afterwards - the difference with the previous raw.
function tokenDelta(existing, rawTokens) {
  if (!existing) return { first: true, delta: rawTokens, warning: '' };
  const delta = rawTokens - existing.last_raw_subagent_tokens;
  if (!(delta < 0)) return { first: false, delta, warning: '' };
  // Must not happen with a live subagent (only a reset/id reuse) -
  // no negative or arbitrary spend is invented: the delta is 0, an honest mark
  // in the log line itself, nothing hidden silently.
  return { first: false, delta: 0, warning: msg('sublog.token_warning') };
}

// The call's raw cache_read against the previous stored one: a delta, a first record, or
// a per-call nature proven by the decrease. Mutates `r` in place.
function applyRawCacheRead(r, o, existing) {
  const prev = existing ? existing.last_raw_cache_read : undefined;
  if (!Number.isFinite(prev)) {
    r.cacheFirst = true;
    r.cacheDelta = o.rawCacheRead;
    // One record proves nothing: the nature stays unset.
  } else if (o.rawCacheRead >= prev) {
    r.cacheDelta = o.rawCacheRead - prev;
    if (r.cacheNature === msg('sublog.nature_unset')) r.cacheNature = msg('sublog.nature_cumulative');
  } else {
    // A measured fact: per step this field does not decrease. So a decrease of the
    // CALL's value proves it is per-call, not a snapshot. No clamping to zero -
    // that is exactly the "convenient to us" skew the card was opened for.
    r.cacheNature = msg('sublog.nature_per_call_proved');
    r.cacheDelta = o.rawCacheRead;
    r.warning += msg('sublog.cache_warning_proved', { raw: o.rawCacheRead, prev });
  }
}

// ---- cache read (R) ----
// The delta by default, but the field's nature is not declared
// retroactively: the first observation contradicting it establishes it.
function cacheReading(o, existing) {
  const r = {
    cacheDelta: null,
    cacheNature: (existing && existing.cache_read_nature) || msg('sublog.nature_unset'),
    cacheFirst: false,
    warning: '',
    // The transcript gives R directly for this call - the sum over the deduplicated steps.
    // The nature here is not "established by observation", it follows from the source's
    // construction, so the whole delta machinery below is bypassed, not patched.
    fromTranscript: Number.isFinite(o.cacheReadFinal),
  };
  r.hasCache = r.fromTranscript || Number.isFinite(o.rawCacheRead);
  if (r.fromTranscript) {
    r.cacheDelta = o.cacheReadFinal;
    r.cacheNature = msg('sublog.nature_per_call_transcript');
  } else if (r.hasCache) {
    applyRawCacheRead(r, o, existing);
  }
  return r;
}

// The registry counter's previous value; no record or field - 0.
const carried = (existing, key) => (existing && existing[key] ? existing[key] : 0);

function registryEntry(o, existing, { at, role, delta, cache }) {
  return {
    role,
    hired_at: existing ? existing.hired_at : at,
    last_used_at: at,
    calls: (existing ? existing.calls : 0) + 1,
    tokens_total: (existing ? existing.tokens_total : 0) + delta,
    last_raw_subagent_tokens: o.rawTokens,
    cache_read_total: carried(existing, 'cache_read_total') + (cache.cacheDelta || 0),
    calls_with_cache_read: carried(existing, 'calls_with_cache_read') + (cache.hasCache ? 1 : 0),
    // A transcript call brings no raw-field value - and must not overwrite the previous
    // one with a dash: that is the same zero, only in the registry.
    last_raw_cache_read: Number.isFinite(o.rawCacheRead) ? o.rawCacheRead : (existing ? existing.last_raw_cache_read : undefined),
    cache_read_nature: cache.cacheNature,
    // Steps and output are taken only from the transcript; a call without one has neither, and
    // coverage is counted apart from the call count - otherwise recording incompleteness again
    // becomes indistinguishable from cheapness.
    steps_total: carried(existing, 'steps_total') + (Number.isFinite(o.steps) ? o.steps : 0),
    output_total: carried(existing, 'output_total') + (Number.isFinite(o.outputTokens) ? o.outputTokens : 0),
    calls_with_transcript: carried(existing, 'calls_with_transcript') + (cache.fromTranscript ? 1 : 0),
  };
}

function appendLogLine(o, { at, role, card, delta, first, cache, warning }) {
  const firstTag = first ? ' | first=true' : '';
  const cacheTag = cache.hasCache
    ? ` | cache_read=${cache.cacheDelta}${cache.cacheFirst ? ' | cache_read_first=true' : ''} | cache_read_nature=${cache.cacheNature}`
    // The absence of R is named in words right in the log line. Empty space would read
    // as zero exactly like the digit 0 - and has already been read that way.
    : ` | cache_read=${NO_TRANSCRIPT}`;
  const stepsTag = Number.isFinite(o.steps) ? ` | steps=${o.steps}` : '';
  const outTag = Number.isFinite(o.outputTokens) ? ` | output=${o.outputTokens}` : '';
  const line = `${at} | agent=${o.agent} | role=${role || '?'} | tokens=${delta}${cacheTag}${stepsTag}${outTag} | duration_s=${o.durationS}${firstTag} | card=${card} | ${o.summary}${warning}\n`;
  fs.appendFileSync(LOG_FILE, line, 'utf8');
}

/**
 * One operation: computes the delta, appends a line to .forma/dashboard/subagents.log,
 * updates .forma/dashboard/.cache/subagents-registry.json. Call right after the
 * same node has already written the call line into the card's ## History (AGENTS.md §3).
 *
 * @param {object} o
 * @param {string} o.agent - the standing subagent's id (e.g. "a48ea883239bba084")
 * @param {string} [o.role] - the specifics, human-readable; mandatory on the first record,
 *   on the later ones, if not passed, the previous one is kept from the registry
 * @param {number} o.rawTokens - the raw subagent_tokens of this call (a running total)
 * @param {number} [o.rawCacheRead] - the raw cache_read_input_tokens of this call (R, §3)
 * @param {number} [o.cacheReadFinal] - this call's R, already computed from the transcript
 *   (the sum over the deduplicated steps). The value is per-call by the source's construction -
 *   no delta is applied to it. `rawCacheRead` wins if both are passed.
 * @param {number} [o.steps] - the call's step count by the transcript (unique requestIds)
 * @param {number} [o.outputTokens] - the model's output for the call by the transcript
 * @param {string} [o.agentId] - the call's identifier for the §3 line; by default `o.agent`
 * @param {number} o.durationS - this call's duration, seconds (integer)
 * @param {string} [o.card] - the card id, if the call is bound to one; otherwise '-'
 * @param {string} o.summary - one phrase of what was done
 * @returns {{delta:number, first:boolean, tokensTotal:number}}
 */
function recordSubagentCall(o) {
  if (!o || !o.agent || !Number.isFinite(o.rawTokens) || !Number.isFinite(o.durationS) || !o.summary) {
    throw new Error(msg('sublog.err_required_args'));
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const registry = readRegistry();
  const at = nowStamp();
  const card = o.card || '-';
  const existing = registry[o.agent];

  const { first, delta, warning: deltaWarning } = tokenDelta(existing, o.rawTokens);
  const cache = cacheReading(o, existing);
  const role = o.role || (existing && existing.role) || null;
  registry[o.agent] = registryEntry(o, existing, { at, role, delta, cache });
  writeJsonAtomic(REGISTRY_FILE, registry);

  appendLogLine(o, { at, role, card, delta, first, cache, warning: deltaWarning + cache.warning });

  const history = o.node
    ? historyLine({
        node: o.node, date: o.date, tokens: delta, cacheRead: cache.cacheDelta,
        durationS: o.durationS, agentId: o.agentId || o.agent, summary: o.summary,
      })
    : null;

  return {
    delta, first, tokensTotal: registry[o.agent].tokens_total,
    cacheDelta: cache.cacheDelta, cacheNature: cache.cacheNature, cacheFirst: cache.cacheFirst, fromTranscript: cache.fromTranscript,
    steps: Number.isFinite(o.steps) ? o.steps : null,
    outputTokens: Number.isFinite(o.outputTokens) ? o.outputTokens : null,
    history,
  };
}

/**
 * The `## History` line of the AGENTS.md §3 format, assembled whole - all four values
 * of the spend block at once, so none has to be appended by hand and lost:
 *
 *   `Node`, YYYY-MM-DD: attempt, N tokens (R cache-read), T s, `agent_id` - what was done.
 *
 * The key part is always in English, whatever the project's language; the description is
 * in the card's language. `sync-engines --check` names the Russian key part after the day the rule came in.
 *
 * The field order is not taste: `sync-engines.cjs` expects the identifier last in the spend
 * block, right before the dash (`checkAgentId`, HAS_ID = /,\s*`?[0-9a-f]{8,}`?\s*—/),
 * and the cache read - in brackets right after the tokens (`checkAttemptFormat`). Moving either
 * of the two means passing by eye and failing the check.
 *
 * The value is ABSENT - the segment is absent entirely. Neither zero, nor a dash: both read as
 * "almost free", while `tally.cjs` prints "not recorded" on the missing segment.
 * That is exactly what a call whose transcript was not found looks like.
 */
function historyLine({ node, date, tokens, cacheRead, durationS, agentId, summary }) {
  const d = date || new Date().toISOString().slice(0, 10);
  const cache = Number.isFinite(cacheRead) ? ` (${cacheRead} cache-read)` : '';
  const secs = Number.isFinite(durationS) ? `, ${durationS} s` : '';
  const id = agentId ? `, \`${agentId}\`` : '';
  const text = String(summary || '').trim().replace(/\.*$/, '');
  return `- \`${node}\`, ${d}: attempt, ${tokens} tokens${cache}${secs}${id} — ${text}.`;
}

/**
 * Record a call, taking R, the output and the steps from the transcript by `agent_id`.
 * The caller is left what the transcript does not know: the raw `subagent_tokens`,
 * the duration and one phrase of what was done.
 *
 * No transcript - the record still happens, but WITHOUT an invented zero: R does not
 * reach the §3 line, the log says "transcript not found", and the return carries
 * `transcriptMissing: true`. That is the normal state of early calls.
 */
async function recordSubagentCallFromTranscript(o) {
  const t = await readSubagentTranscript(o.agent);
  return {
    ...recordSubagentCall({
      ...o,
      cacheReadFinal: t ? t.cacheRead : undefined,
      steps: t ? t.steps : undefined,
      outputTokens: t ? t.output : undefined,
      role: o.role || (t && (t.description || t.agentType)) || undefined,
    }),
    transcript: t,
    transcriptMissing: !t,
  };
}

module.exports = {
  recordSubagentCall, recordSubagentCallFromTranscript, historyLine,
  readSubagentTranscript, NO_TRANSCRIPT,
};

// ---- CLI ----
if (require.main === module) {
  const argv = process.argv.slice(2);
  if (argv[0] !== 'record') {
    console.error(msg('sublog.usage'));
    process.exit(2);
  }
  // A flag without a value (`--from-transcript`) must not swallow the next argument:
  // otherwise `--from-transcript --card <id>` silently loses the card.
  const args = parseOptions(argv.slice(1));
  if (!args.agent || args['raw-tokens'] === undefined || args['duration-s'] === undefined || !args.summary) {
    console.error(msg('sublog.cli_missing'));
    process.exit(2);
  }
  const payload = {
    agent: args.agent,
    role: typeof args.role === 'string' ? args.role : undefined,
    rawTokens: Number(args['raw-tokens']),
    rawCacheRead: args['raw-cache-read'] === undefined ? undefined : Number(args['raw-cache-read']),
    durationS: Number(args['duration-s']),
    card: typeof args.card === 'string' ? args.card : undefined,
    summary: args.summary,
    node: typeof args.node === 'string' ? args.node : undefined,
    date: typeof args.date === 'string' ? args.date : undefined,
    agentId: typeof args['agent-id'] === 'string' ? args['agent-id'] : undefined,
  };

  (async () => {
    try {
      // By default R comes from the transcript: the only path that works at all.
      // `--no-transcript` is kept for the case when R is passed by hand.
      const wantTranscript = args['no-transcript'] !== true && args['raw-cache-read'] === undefined;
      const result = wantTranscript
        ? await recordSubagentCallFromTranscript(payload)
        : recordSubagentCall(payload);

      console.log(msg('sublog.recorded', {
        agent: args.agent, delta: result.delta,
        first: result.first ? msg('sublog.first_record') : '', total: result.tokensTotal,
      }));
      if (result.cacheDelta !== null) {
        console.log(msg('sublog.cache_line', {
          delta: result.cacheDelta, first: result.cacheFirst ? msg('sublog.first_record') : '', nature: result.cacheNature,
        }));
        if (result.steps !== null) {
          console.log(msg('sublog.transcript_line', { steps: result.steps, output: result.outputTokens }));
        }
      } else if (result.transcriptMissing) {
        // Exactly those words, and no number beside: a leading zero here would read as
        // "the call cost almost nothing", while it did cost - there is just nothing to read it with.
        console.log(msg('sublog.cache_missing_transcript', { no_transcript: NO_TRANSCRIPT, agent: args.agent }));
        console.log(msg('sublog.cache_missing_tally'));
      } else {
        console.log(msg('sublog.cache_not_passed'));
      }
      if (result.history) console.log(msg('sublog.history_header') + result.history);
    } catch (err) {
      console.error(msg('sublog.error'), err.message);
      process.exit(1);
    }
  })();
}
