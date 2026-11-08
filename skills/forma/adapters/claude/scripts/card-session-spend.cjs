#!/usr/bin/env node
// Main-session (`Intent`) spend per card - from the logs of the engine whose session did the work.
//
//   node .claude/scripts/card-session-spend.cjs <NNN> [--write] [--from ISO] [--to ISO] [--session <id>] [--idle 300]
//
// Marking the main-session log up by cards. A write event is a Write/Edit of the card file,
// a Bash/PowerShell command writing into the card file (`.devtool/features/card-NNN-*`: sed -i, tee, `>`, Set-Content...),
// or a commit (`git commit` or `node .forma/protocol/scripts/forma-commit.cjs`) with "Card NNN" (the card word matched
// through the i18n dictionary). Every log record goes to the card of the nearest next event (work precedes the
// write); a stretch after another card's event starts with the nearest human remark. No answer is ever
// split between cards.
// The window sums assistant answers: deduplication by the answer key, no subagent logs
// (subagent spend is already in the card - the caller writes their lines from `<usage>`).
// N tokens = tokens_in + cache_write + cache_read + tokens_out (economy.usageTokens); R = cache_read (as with subagents: work = N − R).
// T is active time: the gaps between neighbouring records, each cut off at --idle (seconds, default 300),
//     so the human's waiting does not count in.
// --auto is the SessionEnd hook mode (below, `auto()`): no number, all touches of the session, silent refusal.
// Without --write it prints; with --write it appends a §3-format line to `## History` (call id = session id).
// --from/--to set the window by hand (UTC ISO); --session restricts to one log.
//
// SOURCES - through the engine adapters (the core-adapter boundary, `lib/engines.cjs`): an engine declares
// `mainSessions(root)` (which files are its layout; subagent logs excluded) and `mainStepOf(line, prev)` -
// a normalized step `{ ts, key, usage, toolCalls, human, model }`: time, the answer key for dedup
// (message.id for Claude, requestId for ZCode), the raw usage (parsing is the adapter's `parseUsage`), the answer's
// tool calls, the human-remark flag. The log format (Claude's `message.*`, ZCode rollout's
// `response.*`) does not leak in here: the script knows only the normalized step. The logs of
// all engines of the project are read - work on a card could run in any of them; the engine tag in the line is
// the source's tag. Steps without a key yield no spend: every source with usage has a key.
//
// One session over one card - several lines, each only for the new answers. "Already counted" is decided by
// the window boundary: the exact mark `boundary <ISO>` in the description after the dash (spend-line.cjs,
// sessionWindowEnd) - the time of the last log record that made it into the line. A re-run takes the answers
// strictly after the largest boundary of this session's lines in the card; the sum of N, R and T over the lines
// equals one read of the whole log (a gap across a boundary goes into the new line - anchor records on the
// boundary are not lost). An old-style line without the mark (cumulative, from before this rule) yields a
// boundary from the end of its "window HH:MM-HH:MM UTC" (Cyrillic in the legacy written form, matched through
// \u escapes) to the minute: the end of that minute. Answers in it after the real end of the window fall into
// neither the old line nor the new one.
// Lines with a `--from/--to` window (the mark "set via --from/--to" in the description, in ru as before) do not
// move the boundary, and at a manual window "already counted" does not apply: a human set the window. No new
// spend - nothing is written, exit code 0.

const fs = require('fs');
const path = require('path');
const economy = require('../../.forma/dashboard/economy.cjs');
const { formatSpendLine, sessionWindowEnd } = require('../../.forma/dashboard/spend-line.cjs');
const { makeCli } = require('../../.forma/dashboard/lib/cli.cjs');
const i18n = require('../../.forma/i18n/index.cjs');
// Printed and written labels come from the core dictionary: English key in code, ru value as data - the
// lines the hook prints and writes into cards are the same ru text as before the translation.
const msg = (code, params) => i18n.message(code, params, 'ru');
const { cardFiles, HISTORY_HEADING_RE } = require('../../.forma/dashboard/lib/card.cjs');
// The logs of all engines of the project through their adapters (the core knows no paths).
const engines = require('../../.forma/dashboard/lib/engines.cjs');

const cli = makeCli();
const arg = cli.value;
const AUTO = process.argv.includes('--auto');
let num = process.argv[2] && /^\d{1,4}$/.test(process.argv[2]) ? process.argv[2].padStart(3, '0') : null;
if (!num && !AUTO) { console.error(msg('spend.card-session.need_num')); process.exit(2); }
const WRITE = cli.flag('write');
const IDLE = Number(arg('idle', 300)) * 1000;
const FROM = arg('from') ? Date.parse(arg('from')) : null;
const TO = arg('to') ? Date.parse(arg('to')) : null;
const ONLY = arg('session');
const MANUAL = FROM != null || TO != null;

const root = process.env.CLAUDE_SPEND_ROOT || path.resolve(__dirname, '..', '..');

// The written language of a line - the project's (ru), as in the cards' History lines and LEGACY_WINDOW_RE;
// the readers (i18n.hasPhrase, sessionWindowEnd through i18n.alt) accept both languages.
const MANUAL_MARK = msg('spend.card-session.manual_mark');
// Parser of the legacy written form "window HH:MM-HH:MM UTC" ("window" is Cyrillic in old lines; \u escapes
// keep the source ASCII while the pattern matches the same characters).
const LEGACY_WINDOW_RE = /\u043e\u043a\u043d\u043e \d{2}:\d{2}\u2013(\d{2}):(\d{2}) UTC/;
const LINE_DAY_RE = /(\d{4}-\d{2}-\d{2}):\s*attempt,/;

const ts = (e) => Date.parse(e.ts);

/** Main-session log sources: the own adapter (its environment overrides - trials) first,
 *  then the adapters of all engines of the project; a duplicate by file is dropped. Empty - no logs. */
function sources() {
  const own = require('../forma-adapter.cjs');
  const out = [];
  const seen = new Set();
  const push = (list, isOwn) => {
    for (const s of list || []) {
      if (!s || !s.id || !s.file || seen.has(s.file)) continue;
      seen.add(s.file);
      out.push({
        tag: isOwn ? (own.spendTag || own.engine || own.id) : s.tag,
        id: String(s.id),
        file: s.file,
        stepOf: isOwn ? own.mainStepOf : s.stepOf,
        parseUsage: isOwn ? own.parseUsage : s.parseUsage,
      });
    }
  };
  if (typeof own.mainSessions === 'function' && typeof own.mainStepOf === 'function') push(own.mainSessions(root), true);
  push(engines.mainSessions(root), false);
  return out;
}

/** Normalized records of the `src` log with their place in the file. */
function readRows(file, src) {
  const rows = [];
  let prev = null;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; } // a truncated log line is not a record
    let row = null;
    try { row = src.stepOf(j, prev); } catch { row = null; }
    prev = j;
    if (row) rows.push(row);
  }
  return rows;
}

// A card file in the command: a path or a template with the number (`.devtool/features/card-NNN-*`, including `done/`).
const CARD_PATH_RE = /\.devtool[\\/]features[\\/](?:done[\\/])?card-(\d{3})[-*]/;
// The command writes rather than reads: an in-place edit, tee, PowerShell write cmdlets, a write from a script.
const WRITE_CMD_RE = /\bsed\s+(?:-\w*i|--in-place)|\bperl\s+-\w*i|\btee\b|\b(?:Set|Add|Clear)-Content\b|\bOut-File\b|\b(?:write|append)FileSync\b/;
// Reading a card is not a touch: a write is a `>`/`>>` redirection straight into the card file.
const REDIRECT_TO_CARD_RE = /(?:^|[^>&\d])>{1,2}\s*["']?[^\s"'|&;]*\.devtool[\\/]features[\\/](?:done[\\/])?card-(\d{3})[-*]/;

/** The card into whose file a Bash/PowerShell command writes; no write - null. */
function shellWriteTarget(cmd) {
  const redirect = REDIRECT_TO_CARD_RE.exec(cmd);
  if (redirect) return redirect[1];
  if (!WRITE_CMD_RE.test(cmd)) return null;
  const m = CARD_PATH_RE.exec(cmd);
  return m ? m[1] : null;
}

/** The number of the card a tool call `c` belongs to; none - null. */
function toolOwner(c) {
  const inp = c.input || {};
  const command = String(inp.command || '');
  let m = /[\\/]\.devtool[\\/]features[\\/](?:done[\\/])?card-(\d{3})-/.exec(String(inp.file_path || ''));
  if (m && /^(Write|Edit)$/.test(c.name)) return m[1];
  // A commit: `git commit` directly or through `node .forma/protocol/scripts/forma-commit.cjs`; the number is in the message.
  if ((m = new RegExp('(?:git commit|forma-commit)[\\s\\S]*?(?:' + i18n.alt('hist.card') + ') (\\d{3})', 'i').exec(command))) return m[1];
  if (/^(Bash|PowerShell)$/.test(c.name)) return shellWriteTarget(command);
  // A subagent call on a card - Intent's work on coordinating that card.
  if ((c.name === 'Agent' || c.name === 'Task') && (m = /card-(\d{3})(?!\d)/.exec(String(inp.prompt || '')))) return m[1];
  return null;
}

/** Whose card a log record touches: a Write/Edit or a Bash/PowerShell write of the card file, a "Card NNN" commit (git or forma-commit), a subagent call with `card-NNN` in the assignment. */
function ownerOf(e) {
  if (!Array.isArray(e.toolCalls)) return null;
  for (const c of e.toolCalls) {
    if (!c || typeof c !== 'object') continue;
    const owner = toolOwner(c);
    if (owner) return owner;
  }
  return null;
}

/** The window's records by the card's events: `[{ e, k }]`, k - the place in the log. */
function eventWindow(rows) {
  const ev = [];
  rows.forEach((e, i) => { const c = ownerOf(e); if (c) ev.push({ i, c }); });
  // A stretch of an event - from the first human remark after the previous event up to the event itself:
  // talk without a card write after the last event belongs to nobody.
  const mine = new Set();
  let prev = -1;
  ev.forEach((x, n) => {
    if (x.c === num) {
      let s = prev + 1;
      if (x.c !== (ev[n - 1] || {}).c) while (s < x.i && !rows[s].human) s++;
      for (let k = s; k <= x.i; k++) mine.add(k);
    }
    prev = x.i;
  });
  return rows.map((e, k) => ({ e, k })).filter(({ k }) => mine.has(k));
}

/** The records of a window set by --from/--to. */
const manualWindow = (rows) => rows.map((e, k) => ({ e, k }))
  .filter(({ e }) => ts(e) >= (FROM ?? 0) && ts(e) <= (TO ?? Infinity));

/**
 * The sum of the window over records strictly later than `after` (ms; null - all). One API answer is written
 * into the log by several records with a shared key (`src.stepOf` yields it: message.id for Claude, requestId
 * for ZCode): its spend counts by the first record, else two parallel subagent calls on different cards would
 * carry it twice. Time counts only inside one's own stretches (a gap across another's answer does not count);
 * the gap to the first new record from an anchor record on the boundary goes into the new sum. Nothing to
 * sum - null.
 */
function sumWindow(rows, inWin, after, parse) {
  const isNew = ({ e }) => after == null || ts(e) > after;
  const counted = inWin.filter(isNew);
  if (!counted.length) return null;
  const firstRow = new Map();
  rows.forEach((e, k) => { if (e.key != null && !firstRow.has(e.key)) firstRow.set(e.key, k); });
  const s = Object.assign(economy.emptyUsage(), { active: 0, from: ts(counted[0].e), to: ts(counted[counted.length - 1].e) });
  for (const { e, k } of counted) {
    if (e.usage && e.key != null && firstRow.get(e.key) === k) economy.addUsage(s, parse(e.usage));
  }
  for (let i = 1; i < inWin.length; i++) if (inWin[i].k === inWin[i - 1].k + 1 && isNew(inWin[i]))
    s.active += Math.min(IDLE, Math.max(0, ts(inWin[i].e) - ts(inWin[i - 1].e)));
  return s.calls ? s : null;
}

/** `{ spend, accounted }`: the session's spend over the uncounted; `accounted` - a window exists but everything in it is recorded already. */
function scan(file, src, after) {
  const rows = readRows(file, src);
  const inWin = MANUAL ? manualWindow(rows) : eventWindow(rows);
  if (!inWin.length) return { spend: null, accounted: false };
  const spend = sumWindow(rows, inWin, MANUAL ? null : after, src.parseUsage);
  return { spend, accounted: !spend && after != null && !MANUAL };
}

/** The boundary of a spend line, ms: the exact mark; an old-style line - the end of the minute its window ends at; none - null. */
function lineBoundary(line) {
  const exact = sessionWindowEnd(line);
  if (exact != null) return exact;
  const win = LEGACY_WINDOW_RE.exec(line);
  const day = LINE_DAY_RE.exec(line);
  return win && day ? Date.parse(`${day[1]}T${win[1]}:${win[2]}:59.999Z`) : null;
}

/** Up to what moment the answers of session `id` are recorded in the card already (the largest boundary), ms; no lines - null. */
function accountedUntil(cardText, id) {
  let until = null;
  for (const line of cardText.split(/\r?\n/)) {
    if (!/^-\s/.test(line) || !line.includes('`' + id + '`') || !line.includes('card-session-spend') || i18n.hasPhrase(line, 'manual_window')) continue;
    const at = lineBoundary(line);
    if (at != null && (until == null || at > until)) until = at;
  }
  return until;
}

const sp = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const hm = ms => new Date(ms).toISOString().slice(11, 16);

/** The spend line of a session over window `r` (the description - in the card's language, as before; the tag - the source engine's). */
function spendLine(r) {
  const window = MANUAL ? msg('spend.card-session.window_manual', { from: hm(r.from), to: hm(r.to), mark: MANUAL_MARK }) : msg('spend.card-session.window', { from: hm(r.from), to: hm(r.to) });
  const edge = MANUAL ? '' : msg('spend.card-session.edge', { iso: new Date(r.to).toISOString() });
  return '- ' + formatSpendLine({ node: 'Intent', date: new Date(r.to).toISOString().slice(0, 10), tokens: economy.usageTokens(r),
    cache_read: r.cache_read, tokens_out: r.tokens_out, duration_s: Math.round(r.active / 1000), call_id: r.id, engine: r.tag, desc: '' }) +
    msg('spend.card-session.desc', { calls: r.calls, window, out: sp(r.tokens_out), cache_write: sp(r.cache_write), edge });
}

/** The `--mark-unknown` line: the logs were read, the card's share is not in them - the §3 exception with marks and a reason. */
const unknownLine = (srcs) => {
  const dirs = [...new Set(srcs.map((s) => path.dirname(s.file)))].map((d) => path.basename(d)).join(', ');
  return '- ' + formatSpendLine({ node: 'Intent', date: new Date().toISOString().slice(0, 10), tokens: null,
    cache_read: null, duration_s: 0, call_id: null, engine: require('../forma-adapter.cjs').spendTag, desc: '' }) +
    msg('spend.card-session.unknown_desc', { dirs });
};

/** Appends lines to the end of the card's `## History`. */
function appendToHistory(card, text, lines) {
  const fresh = lines.filter(l => !text.includes(l.split(' — ')[0]));
  if (!fresh.length) { console.log(msg('spend.card-session.already')); return; }
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  const rows = text.split(/\r?\n/);
  const h = rows.findIndex(r => HISTORY_HEADING_RE.test(r));
  if (h < 0) { console.error(msg('spend.card-session.no_history')); if (AUTO) return; process.exit(1); }
  let end = rows.findIndex((r, i) => i > h && /^## /.test(r));
  if (end < 0) end = rows.length;
  while (end > h + 1 && !rows[end - 1].trim()) end--;
  rows.splice(end, 0, ...fresh);
  fs.writeFileSync(card, rows.join(nl));
  console.log(msg('spend.card-session.written', { file: path.relative(root, card), count: fresh.length }));
}

function main() {
  const srcs = sources().filter((s) => !ONLY || s.id.startsWith(ONLY));
  if (!srcs.length) { console.error(msg('spend.card-session.no_dirs')); process.exit(AUTO ? 0 : 2); }
  const card = cardFiles(root, (name) => name.startsWith(`card-${num}-`))[0];
  const text = card ? fs.readFileSync(card, 'utf8') : '';
  const results = [];
  const accounted = [];
  for (const src of srcs) {
    const until = accountedUntil(text, src.id);
    const { spend, accounted: done } = scan(src.file, src, until);
    if (spend) results.push({ id: src.id, tag: src.tag, ...spend });
    else if (done) accounted.push({ id: src.id, until });
  }
  if (!results.length && accounted.length) {
    const last = new Date(Math.max(...accounted.map(a => a.until))).toISOString();
    console.log(msg('spend.card-session.no_new', { num, until: last }));
    return;
  }
  if (!results.length && !cli.flag('mark-unknown')) {
    console.error(msg('spend.card-session.no_touch', { num }));
    process.exit(1);
  }
  const lines = results.length ? results.sort((a, b) => a.from - b.from).map(spendLine) : [unknownLine(srcs)];
  console.log(lines.join('\n'));
  if (!WRITE) return;
  if (!card) { console.error(msg('spend.card-session.no_card_file', { num })); process.exit(1); }
  appendToHistory(card, text, lines);
}

/**
 * `--auto` (the SessionEnd hook): every card Intent touched in this session's log - one line per card
 * for the uncounted answers. The session is the `session_id` from the hook's JSON on stdin, else
 * `--session <id>`, else the freshest log of all sources. Dedup against a manual `card-move
 * --session-spend` and against a second run - the window boundary `boundary <ISO>` in the line's
 * description: the answers strictly after the largest boundary of this session's lines in the card are
 * taken; nothing to write - nothing is written. Any error - exit code 0 (the hook does not block), the
 * reason on stderr.
 */
function auto() {
  let id = ONLY;
  if (!id) { try { id = (JSON.parse(fs.readFileSync(0, 'utf8')) || {}).session_id || null; } catch {} }
  const srcs = sources();
  let src = srcs.find((s) => id && s.id === id);
  if (!src && !id) src = srcs.map((s) => { let st; try { st = fs.statSync(s.file); } catch { return null; } return { s, t: st.mtimeMs }; })
    .filter(Boolean).sort((a, b) => b.t - a.t)[0]?.s;
  if (!src) { console.error(msg('spend.card-session.auto_no_log')); return; }
  const rows = readRows(src.file, src);
  const touched = [...new Set(rows.map(ownerOf).filter(Boolean))].sort();
  for (const n of touched) {
    num = n;
    const card = cardFiles(root, (name) => name.startsWith(`card-${n}-`))[0];
    if (!card) continue;
    const text = fs.readFileSync(card, 'utf8');
    const { spend } = scan(src.file, src, accountedUntil(text, src.id));
    if (!spend) continue;
    appendToHistory(card, text, [spendLine({ id: src.id, tag: src.tag, ...spend })]);
  }
}

if (AUTO) { try { auto(); } catch (e) { console.error('card-session-spend --auto: ' + (e && e.message)); } process.exit(0); }
else main();
