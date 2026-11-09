#!/usr/bin/env node
// A one-shot check: is THIS project's dashboard alive. If not - it raises the supervisor
// (watch.js, which then watches serve.js itself and restarts it on a fall)
// entirely in the background, detached - it outlives this process's exit and the exit
// of the session that called it.
//
// The dashboard's port is dynamic (serve.js: the remembered port -> on business an ephemeral
// one from the OS, the `kit.md` task "a dynamic port for the dashboard"), so liveness is checked
// not by a hardcoded constant but by the fact in .forma/dashboard/.cache/server.json - the same
// file serve.js itself writes on its own listening ({url, port, pid, started}).
// The deciding fact is not only the port but also the pid: the server file may have gone stale
// (the past run's process no longer exists), and its port may point nowhere or, worse, at a
// foreign process that happens to listen there. A live pid + an HTTP answer on the recorded port -
// only then is the file trusted; otherwise this project's dashboard counts as not alive and its own
// is started (serve.js will choose the port).
//
// Safe to call repeatedly (idempotent): if the dashboard is already alive - it does nothing and
// breeds no second servers. Called from the SessionStart hook (the session-start hook in the
// adapter directory) and can be called by hand:
//   node .forma/dashboard/ensure-running.js

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
// Canonical ru strings of the console output live in the core dictionary; the language is fixed.
const { message: coreMessage } = require('../i18n/index.cjs');
const ruMsg = (key, params) => coreMessage(key, params, 'ru');

const { DEFAULT_PORT } = require('./port.cjs');
const TIMEOUT_MS = 800;
const WATCH_PATH = path.join(__dirname, 'watch.js');
const CACHE_DIR = path.join(__dirname, '.cache');
const LOG_FILE = path.join(CACHE_DIR, 'watch.log');
const SERVER_FILE = path.join(CACHE_DIR, 'server.json');
const SUPERVISOR_FILE = path.join(CACHE_DIR, 'supervisor.json');

// process.kill(pid, 0) sends no signal - the standard way to learn whether the process exists,
// without side effects. ESRCH - there is no process (a stale file); EPERM - the process exists,
// but there is no right to signal it (also "alive", just not our user/privileges).
function pidAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (err) { return err.code === 'EPERM'; }
}

function readSupervisorFile() {
  try {
    const info = JSON.parse(fs.readFileSync(SUPERVISOR_FILE, 'utf8'));
    const pid = Number(info.pid);
    if (Number.isInteger(pid) && pid > 0) return { pid };
  } catch {
    return null;
  }
  return null;
}

function readServerFile() {
  try {
    const info = JSON.parse(fs.readFileSync(SERVER_FILE, 'utf8'));
    const port = Number(info.port);
    const pid = Number(info.pid);
    if (!Number.isInteger(port) || port <= 0 || !Number.isInteger(pid) || pid <= 0) return null;
    return { port, pid };
  } catch {
    return null; // the file is absent, or broken/unfinished (a race with serve.js's writing) - not a deciding fact
  }
}

function httpAlive(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: 'localhost', port, path: '/data.json', timeout: TIMEOUT_MS }, (res) => {
      res.resume();
      resolve(res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

// Returns { alive, port } - port is the one liveness was really checked on (or by the old default),
// so that it can be written about honestly further on.
async function checkAlive() {
  const info = readServerFile();
  if (info && pidAlive(info.pid)) {
    return { alive: await httpAlive(info.port), port: info.port };
  }
  // No file, it is broken, or the recorded pid no longer exists (stale, from the past run):
  // this project's dashboard is not alive. The default port 5050 is not checked - another
  // project's dashboard may answer there, and taking it for one's own means not raising one's own.
  return { alive: false, port: DEFAULT_PORT };
}

async function main() {
  const { alive, port } = await checkAlive();
  if (alive) {
    console.log(ruMsg('ensure.already_running', { port }));
    return;
  }

  const sup = readSupervisorFile();
  if (sup && pidAlive(sup.pid)) {
    console.log(ruMsg('ensure.supervisor_up', { pid: sup.pid, log: path.relative(process.cwd(), LOG_FILE) }));
    return;
  }

  console.log(ruMsg('ensure.not_responding'));
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const out = fs.openSync(LOG_FILE, 'a');
  const child = spawn(process.execPath, [WATCH_PATH], {
    detached: true,
    stdio: ['ignore', out, out],
    windowsHide: true,
  });
  child.unref();
  console.log(ruMsg('ensure.supervisor_up', { pid: child.pid, log: path.relative(process.cwd(), LOG_FILE) }));
  // The new run's port is decided by serve.js itself (the same dynamic choice) - not always 5050,
  // if it is busy. The exact address - .forma/dashboard/.cache/server.json in a couple of seconds.
  console.log(ruMsg('ensure.eta', { port: DEFAULT_PORT }));
}

main();
