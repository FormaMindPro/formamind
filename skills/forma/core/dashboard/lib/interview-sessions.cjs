'use strict';

/**
 * The brief's interview sessions: the "position -> rounds" map, the page server's liveness, the past run's port.
 * One copy for three: `serve.js` (raises and polls the sessions), `data/interview-files.cjs` (shows them on the tab)
 * and the `forma-grill-with-ui` skill's `server.mjs` (its own server's port and liveness). Part of the core's shared library (`.forma/dashboard/lib/`).
 *
 * The map lives in `project/brief/sessions.json`, not in the dashboard's cache: a session belongs to the conversation
 * with the human, not to a screen, and outlives the cache's demolition. A position's value is the list of round
 * folders, the last one current; a string - the old record form. The service key `__absorbed` (how far each
 * session's events have been carried) is not a position.
 *
 * No dependencies besides the built-in modules and `./fs.cjs`. `server.mjs` is ESM and connects the module by path
 * through `createRequire`, so this stays CommonJS.
 */

const fs = require('fs');
const path = require('path');
const { readJson } = require('./fs.cjs');

const ABSORBED_KEY = '__absorbed';

const sessionsFile = (projectRoot) => path.join(projectRoot, 'project', 'brief', 'sessions.json');

/** The sessions' map; no file or a broken one - `{}`: the interview has not been opened yet. */
const readSessions = (projectRoot) => readJson(sessionsFile(projectRoot), {});

/** Writing the map whole; the brief's directory is created when absent. */
function writeSessions(projectRoot, all) {
  const file = sessionsFile(projectRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(all, null, 2), 'utf8');
}

/** A position's rounds in order; the last one current. A string - the old record form. */
const sessionList = (v) => (Array.isArray(v) ? v : v ? [v] : []);

const currentSession = (v) => sessionList(v).slice(-1)[0] || null;

/** The map's positions with their rounds; the service key skipped. `[{ position, dirs }]`. */
function positionSessions(projectRoot) {
  return Object.entries(readSessions(projectRoot))
    .filter(([pos]) => pos !== ABSORBED_KEY)
    .map(([pos, raw]) => ({ position: Number(pos), dirs: sessionList(raw) }));
}

/** The number of the session's last carried event; nothing carried - 0. */
const readAbsorbedSeq = (projectRoot, session) => Number((readSessions(projectRoot)[ABSORBED_KEY] || {})[session]) || 0;

function writeAbsorbedSeq(projectRoot, session, seq) {
  const all = readSessions(projectRoot);
  all[ABSORBED_KEY] = all[ABSORBED_KEY] || {};
  all[ABSORBED_KEY][session] = seq;
  writeSessions(projectRoot, all);
}

/** Whether the process is alive. Without a pid - no: `process.kill(0, 0)` would mean a process group, not this server. */
function alive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/**
 * The session page server's address and liveness - by its `server.json`. Liveness - by the pid, not by the file's
 * presence: the file stays on disk after the process died, and trusting it would mean showing an address nobody is at.
 * The server never came up - `{ url: null, alive: false }`.
 */
function serverOf(dir) {
  const srv = readJson(path.join(dir, 'server.json'), null);
  if (srv === null) return { url: null, alive: false };
  return { url: srv.url || null, alive: alive(srv.pid) };
}

/**
 * The past run's port - from `server.json` `{ port, pid, started }`. No file or no valid number - 0
 * (the "nothing remembered" signal: the caller will substitute its own default port or an ephemeral one).
 */
function rememberedPort(serverFile) {
  const p = Number((readJson(serverFile, null) || {}).port);
  return Number.isInteger(p) && p > 0 ? p : 0;
}

module.exports = {
  ABSORBED_KEY, sessionsFile, readSessions, writeSessions, sessionList, currentSession,
  positionSessions, readAbsorbedSeq, writeAbsorbedSeq, alive, serverOf, rememberedPort,
};
