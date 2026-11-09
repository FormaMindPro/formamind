#!/usr/bin/env node
// The accumulation counter for the graphify auto-trigger - reads graphify.config.json,
// watches how many new events have piled up since the last /graphify run
// (by the last line of .forma/dashboard/graphify.log), and past the threshold
// marks the graph as "due for a rebuild" (.forma/dashboard/.cache/graphify-pending.json).
//
// Run: node .forma/dashboard/graphify-trigger.cjs   (usually from watch.js, in the same order
// as watchFeatures()/watchGraphifyLog() in serve.js; by hand works too).

const fs = require('fs');
const path = require('path');
const { walk } = require('./lib/fs.cjs');
const engines = require('./lib/engines.cjs');
// Canonical ru strings of this module's own console output live in the core dictionary; the language is fixed.
const { message: coreMessage } = require('../i18n/index.cjs');
const ruMsg = (key, params) => coreMessage(key, params, 'ru');

const ROOT = __dirname;
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
// Only the closed cards (done/), not the whole board - a live board (backlog/todo/in-progress/review)
// changes at every step of the cycle; that is a different, far more expensive and volatile corpus
//.
const FEATURES_DIR = path.join(PROJECT_ROOT, '.devtool', 'features', 'done');
const CONFIG_FILE = path.join(ROOT, 'graphify.config.json');
const LOG_FILE = path.join(ROOT, 'graphify.log');
const CACHE_DIR = path.join(ROOT, '.cache');
const PENDING_FILE = path.join(CACHE_DIR, 'graphify-pending.json');

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch (err) { console.error(ruMsg('graphify_trigger.bad_config', { file: path.relative(PROJECT_ROOT, CONFIG_FILE), reason: err.message })); return null; }
}

// graphify.log's last line - the `AGENTS.md` format: "YYYY-MM-DD HH:MM | mode=... | ...".
// No log yet - the epoch (0) counts as the reference point, that is, all existing cards count in.
function lastRunAt() {
  if (!fs.existsSync(LOG_FILE)) return 0;
  const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n').map(l => l.trim()).filter(Boolean).filter(l => !l.startsWith('#'));
  if (!lines.length) return 0;
  const m = lines[lines.length - 1].match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/);
  if (!m) return 0;
  return new Date(`${m[1]}T${m[2]}:00`).getTime();
}

// Counts the markdown files of closed cards (done/) with an mtime newer than lastRun - an approximation
// of "N new events": both a card's closing and a new History line touch the file's mtime.
function countAccumulatedEvents(sinceMs) {
  if (!fs.existsSync(FEATURES_DIR)) return 0;
  return walk(FEATURES_DIR, { ext: '.md', symlinks: true, abs: true })
    .filter((file) => fs.statSync(file).mtimeMs > sinceMs).length;
}

function writePending(reason, count, threshold) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(PENDING_FILE, JSON.stringify({
    pending: true,
    reason,
    accumulatedEvents: count,
    threshold,
    since: new Date().toISOString(),
  }, null, 2), 'utf8');
}

function clearPending() {
  if (fs.existsSync(PENDING_FILE)) fs.unlinkSync(PENDING_FILE);
}

function check() {
  const config = loadConfig();
  if (!config || config.trigger?.mode !== 'history-accumulation') { clearPending(); return; }

  const threshold = config.trigger.threshold ?? 20;
  const since = lastRunAt();
  const count = countAccumulatedEvents(since);

  if (count < threshold) { clearPending(); return; }

  // The graphs are mechanical; the hook only marks "due for a rebuild".
  writePending('threshold-reached-awaiting-manual-run', count, threshold);
  console.log(ruMsg('graphify_trigger.pending_marked', { count, threshold, file: path.relative(PROJECT_ROOT, PENDING_FILE) }));
}

module.exports = { check };

// Run directly (`node .forma/dashboard/graphify-trigger.cjs`), not through require() from serve.js.
if (require.main === module) check();
