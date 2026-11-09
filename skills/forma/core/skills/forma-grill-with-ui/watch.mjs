#!/usr/bin/env node
// Watching a session in a way that does not die after the first event.
//
// `server.mjs wait` returns one event and exits. Under a background watcher that means:
// an answer arrives - the watching is over, and the human's next answer goes into silence.
// Unnoticeable exactly until the moment the agent gets distracted by work - and it always does,
// because parsing the answer is its very work. The human then sees a boundless
// "waiting for the agent" and cannot tell an absence from a breakage.
//
// Here the watching lives as long as the monitor lives, and reports everything that changes the picture:
// every new event, and the server's death. Silence then means exactly one thing -
// nothing happened.
//
//   node watch.mjs --session <dir> [--after N]
import fs from 'node:fs';
import path from 'node:path';
import i18n from '../../i18n/index.cjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const dir = arg('--session');
const root = arg('--root');
if (!dir && !root) { console.error(i18n.message('grill.need_session_or_root', null, 'ru')); process.exit(2); }
let after = Number(arg('--after', 0)) || 0;

// In --root mode each session has its own counter: the event numbers in them are independent.
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

// What exactly arrived, one line: the event type, the number and what was answered. The full
// text lives in events.jsonl - dragging it here means putting the agent to sleep with bytes.
const describe = (e) => {
  const kinds = {};
  for (const a of e.actions || []) kinds[a.type] = (kinds[a.type] || 0) + 1;
  const qs = [...new Set((e.actions || []).map((a) => a.q).filter(Boolean))];
  const bits = Object.entries(kinds).map(([k, n]) => (n > 1 ? `${k}×${n}` : k)).join(', ');
  return i18n.message('grill.event_line', { seq: e.seq, what: (bits || e.type) + (qs.length ? ' · ' + qs.join(' ') : '') }, 'ru');
};

const serverAlive = (d) => {
  try {
    const pid = JSON.parse(fs.readFileSync(path.join(d, 'server.json'), 'utf8')).pid;
    if (!pid) return true; // nothing to check against - no invented alarm
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e && e.code === 'EPERM'; // alive, but someone else's
  }
};

console.log(dir
  ? i18n.message('grill.watch_one', { name: path.basename(dir), after }, 'ru')
  : i18n.message('grill.watch_all', { name: path.basename(root) }, 'ru'));

// In --root mode the already-stored events are not retold: the monitor is set up to learn
// about the new, and dumping the whole past conversation onto the agent is noise.
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
  // One named session ended together with its server. In --root mode
  // one session's death means nothing: the others live, and new ones are still coming.
  if (dir && !serverAlive(dir)) {
    console.log(i18n.message('grill.server_stopped', null, 'ru'));
    process.exit(0);
  }
};

tick();
setInterval(tick, 1000);
