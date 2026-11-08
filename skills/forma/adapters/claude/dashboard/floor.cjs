#!/usr/bin/env node
'use strict';

/**
 * THE FLOOR OF THE WINDOW - what one call costs BEFORE anything happened in it.
 *
 * The floor of a session = the minimal window size among its calls, where the window size is
 *   cache_read_input_tokens + cache_creation_input_tokens + input_tokens.
 * The minimum, not the average and not the first call: the window only grows over a session, so
 * the cheapest call is exactly the one holding a single instruction - the law, the role,
 * the declared tools, the memory, the engine's system prompt - and almost nothing beyond.
 *
 * WHY THIS IS MEASURED BY A LINE, NOT BY ONE NUMBER. The floor's value by itself says nothing
 * and deceives: over two months the project gained five roles, fourteen skills,
 * sixty memory records and the experience graph - and the floor moved by a few thousand and came
 * back. So it is almost entirely not ours, and there is nothing to trim in it. The meaning is in
 * the SLOPE: the line catches the day someone hooks up a server with two hundred tools, and catches
 * it the next day, not a quarter later by count.
 *
 * THREE THINGS EASY TO GET SILENTLY WRONG HERE - the same as in the adapter's
 * `session-economy.cjs` and `.forma/dashboard/subagent-transcript.cjs`:
 *
 * 1. DEDUPLICATION BY `requestId`. The same usage record lies in the file many times
 *    (rebuilding the conversation branches). On the minimum it hurts less than on the sum, but
 *    the call counter without it inflates tenfold and "the floor computed over 40 calls"
 *    stops meaning what is written.
 * 2. STREAMING READ, NOT `readFileSync`. The shared-session transcripts are hundreds of megabytes,
 *    beyond Node's string limit: reading them whole fails. Hence `readline` and a cheap
 *    substring prefilter before `JSON.parse`.
 * 3. THE MODEL MATTERS. Beside the working calls the transcript holds service ones
 *    (the conversation header, small hints) - they run on a cheap model with a tiny
 *    window, and the minimum over all models at once would give a floor of hundreds of tokens instead
 *    of seventy thousand. The floor is computed over the session's DOMINANT model (by the count
 *    of calls); the minimum over all models is kept too - `floorAnyModel`, so the divergence is
 *    visible, not hidden in the filter.
 *
 * READ ONLY. The engine's transcript directory is someone else's; nothing is written here;
 * the only own file written is `.forma/dashboard/.cache/floor.json`.
 *
 * Run: node .forma/dashboard/floor.cjs            - compute and write the cache
 *      node .forma/dashboard/floor.cjs --print    - the same and print the table
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const engines = require('./lib/engines.cjs');
// Printed labels come from the core dictionary: English key in code, ru value as data.
const i18n = require('../i18n/index.cjs');
const msg = (code, params) => i18n.message(code, params, 'ru');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

/** The words naming the absence of transcripts. No path from here returns
 *  zero: a leading zero reads to the eye as "the window is free" - exactly the opposite. */
const NO_TRANSCRIPTS = 'no-transcripts'; // a code: the browser translates `bort.fl.u.<code>`

/** A step's timestamp -> an ISO string; unreadable or empty - `null`. */
function isoOf(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) {
    const d = new Date(v < 1e11 ? v * 1000 : v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

/**
 * One transcript -> the floor. Streamed, with deduplication.
 * @returns {Promise<null|{calls, floor, model, floorAnyModel, anyModel, first, last}>}
 *   `null` - the file holds not a single call with usage. That is not zero but an unreadable transcript.
 */
async function parseFloor(file, parseUsage) {
  const seen = new Set();
  // The minimum and the call count are kept PER MODEL - otherwise the service model pulls the floor down.
  const byModel = new Map(); // model -> { calls, min }
  let anyMin = null, anyModel = null;
  let first = null, last = null;

  const rl = readline.createInterface({
    input: fs.createReadStream(file),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.includes('cache')) continue; // prefilter before parsing: a step without cache fields never enters the floor
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    const raw = (j.message && j.message.usage) || j.usage;
    if (!raw) continue;
    // The step parsing - in the engine adapter (the canonical variables); an adapter without parsing - the Claude-format fields.
    let r;
    try {
      r = parseUsage ? parseUsage(raw) : { tokens_in: raw.input_tokens, cache_read: raw.cache_read_input_tokens, cache_write: raw.cache_creation_input_tokens };
    } catch { continue; }
    if (!r || r.cache_read == null) continue;
    const key = j.requestId || j.uuid || j.id;
    if (key != null) { if (seen.has(key)) continue; seen.add(key); }

    const window = r.cache_read + (r.cache_write || 0) + (r.tokens_in || 0);

    const model = (j.message && j.message.model) || 'unknown';
    let m = byModel.get(model);
    if (!m) byModel.set(model, (m = { calls: 0, min: window }));
    m.calls += 1;
    if (window < m.min) m.min = window;

    if (anyMin == null || window < anyMin) { anyMin = window; anyModel = model; }
    // The timestamp differs by engine - an ISO string or a number (ms/s since the epoch): normalized to an ISO string.
    const ts = isoOf(j.timestamp);
    if (ts) { if (!first) first = ts; last = ts; }
  }
  rl.close();

  if (!byModel.size) return null;

  // The dominant model - the one the session worked on, not the one that flashed by.
  const [model, dom] = [...byModel.entries()].sort((a, b) => b[1].calls - a[1].calls)[0];
  return {
    calls: [...byModel.values()].reduce((s, m) => s + m.calls, 0),
    callsOnModel: dom.calls,
    floor: dom.min,
    model,
    floorAnyModel: anyMin,
    anyModel,
    first, last,
  };
}

/**
 * The walk over the project's transcripts. A cache by `sessionId` + size + mtime: a closed session
 * does not change anymore, and re-reading its hundreds of megabytes on every dashboard build
 * is pointless. A live session grows - its size changes, and it is recomputed.
 */
async function build(root = PROJECT_ROOT) {
  const dirs = engines.transcriptDirs(root);
  const cacheFile = path.join(root, '.forma/dashboard', '.cache', 'floor.json');

  if (!dirs.length) {
    return { generatedAt: new Date().toISOString(), unavailable: NO_TRANSCRIPTS, sessions: [], byDate: [] };
  }

  let prev = {};
  try { prev = (JSON.parse(fs.readFileSync(cacheFile, 'utf8')).cache) || {}; } catch { /* no cache - compute everything */ }
  const cache = {};

  const sessions = [];
  // All engines: the transcripts of each adapter. The cache key - engine + session (ids of different engines may coincide).
  for (const { tag, dir, parseUsage } of dirs) {
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files) {
      const full = path.join(dir, f);
      let st;
      try { st = fs.statSync(full); } catch { continue; }
      const sessionId = f.replace(/\.jsonl$/, '');
      const ck = tag + ':' + sessionId;
      const hit = prev[ck];
      let row;
      if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) {
        row = hit.row;
      } else {
        row = await parseFloor(full, parseUsage);
      }
      cache[ck] = { size: st.size, mtimeMs: st.mtimeMs, row };
      if (!row) continue; // an unreadable transcript - not zero, just no line
      sessions.push({ sessionId, engine: tag, date: (row.first || '').slice(0, 10) || null, ...row });
    }
  }

  sessions.sort((a, b) => String(a.date).localeCompare(String(b.date)));

  // The line by dates. Two sessions on one day - the lower one is taken: the day's floor is the
  // cheapest call of the day, not their average.
  const byDateMap = new Map();
  for (const s of sessions) {
    if (!s.date) continue;
    const d = byDateMap.get(s.date);
    if (!d || s.floor < d.floor) byDateMap.set(s.date, { date: s.date, floor: s.floor, sessions: (d ? d.sessions : 0) + 1 });
    else d.sessions += 1;
  }
  const byDate = [...byDateMap.values()].sort((a, b) => a.date.localeCompare(b.date));

  const floors = byDate.map((d) => d.floor);
  return {
    generatedAt: new Date().toISOString(),
    unavailable: sessions.length ? null : NO_TRANSCRIPTS,
    sessionCount: sessions.length,
    min: floors.length ? Math.min(...floors) : null,
    max: floors.length ? Math.max(...floors) : null,
    // The drift from the first measurement to the last - the only thing the line exists for.
    drift: floors.length > 1 ? floors[floors.length - 1] - floors[0] : null,
    sessions,
    byDate,
    cache,
  };
}

module.exports = { build, parseFloor, NO_TRANSCRIPTS };

// ---- CLI ----
if (require.main === module) {
  (async () => {
    const data = await build();
    const outDir = path.join(PROJECT_ROOT, '.forma/dashboard', '.cache');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'floor.json'), JSON.stringify(data, null, 2), 'utf8');

    const groups = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    if (data.unavailable) {
      console.log('no project transcripts found');
    } else {
      console.log(msg('floor.header') + '\n');
      for (const s of data.sessions) {
        const note = s.floorAnyModel !== s.floor
          ? msg('floor.any_model_note', { min: groups(s.floorAnyModel), model: String(s.anyModel).split('-').slice(0, 2).join('-') })
          : '';
        console.log(`${s.date || '????-??-??'}  ${String(groups(s.floor)).padStart(9)}  ` +
          msg('floor.calls', { calls: String(s.callsOnModel).padStart(5), model: s.model }) + note);
      }
      console.log(msg('floor.summary', {
        sessions: data.sessionCount, min: groups(data.min), max: groups(data.max),
        drift: (data.drift > 0 ? '+' : '') + groups(data.drift),
      }));
      console.log(msg('floor.slope_note'));
    }
    console.log(`\n→ .forma/dashboard/.cache/floor.json`);
  })();
}
