#!/usr/bin/env node
// The watching of a session that does not die after the first event.
//
// `server.mjs wait` returns one event and exits. Under a background watcher that means:
// an answer arrived - the watching is over, and the human's next answer goes into silence.
// Unnoticeable exactly until the moment the agent got distracted into work - and it gets
// distracted always, because parsing the answer is its work. The human at that time sees
// "waiting for the agent" without a limit and cannot tell an absence from a breakage.
//
// Here the watching lives as long as the monitor lives, and reports everything that changes the situation:
// every new event, and the death of the server. Silence then means exactly one thing -
// nothing happened.
//
//   node watch.mjs --session <dir> [--after N]
//
// Printed labels come from the core dictionary: English key in code, ru value as data.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// The core dictionary found upward from this file (the skill's depth differs per engine); none - the keys themselves.
const findI18n = () => {
  for (let d = import.meta.dirname; ; d = path.dirname(d)) {
    for (const rel of ['skills/forma/core/i18n/index.cjs', '.forma/i18n/index.cjs']) {
      const f = path.join(d, rel);
      if (fs.existsSync(f)) return f;
    }
    if (path.dirname(d) === d) return null;
  }
};
const i18nFile = findI18n();
const msg = (code, params) => i18nFile
  ? createRequire(import.meta.url)(i18nFile).message(code, params, 'ru')
  : code;

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const dir = arg('--session');
const root = arg('--root');
if (!dir && !root) { console.error(msg('grill.need_session_or_root')); process.exit(2); }
let after = Number(arg('--after', 0)) || 0;

// In the --root mode every session has its own counter: the event numbers in them are independent.
const seenBySession = new Map();
const sessionDirs = () => {
  if (dir) return [dir];
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && fs.existsSync(path.join(root, e.name, 'events.jsonl')))
      .map((e) => path.join(root, e.name));
  } catch { return []; }
};

const readEvents = (d) => {
  try {
    return fs.readFileSync(path.join(d, 'events.jsonl'), 'utf8').split(/\r?\n/).filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
};

// What exactly arrived, in one line: the event's type, the number and what was answered by. The full
// text lies in events.jsonl - dragging it here means lulling the agent with bytes.
const describe = (e) => {
  const kinds = {};
  for (const a of e.actions || []) kinds[a.type] = (kinds[a.type] || 0) + 1;
  const qs = [...new Set((e.actions || []).map((a) => a.q).filter(Boolean))];
  const bits = Object.entries(kinds).map(([k, n]) => (n > 1 ? `${k}×${n}` : k)).join(', ');
  return msg('grill.event_line', { seq: e.seq, what: bits || e.type }) + (qs.length ? ' · ' + qs.join(' ') : '');
};

const serverAlive = (d) => {
  try {
    const pid = JSON.parse(fs.readFileSync(path.join(d, 'server.json'), 'utf8')).pid;
    if (!pid) return true; // nothing to check with - no alarm is invented
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e && e.code === 'EPERM'; // alive, but someone else's
  }
};

console.log(dir
  ? msg('grill.watch_one', { name: path.basename(dir), after })
  : msg('grill.watch_all', { name: path.basename(root) }));

// In the --root mode the already-lying events are not retold: the monitor is started to
// learn about the new; unloading the whole past conversation onto the agent - that is noise.
if (root) for (const d of sessionDirs()) {
  seenBySession.set(d, Math.max(0, ...readEvents(d).map((e) => Number(e.seq) || 0)));
}

const tick = () => {
  const dirs = sessionDirs();
  for (const d of dirs) {
    const seen = dir ? after : (seenBySession.has(d) ? seenBySession.get(d) : 0);
    let last = seen;
    for (const e of readEvents(d)) {
      if (!e.seq || e.seq <= seen) continue;
      last = Math.max(last, e.seq);
      console.log((dir ? '' : path.basename(d) + ' · ') + describe(e));
    }
    if (dir) after = last; else seenBySession.set(d, last);
  }
  // One named session is over together with its server. In the --root mode
  // the death of one session means nothing: the others live, and new ones are still to come.
  if (dir && !serverAlive(dir)) {
    console.log(msg('grill.server_stopped'));
    process.exit(0);
  }
};

tick();
setInterval(tick, 1000);
