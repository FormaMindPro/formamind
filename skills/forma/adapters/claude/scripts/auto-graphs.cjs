#!/usr/bin/env node
// The auto-build of the Kit graphs after the project's files change: debounce and lock, no model.
//   node .claude/scripts/auto-graphs.cjs touch     - mark "dirty"; with no worker yet - start one as a separate process
//   node .claude/scripts/auto-graphs.cjs --worker  - internal: waits for quiet, builds, repeats while the mark is fresher than the build
// Quiet - DEBOUNCE_MS without new marks; one worker at a time - a lock file (a stale lock is removed).
// A build failure is not rethrown: the hook must not block writes.

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const DIR = path.join(ROOT, '.forma', 'dashboard', '.cache');
const STAMP = path.join(DIR, 'graphs-dirty');
const LOCK = path.join(DIR, 'graphs.lock');
const LOG = path.join(DIR, 'graphs-auto.log');
const DEBOUNCE_MS = Number(process.env.AUTO_GRAPHS_DEBOUNCE_MS) || 30000;
const STALE_LOCK_MS = 10 * 60 * 1000;
const POLL_MS = 2000;

const now = () => Date.now();
const mtime = f => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = s => { try { fs.appendFileSync(LOG, new Date().toISOString() + ' ' + s + '\n'); } catch { /* the log is optional */ } };

function mark() {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(STAMP, String(now()));
}

function takeLock() {
  fs.mkdirSync(DIR, { recursive: true });
  if (mtime(LOCK) && now() - mtime(LOCK) > STALE_LOCK_MS) { try { fs.unlinkSync(LOCK); } catch { /* held by another */ } }
  try { fs.closeSync(fs.openSync(LOCK, 'wx')); return true; } catch { return false; }
}

const dropLock = () => { try { fs.unlinkSync(LOCK); } catch { /* already removed */ } };

function touch() {
  mark();
  if (!takeLock()) return;                       // the worker is already waiting or building - it will see the fresh mark
  const child = spawn(process.execPath, [__filename, '--worker'], { cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}

async function worker() {
  try {
    for (;;) {
      while (now() - mtime(STAMP) < DEBOUNCE_MS) { fs.utimesSync(LOCK, new Date(), new Date()); await sleep(POLL_MS); }
      const started = now();
      const r = spawnSync(process.execPath, [path.join(__dirname, 'build-kit-graphs.cjs')], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
      log(r.status === 0 ? `ok ${Math.round((now() - started) / 1000)}s` : `fail code=${r.status} ${String(r.stderr || '').split('\n')[0]}`);
      if (mtime(STAMP) <= started) break;        // no edits happened during the build - done
    }
  } catch (err) { log('worker error ' + (err && err.message)); }
  finally { dropLock(); }
}

const cmd = process.argv[2];
if (cmd === 'touch') touch();
else if (cmd === '--worker') worker();
else { console.error('auto-graphs: touch | --worker'); process.exit(2); }
