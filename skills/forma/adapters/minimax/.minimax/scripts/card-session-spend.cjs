'use strict';

/**
 * The writer of the main-session spend line of the MiniMax Code engine.
 *
 * The contract - by `.claude/scripts/card-session-spend.cjs` and `.forma/manual/ru/03-protocol/ECONOMY.md`:
 *   N - the full spend of a call, INCLUDING the cache-read: N = tokens_in + cache_write + cache_read + tokens_out;
 *   R - cache-read; O - output; T - active time; the call id - the session id; the tag - from the adapter (`spendTag`).
 *   The formatter is shared: `.forma/dashboard/spend-line.cjs`.
 *
 * The differences from the Claude version, and why:
 *   - The MiniMax runtime transcript writes ONE API answer as one record (`message_id` + `message.usage`),
 *     whereas the Claude journal duplicates one answer into blocks per tool call. So the deduplication
 *     by `message_id` here is a safety net, not a necessity.
 *   - The sessions sit in the runtime's shared storage (`~/.minimax/v2/sessions`), not in a project folder:
 *     the binding to a project goes by the card path inside a session leading into this project's root.
 *   - The card's material lives in `project/cards/card-NNN/` (§6), so it counts as a card touch too.
 *
 * One session over one card is written by several lines - each only for the new answers.
 * "Already counted" is decided by the window boundary: the mark `boundary <ISO>` in the description after
 * the dash (`spend-line.cjs`, `sessionWindowEnd`). A re-run takes the answers strictly after the largest boundary.
 *
 * Run:
 *   node .minimax/scripts/card-session-spend.cjs <NNN>            # prints the line
 *   node .minimax/scripts/card-session-spend.cjs <NNN> --write    # appends to the card's `## History`
 *   node .minimax/scripts/card-session-spend.cjs <NNN> --session <id> --idle 300 --from <ISO> --to <ISO>
 *
 * Without --write nothing is written: the command only counts and prints.
 */

const fs = require('fs');
const path = require('path');
const { formatSpendLine, sessionWindowEnd } = require('../../.forma/dashboard/spend-line.cjs');
const reader = require('../../miniapps/minimax-engine/scripts/transcripts.cjs');
const adapter = require('../forma-adapter.cjs');
// Printed and written labels come from the core dictionary: English key in code, ru value as data -
// the lines the command prints and writes into cards are the same ru text as before the translation.
const i18n = require('../../.forma/i18n/index.cjs');
const msg = (code, params) => i18n.message(code, params, 'ru');

const ROOT = path.resolve(__dirname, '..', '..');
const IDLE_DEFAULT = 300;

// The card path on the board and its material (§6).
const CARD_PATH_RE = /[\\/]\.devtool[\\/]features[\\/](?:done[\\/])?card-(\d{3})-/;
const CARD_MATERIAL_RE = /[\\/]project[\\/]cards[\\/]card-(\d{3})[\\/]/;
// The mark of a file write from the command line.
const WRITE_CMD_RE = /(writeFileSync|appendFileSync|Set-Content|Out-File|Add-Content|>\s*['"]?[^|]*\.(md|cjs|json)|tee\b)/i;

const argv = process.argv.slice(2);
const flag = (name) => argv.includes('--' + name);
const opt = (name) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
};

const CARD_ARG = (argv.find((a) => /^\d{3}$/.test(a)) || (argv.find((a) => /^card-\d{3}$/.test(a)) || '')).replace(/^card-/, '');
const MANUAL = !!(opt('from') || opt('to'));
const FROM = opt('from') ? Date.parse(opt('from')) : null;
const TO = opt('to') ? Date.parse(opt('to')) : null;
// The "already counted" boundary set by a human: the answers strictly after it. Needed when the card
// holds a line of this session without the `boundary` mark (the old form) - else the count doubles.
const AFTER = opt('after') ? Date.parse(opt('after')) : null;
const IDLE = Number(opt('idle')) || IDLE_DEFAULT;
const ONLY_SESSION = opt('session');

// The ru heading of the card's History zone, as before the translation: the label is dictionary data
// (keys.json), not a literal in the code.
const HISTORY_HEADING = '\n## ' + i18n.KEYS.labels['zone.history'].ru[0];

const sp = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const hm = (ms) => new Date(ms).toISOString().slice(11, 16);

/** The card file on the board: `.devtool/features/card-NNN-*.md`. */
function cardFile(num) {
  for (const dir of [path.join(ROOT, '.devtool', 'features'), path.join(ROOT, '.devtool', 'features', 'done')]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith(`card-${num}-`) && f.endsWith('.md')) return path.join(dir, f);
    }
  }
  return null;
}

/** The runtime sessions with their transcript files. */
function allSessions() {
  const out = [];
  const root = reader.sessionsRoot();
  if (!root || !fs.existsSync(root)) return out;
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (!e.isDirectory()) continue;
      const mf = path.join(p, 'messages.jsonl');
      if (fs.existsSync(mf)) {
        const manifest = path.join(p, 'manifest.json');
        let id = path.basename(p);
        try {
          id = JSON.parse(fs.readFileSync(manifest, 'utf8')).sessionId || id;
        } catch {}
        out.push({ id, file: mf });
      } else {
        walk(p);
      }
    }
  };
  walk(root);
  return out;
}

/** The transcript lines: assistant answers with spend and the human's remarks. */
function readRows(file) {
  const rows = [];
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return rows;
  }
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const m = e.message;
    if (!m || !m.role) continue;
    const ts = Number(m.timestamp || 0);
    if (m.role === 'assistant') {
      rows.push({ type: 'assistant', id: e.message_id || null, ts, usage: m.usage || null, content: Array.isArray(m.content) ? m.content : [] });
    } else if (m.role === 'user') {
      rows.push({ type: 'user', id: e.message_id || null, ts, usage: null, content: [] });
    }
  }
  return rows;
}

/** Whose card a tool call touches; none - null. */
function toolOwner(call) {
  const args = call.arguments || {};
  const name = String(call.name || '');
  let m = CARD_PATH_RE.exec(String(args.file_path || args.path || ''));
  if (m && /^(write|edit)$/i.test(name)) return m[1];
  m = CARD_MATERIAL_RE.exec(String(args.file_path || args.path || ''));
  if (m && /^(write|edit)$/i.test(name)) return m[1];
  const command = String(args.command || '');
  if (/^(bash|shell|powershell)$/i.test(name) || command) {
    if (/[\\/]\.devtool[\\/]features[\\/](?:done[\\/])?card-(\d{3})-/.test(command) || /[\\/]project[\\/]cards[\\/]card-(\d{3})[\\/]/.test(command)) {
      if (WRITE_CMD_RE.test(command)) {
        const hit = CARD_PATH_RE.exec(command) || CARD_MATERIAL_RE.exec(command);
        if (hit) return hit[1];
      }
    }
    // The "Card NNN" wording of a commit message (Cyrillic in the written form; \u escapes keep the
    // source ASCII while the pattern matches the same characters).
    if ((m = /(?:git commit|forma-commit)[\s\S]*?[\u041a\u043a]\u0430\u0440\u0442\u043e\u0447\u043a[\u0430\u0438] (\d{3})/.exec(command))) return m[1];
  }
  // A subagent call on a card - Intent's work on coordinating that card.
  if (/^task$/i.test(name) && (m = /card-(\d{3})(?!\d)/.exec(String(args.prompt || '')))) return m[1];
  return null;
}

/** The card an answer belongs to: the first touching card found. */
function ownerOf(row) {
  if (row.type !== 'assistant') return null;
  for (const b of row.content) {
    if (!b || b.type !== 'toolCall') continue;
    const owner = toolOwner(b);
    if (owner) return owner;
  }
  return null;
}

/** Does the answer touch the project: a path leads into this project's root. */
function touchesProject(row) {
  for (const b of row.content || []) {
    if (!b || b.type !== 'toolCall') continue;
    const args = b.arguments || {};
    for (const v of [args.path, args.file_path, args.command, args.prompt]) {
      if (typeof v === 'string' && v.includes(ROOT)) return true;
    }
  }
  return false;
}

/** The window's records by the card's events: from the human remark after the past event up to the event itself. */
function eventWindow(rows, num) {
  const ev = [];
  rows.forEach((e, i) => {
    const c = ownerOf(e);
    if (c) ev.push({ i, c });
  });
  const mine = new Set();
  let prev = -1;
  ev.forEach((x, n) => {
    if (x.c === num) {
      let s = prev + 1;
      if (x.c !== (ev[n - 1] || {}).c) while (s < x.i && rows[s].type !== 'user') s++;
      for (let k = s; k <= x.i; k++) mine.add(k);
    }
    prev = x.i;
  });
  return rows.map((e, k) => ({ e, k })).filter(({ k }) => mine.has(k));
}

/** The records of a window set by --from/--to. */
const manualWindow = (rows) =>
  rows.map((e, k) => ({ e, k })).filter(({ e }) => e.ts >= (FROM ?? 0) && e.ts <= (TO ?? Infinity));

/** The sum of the window over the answers strictly later than `after` (ms; null - all). */
function sumWindow(rows, inWin, after) {
  const isNew = ({ e }) => after == null || e.ts > after;
  const counted = inWin.filter(isNew);
  if (!counted.length) return null;
  const firstRow = new Map();
  rows.forEach((e, k) => {
    if (e.type === 'assistant' && e.id && !firstRow.has(e.id)) firstRow.set(e.id, k);
  });
  const s = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, active: 0, calls: 0, from: counted[0].e.ts, to: counted[counted.length - 1].e.ts };
  for (const { e, k } of counted) {
    if (e.type !== 'assistant' || !e.usage) continue;
    if (e.id && firstRow.get(e.id) !== k) continue;
    s.input += e.usage.input || 0;
    s.output += e.usage.output || 0;
    s.cacheRead += e.usage.cacheRead || 0;
    s.cacheWrite += e.usage.cacheWrite || 0;
    s.calls += 1;
  }
  for (let i = 1; i < inWin.length; i++) {
    if (inWin[i].k !== inWin[i - 1].k + 1 || !isNew(inWin[i])) continue;
    s.active += Math.min(IDLE * 1000, Math.max(0, inWin[i].e.ts - inWin[i - 1].e.ts));
  }
  return s.calls ? s : null;
}

/** Up to what moment the answers of session `id` are recorded in the card already (the largest boundary), ms. */
function accountedUntil(cardText, id) {
  let until = null;
  for (const line of cardText.split(/\r?\n/)) {
    if (!/^-\s/.test(line) || !line.includes('`' + id + '`') || !line.includes('card-session-spend')) continue;
    const at = sessionWindowEnd(line);
    if (at != null && (until == null || at > until)) until = at;
  }
  return until;
}

/** This session's lines in the card without a boundary mark: their window the command does not know - a double count is possible. */
function linesWithoutBoundary(cardText, id) {
  let n = 0;
  for (const line of cardText.split(/\r?\n/)) {
    if (!/^-\s/.test(line) || !line.includes('`' + id + '`')) continue;
    if (sessionWindowEnd(line) == null) n += 1;
  }
  return n;
}

/** The spend line of a session over window `r`. */
function spendLine(r) {
  const N = r.input + r.cacheWrite + r.cacheRead + r.output;
  const window = msg('spend.card-session.window', { from: hm(r.from), to: hm(r.to) });
  const edge = MANUAL ? '' : msg('spend.card-session.edge', { iso: new Date(r.to).toISOString() });
  return (
    '- ' +
    formatSpendLine({
      node: 'Intent',
      date: new Date(r.to).toISOString().slice(0, 10),
      tokens: N,
      cache_read: r.cacheRead,
      tokens_out: r.output,
      duration_s: Math.round(r.active / 1000),
      call_id: r.id,
      engine: adapter.spendTag,
      desc: '',
    }) +
    msg('spend.minimax-session.desc', { calls: r.calls, window, out: sp(r.output), cache_write: sp(r.cacheWrite), edge })
  );
}

/** Append the line to the end of the card's `## History` zone. */
function appendHistory(cardFilePath, line) {
  const text = fs.readFileSync(cardFilePath, 'utf8');
  const heading = text.indexOf(HISTORY_HEADING);
  if (heading === -1) {
    // No zone - create it at the end of the file, not before the first heading.
    fs.writeFileSync(cardFilePath, text.replace(/\s+$/, '') + '\n' + HISTORY_HEADING + '\n- ' + line + '\n', 'utf8');
    return;
  }
  const bodyStart = heading + HISTORY_HEADING.length;
  const nextHeading = text.indexOf('\n## ', bodyStart);
  const body = text.slice(bodyStart, nextHeading === -1 ? text.length : nextHeading).replace(/\s+$/, '');
  const tail = nextHeading === -1 ? '\n' : text.slice(nextHeading);
  // The line already starts with "- " (that is how `spendLine` prints it) - no extra dash is added.
  fs.writeFileSync(cardFilePath, text.slice(0, bodyStart) + body + '\n' + line + '\n' + tail, 'utf8');
}

function main() {
  if (!CARD_ARG) {
    console.log('usage: card-session-spend.cjs <NNN> [--write] [--session <id>] [--idle 300] [--from ISO] [--to ISO]');
    process.exit(2);
  }
  const file = cardFile(CARD_ARG);
  if (!file) {
    console.log(msg('spend.minimax-session.card_missing', { num: CARD_ARG }));
    process.exit(1);
  }
  let cardText = fs.readFileSync(file, 'utf8');
  const sessions = ONLY_SESSION ? allSessions().filter((s) => s.id === ONLY_SESSION) : allSessions();

  let written = 0;
  for (const s of sessions) {
    const rows = readRows(s.file);
    if (!rows.length) continue;
    const inWin = MANUAL ? manualWindow(rows) : eventWindow(rows, CARD_ARG);
    if (!inWin.length) continue;
    // The session belongs to this project if at least one of its card touches leads into the project root.
    if (!rows.some(touchesProject)) continue;
    const after = MANUAL ? null : (AFTER != null ? Math.max(AFTER, accountedUntil(cardText, s.id) ?? -Infinity) : accountedUntil(cardText, s.id));
    if (AFTER == null && !MANUAL && linesWithoutBoundary(cardText, s.id) > 0) {
      console.error(msg('spend.minimax-session.boundary_warning'));
    }
    const spend = sumWindow(rows, inWin, after);
    if (!spend) continue;
    const line = spendLine({ ...spend, id: s.id });
    console.log(line);
    if (flag('write')) {
      appendHistory(file, line);
      cardText = fs.readFileSync(file, 'utf8');
      written += 1;
    }
  }
  if (flag('write')) console.log(msg('spend.minimax-session.written_count', { count: written }));
  else if (!written) console.log(msg('spend.minimax-session.no_new'));
}

if (require.main === module) main();

module.exports = { readRows, toolOwner, ownerOf, eventWindow, sumWindow, spendLine, cardFile, allSessions };
