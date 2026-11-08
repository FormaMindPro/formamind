#!/usr/bin/env node
'use strict';

/**
 * subagent-spend.cjs - the canonical sums of a live subagent call from its transcript.
 *
 * The return of an Agent call (`<usage>`) carries only the context size at the last step - not the
 * spend; the real N, R and out are given by the call's transcript. With some engines a subagent's
 * transcript is temporary: the file lives while the call lives and is deleted after it ends - the
 * sums are taken at once, later there is nothing to take them from. No transcript - words, not zero
 * (the norm, not a failure: the file was deleted when the call ended).
 *
 * The parsing - through the engine adapters (findSubagent/stepOf): no host field names here.
 *   node .claude/scripts/subagent-spend.cjs <agent_id> [...] [--json]
 *
 * Prints (or yields with --json): the owner engine of the found file, the steps (dedup by requestId),
 * N = Σ in+write+read+out (the ECONOMY.md contract), R, out, the duration - the window between the first
 * and the last step of the transcript (not the host's duration_ms, whose basis is different).
 * What fact is absent - "not recorded", never 0.
 */

const { readSubagentTranscript, NO_TRANSCRIPT } = require('../../.forma/dashboard/subagent-transcript.cjs');
// Printed labels come from the core dictionary: English key in code, ru value as data.
const i18n = require('../../.forma/i18n/index.cjs');
const msg = (code, params) => i18n.message(code, params, 'ru');

const groups = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const NOT_RECORDED = msg('spend.subagent.not_recorded');

/** The window of a call in seconds between the first and the last step of the transcript; no time - null. */
function spanSeconds(first, last) {
  if (!first || !last) return null;
  const a = Date.parse(first);
  const b = Date.parse(last);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((b - a) / 1000));
}

/** A call id -> the canonical sums, or null - no transcript (that is NOT zero). */
async function spendOf(agentId, root) {
  const t = await readSubagentTranscript(agentId, root, null);
  if (!t) return null;
  return {
    agent_id: String(agentId),
    engine: t.tag || null,
    file: t.file,
    steps: t.steps,
    tokens_n: t.input + t.cacheCreate + t.cacheRead + t.output, // N = Σ in+write+read+out
    cache_read: t.cacheRead,
    cache_create: t.cacheCreate,
    tokens_out: t.output,
    duration_s: spanSeconds(t.first, t.last),
    first: t.first || null,
    last: t.last || null,
  };
}

module.exports = { spendOf, spanSeconds };

// ---- CLI ----
if (require.main === module) {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const ids = argv.filter((a) => !a.startsWith('--'));
  if (!ids.length) {
    console.error('usage: node .claude/scripts/subagent-spend.cjs <agent_id> [...] [--json]');
    process.exit(2);
  }
  (async () => {
    for (const id of ids) {
      const s = await spendOf(id);
      if (!s) {
        console.log(msg('spend.subagent.no_transcript_note', { id, no_transcript: NO_TRANSCRIPT }));
        continue;
      }
      if (json) { console.log(JSON.stringify(s, null, 2)); continue; }
      const f = (x) => (x == null ? NOT_RECORDED : groups(x));
      console.log(msg('spend.subagent.cli_row', {
        id, engine: s.engine || '?', steps: s.steps,
        n: f(s.tokens_n), r: f(s.cache_read), out: f(s.tokens_out), t: f(s.duration_s),
      }));
      console.log(`  ${msg('spend.subagent.file_line', { file: s.file })}`);
    }
  })();
}
