'use strict';

/**
 * Session economy and the "Intent ↔ human" line (AGENTS.md §3) - the dialogue spend in the main session, separate
 * from the five nodes. The returns are written by the engine adapter's scripts (`.forma/dashboard/.cache/session-economy.json`,
 * `session-current.json`, `codex-usage.json`); this module only reads: walking the transcripts costs seconds and
 * gigabytes, and doing it on every dashboard assembly is not allowed. The `cache` field of the output is not carried over - it is
 * a service field and bloats data.json threefold.
 */

const fs = require('fs');
const { execFileSync } = require('child_process');
const { readJson } = require('../lib/fs.cjs');
const engines = require('../lib/engines.cjs');
const { cachePath, readStatement } = require('./cache.cjs');

/** The full session return with age: transcripts grow every day, yesterday's is not today's. */
const readSessionEconomy = (projectRoot) => readStatement(projectRoot, 'session-economy.json', ['cache']);

// Current sessions are recomputed right here (`--session current`, fractions of a second), but no more often than once a minute:
// the dashboard assembly runs on every file change.
const DIALOG_REFRESH_MS = 60 * 1000;

function isStale(file) {
  try { return Date.now() - fs.statSync(file).mtimeMs > DIALOG_REFRESH_MS; }
  catch { return true; } // no file - refresh
}

/** Refreshes the dialogue-spend caches with the scripts the adapters declared (`usageRefresh`). */
function refreshUsageCaches(projectRoot) {
  for (const { script, args, cache } of engines.all(projectRoot, 'usageRefresh')) {
    if (!isStale(cachePath(projectRoot, cache))) continue;
    try {
      execFileSync(process.execPath, [engines.resolveRel(projectRoot, script), ...(args || [])],
        { stdio: 'ignore', timeout: 20000 });
    } catch { /* no transcripts on this host - we show what there is */ }
  }
}

/** "Total" - from the full return, as is, with its own age. */
function totalDialog(se) {
  if (!se || !se.totals) return null;
  return {
    sessions: se.totals.sessions,
    work: (se.totals.input || 0) + (se.totals.output || 0) + (se.totals.cacheCreate || 0),
    cacheRead: se.totals.cacheRead || 0,
    usd: se.totals.bestUsd,
    ageHours: se.ageHours,
  };
}

function currentDialog(current) {
  if (!current || !current.totals) return null;
  return { ...current.totals, generatedAt: current.generatedAt, sessionIds: current.sessions.map((s) => s.sessionId) };
}

/**
 * Whose returns these are: the engine tag → the cache names its adapter declared in `usageRefresh`, and the owner of the session return
 * (`session-current.json`/`session-economy.json`) - the first adapter that declared it. Engine names are not here: the UI checks against this.
 */
function ledgerOwners(projectRoot) {
  const usageCaches = {};
  let sessionOwner = null;
  for (const a of engines.loadAdapters(projectRoot)) {
    const tag = a.spendTag || a.engine || engines.idOf(a);
    const caches = (Array.isArray(a.usageRefresh) ? a.usageRefresh : []).map((r) => r && r.cache).filter(Boolean);
    if (caches.length) usageCaches[tag] = caches;
    if (!sessionOwner && caches.some((c) => c === 'session-current.json' || c === 'session-economy.json')) sessionOwner = tag;
  }
  return { sessionOwner, usageCaches };
}

function readDialog(projectRoot) {
  refreshUsageCaches(projectRoot);
  const current = readJson(cachePath(projectRoot, 'session-current.json'), null);
  const se = readSessionEconomy(projectRoot);
  const codex = readJson(cachePath(projectRoot, 'codex-usage.json'), null);
  return { current: currentDialog(current), all: totalDialog(se), codex, ...ledgerOwners(projectRoot) };
}

module.exports = { readSessionEconomy, readDialog };
