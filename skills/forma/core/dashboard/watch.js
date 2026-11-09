#!/usr/bin/env node
// serve.js's supervisor: restarts it on an unexpected fall, with a growing pause between
// attempts, so as not to sink into an endless fast restart loop.
// Run instead of serve.js directly when crash protection is needed for the whole
// lifetime of the process:
//   node .forma/dashboard/watch.js
// Usually it is raised not by hand but through ensure-running.js (next to it) -
// it does that in the background, detached, outliving the caller process's exit.

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
// Canonical ru strings of the console output live in the core dictionary; the language is fixed.
const { message: coreMessage } = require('../i18n/index.cjs');
const ruMsg = (key, params) => coreMessage(key, params, 'ru');

const SERVE_PATH = path.join(__dirname, 'serve.js');
const CACHE_DIR = path.join(__dirname, '.cache');
const SUPERVISOR_FILE = path.join(CACHE_DIR, 'supervisor.json');

// The growing pause between consecutive restarts - protection against a loop of instant falls
// (say, the port taken by another process): it does not load the machine with senseless
// once-a-second attempts.
const BACKOFF_MS = [500, 1000, 2000, 5000, 10000, 30000];
let attempt = 0;
let child = null;

function canRun() {
  return fs.existsSync(__dirname) && fs.existsSync(SERVE_PATH);
}

function writeSupervisorFile() {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(SUPERVISOR_FILE, JSON.stringify({ pid: process.pid, started: new Date().toISOString() }), 'utf8');
  } catch {}
}

function cleanup() {
  try { if (fs.existsSync(SUPERVISOR_FILE)) fs.unlinkSync(SUPERVISOR_FILE); } catch {}
  if (child && !child.killed) {
    try { process.kill(child.pid); } catch {}
  }
}

process.on('exit', cleanup);
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

function launch() {
  if (!canRun()) {
    process.exit(0);
  }

  writeSupervisorFile();
  const startedAt = Date.now();
  child = spawn(process.execPath, [SERVE_PATH], { stdio: 'inherit', windowsHide: true });

  child.on('exit', (code, signal) => {
    child = null;
    if (!canRun()) {
      process.exit(0);
    }

    const upMs = Date.now() - startedAt;
    // Alive longer than half a minute - the fall is unrelated to the previous ones, the counter resets.
    if (upMs > 30000) attempt = 0;

    console.log(ruMsg('watch.child_exited', { code, signal, sec: Math.round(upMs / 1000) }));
    const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
    attempt += 1;
    console.log(ruMsg('watch.restart_scheduled', { delay, attempt }));
    setTimeout(launch, delay);
  });

  child.on('error', (err) => {
    child = null;
    console.log(ruMsg('watch.spawn_failed', { reason: err.message }));
    if (!canRun()) process.exit(0);
  });
}

writeSupervisorFile();
console.log(ruMsg('watch.started'));
launch();
