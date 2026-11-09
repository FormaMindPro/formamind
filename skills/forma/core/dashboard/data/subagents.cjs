'use strict';

/**
 * The registry of standing subagents (`.forma/dashboard/.cache/subagents-registry.json`) - `.forma/dashboard/subagents-log.cjs` writes it
 * on every entry into `subagents.log`; this module only reads it for the dashboard panel. A soft warning
 * instead of an exact countdown: the retention semantics are not unambiguously confirmed by the documentation.
 */

const { readJson } = require('../lib/fs.cjs');
const { cachePath } = require('./cache.cjs');

const SUBAGENT_STALE_DAYS = 25;

// The same casual time parsing as `timeAgo()` in index.html - the "YYYY-MM-DD HH:MM" format, not strict ISO
// (the project's single log convention).
function parseLogTimestamp(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/.exec(s || '');
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
}

function subagentRow(agent, r, now) {
  const lastUsedMs = parseLogTimestamp(r.last_used_at);
  const daysSinceUse = lastUsedMs != null ? (now - lastUsedMs) / 86400000 : null;
  return {
    agent,
    role: r.role || null,
    hiredAt: r.hired_at || null,
    lastUsedAt: r.last_used_at || null,
    calls: r.calls || 0,
    tokensTotal: r.tokens_total || 0,
    stale: daysSinceUse != null ? daysSinceUse > SUBAGENT_STALE_DAYS : false,
  };
}

/** Standing subagents, freshest first; no registry - empty. */
function readSubagentsRegistry(projectRoot) {
  const registry = readJson(cachePath(projectRoot, 'subagents-registry.json'), null);
  if (registry === null) return [];
  const now = Date.now();
  return Object.entries(registry)
    .map(([agent, r]) => subagentRow(agent, r, now))
    .sort((a, b) => (a.lastUsedAt < b.lastUsedAt ? 1 : a.lastUsedAt > b.lastUsedAt ? -1 : 0));
}

module.exports = { readSubagentsRegistry };
