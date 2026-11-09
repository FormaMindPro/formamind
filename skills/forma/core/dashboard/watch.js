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
// Canonical ru strings of the console output live in the core dictionary; the language is fixed.
const { message: coreMessage } = require('../i18n/index.cjs');
const ruMsg = (key, params) => coreMessage(key, params, 'ru');

const SERVE_PATH = path.join(__dirname, 'serve.js');
// The growing pause between consecutive restarts - protection against a loop of instant falls
// (say, the port taken by another process): it does not load the machine with senseless
// once-a-second attempts.
const BACKOFF_MS = [500, 1000, 2000, 5000, 10000, 30000];
let attempt = 0;

function launch() {
  const startedAt = Date.now();
  const child = spawn(process.execPath, [SERVE_PATH], { stdio: 'inherit', windowsHide: true });

  child.on('exit', (code, signal) => {
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
    console.log(ruMsg('watch.spawn_failed', { reason: err.message }));
  });
}

console.log(ruMsg('watch.started'));
launch();
