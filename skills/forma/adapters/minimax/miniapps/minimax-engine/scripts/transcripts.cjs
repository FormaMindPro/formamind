'use strict';

/**
 * The engine transcripts: where the runtime writes the real spend numbers and how to extract them.
 *
 * The runtime writes the step-by-step spend into the session transcript: `messages.jsonl`, every
 * assistant message carries `usage: {input, output, cacheRead, cacheWrite, totalTokens}` and the
 * model name. This is the only place where the numbers are real: the hook payload does not carry
 * them, so a hook without this reader writes `null` into the ledger, and the spend line reads
 * `unknown`.
 *
 * How to find a transcript by the session identifier: the session folder name is the base64 of its
 * `sessionId` with a time prefix. No walking all sessions: `base64(sessionId)` is the name. The walk
 * remains the fallback path, if the folder is named otherwise.
 *
 * The module is shared: the package hook loads it from `PLUGIN_ROOT`, the zone scripts - from the
 * package source in the project. One implementation, two sides.
 *
 * Read-only. Only the hook writes - the normalized transcript into `.minimax/.transcripts/`.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

/** The runtime profile: the runtime sets `PLUGIN_DATA`, and by it the profile is restored exactly. */
function profileRoot(env = process.env) {
  const data = env.PLUGIN_DATA;
  if (data) {
    // <profile>/v2/plugin-data/hooks/<plugin> -> <profile>: cut off four segments.
    const parts = path.normalize(data).split(path.sep);
    if (parts.length >= 6 && parts[parts.length - 3] === 'plugin-data' && parts[parts.length - 2] === 'hooks') {
      const profile = parts.slice(0, parts.length - 4).join(path.sep);
      if (profile) return profile;
    }
  }
  return path.join(os.homedir(), '.minimax');
}

/** The root of the runtime session storage. */
function sessionsRoot(env = process.env) {
  return path.join(profileRoot(env), 'v2', 'sessions');
}

/** The session folder name: time + base64 of `sessionId`. */
function sessionDirName(sessionId) {
  return Buffer.from(String(sessionId), 'utf8').toString('base64');
}

/** The session folder by its identifier. None - `null` (no transcript, not zero). */
function sessionDir(sessionId, env = process.env) {
  if (!sessionId) return null;
  const root = sessionsRoot(env);
  if (!fs.existsSync(root)) return null;

  const b64 = sessionDirName(sessionId);
  // The fast path first: the folder name contains the identifier base64.
  const walk = (dir, depth) => {
    if (depth > 4) return null;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const full = path.join(dir, e.name);
      if (e.name.includes(b64)) return full;
      const hit = walk(full, depth + 1);
      if (hit) return hit;
    }
    return null;
  };
  const byName = walk(root, 0);
  if (byName) return byName;

  // The fallback path: the session manifest.
  const byManifest = walk(root, 0);
  if (byManifest) return byManifest;
  try {
    for (const day of fs.readdirSync(root, { withFileTypes: true })) {
      if (!day.isDirectory()) continue;
      const dayDir = path.join(root, day.name);
      for (const s of fs.readdirSync(dayDir, { withFileTypes: true })) {
        if (!s.isDirectory()) continue;
        const manifest = path.join(dayDir, s.name, 'manifest.json');
        if (!fs.existsSync(manifest)) continue;
        try {
          const m = JSON.parse(fs.readFileSync(manifest, 'utf8'));
          if (m.sessionId === sessionId) return path.join(dayDir, s.name);
        } catch {
          /* the manifest does not read - go on */
        }
      }
    }
  } catch {
    /* no storage */
  }
  return null;
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * The session steps: the assistant messages with spend.
 * @returns {Array<{turnId, model, timestamp, input, output, cacheRead, cacheWrite}>}
 */
function readSteps(sessionId, env = process.env) {
  const dir = sessionDir(sessionId, env);
  if (!dir) return [];
  const file = path.join(dir, 'messages.jsonl');
  if (!fs.existsSync(file)) return [];
  const steps = [];
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes('"usage"')) continue;
    let j;
    try {
      j = JSON.parse(line);
    } catch {
      continue;
    }
    const m = j.message || {};
    if (m.role !== 'assistant' || !m.usage) continue;
    steps.push({
      turnId: j.turn_id || null,
      model: m.model || null,
      timestamp: m.timestamp || null,
      input: num(m.usage.input),
      output: num(m.usage.output),
      cacheRead: num(m.usage.cacheRead),
      cacheWrite: num(m.usage.cacheWrite),
    });
  }
  return steps;
}

/**
 * The whole session spend.
 * @returns {null|{input, output, cache_read, cache_write, model, calls}}
 *   `null` - no transcript or no spend in it. This is not zero.
 */
function readUsage(sessionId, env = process.env) {
  const steps = readSteps(sessionId, env);
  if (!steps.length) return null;
  const sum = (k) => {
    let total = 0;
    let known = false;
    for (const s of steps) {
      if (s[k] === null) continue;
      total += s[k];
      known = true;
    }
    return known ? total : null;
  };
  const models = {};
  for (const s of steps) if (s.model) models[s.model] = (models[s.model] || 0) + 1;
  const model = Object.entries(models).sort((a, b) => b[1] - a[1])[0];
  return {
    input: sum('input'),
    output: sum('output'),
    cache_read: sum('cacheRead'),
    cache_write: sum('cacheWrite'),
    model: model ? model[0] : null,
    calls: steps.length,
  };
}

/**
 * The normalized transcript - in the shape the core reads (`cache_read_input_tokens`,
 * `message.model`, `requestId`): the dashboard counts the window floor and the cuts by models over it.
 */
function normalizedLines(steps) {
  return steps
    .filter((s) => s.input !== null || s.output !== null || s.cacheRead !== null)
    .map((s, i) =>
      JSON.stringify({
        requestId: s.turnId || `step-${i}`,
        timestamp: s.timestamp || null,
        message: {
          role: 'assistant',
          model: s.model || 'unknown',
          usage: {
            input_tokens: s.input === null ? 0 : s.input,
            output_tokens: s.output === null ? 0 : s.output,
            cache_read_input_tokens: s.cacheRead === null ? 0 : s.cacheRead,
            cache_creation_input_tokens: s.cacheWrite === null ? 0 : s.cacheWrite,
          },
        },
      })
    )
    .join('\n');
}

/**
 * The normalized transcript for the core reading (`card-move.cjs --agent-id`): the same shape,
 * but `requestId` is unique per STEP, not per turn. The core deduplicates the steps of one response
 * by `requestId` (in Claude one API response is written as several lines) - so one runtime step must
 * be one line with its own key, otherwise the core counts only the first step of a turn.
 */
function coreLines(steps) {
  return steps
    .filter((s) => s.input !== null || s.output !== null || s.cacheRead !== null)
    .map((s, i) =>
      JSON.stringify({
        requestId: `${s.turnId || 'turn'}-${i}`,
        timestamp: s.timestamp || null,
        message: {
          role: 'assistant',
          model: s.model || 'unknown',
          usage: {
            input_tokens: s.input === null ? 0 : s.input,
            output_tokens: s.output === null ? 0 : s.output,
            cache_read_input_tokens: s.cacheRead === null ? 0 : s.cacheRead,
            cache_creation_input_tokens: s.cacheWrite === null ? 0 : s.cacheWrite,
          },
        },
      })
    )
    .join('\n');
}

module.exports = {
  profileRoot,
  sessionsRoot,
  sessionDirName,
  sessionDir,
  readSteps,
  readUsage,
  normalizedLines,
  coreLines,
};
