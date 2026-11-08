#!/usr/bin/env node
'use strict';

/**
 * human-row-trace - the gate of the visible trace of the route table's "human" row (§2, fail-closed): the stop line
 * to the human in a card's History must carry the code of the trace card - a card of the protocol epic awaiting
 * a decision (backlog status, the awaiting-decision flag; the human-row-trace rule, card-and-board.md after §7). An
 * ordinary record stays where it was; the trace card keeps the finding from vanishing if its goal closes earlier.
 * No model calls: the status by the exit code, the findings - in stdout; consumers - the Intent node at
 * the card check and check-board.
 *
 *   node .forma/board/checks/human-row-trace.cjs --board [--root <dir>]   (a board scan: live cards + done/)
 *   node .forma/board/checks/human-row-trace.cjs --selftest               (probes into the OS temp directory)
 *
 * The convention (the stop-line dictionary is shared with budget-stop.cjs - its header holds the convention; the
 * regexes are duplicated locally so the checker stands alone; a dictionary update - edit both headers):
 *   1. The stop line (History): the line's description opens with the word stop (right behind the date) and
 *      names a threshold - the line has a budget/threshold/attempt word and a digit.
 *      A spend line (`attempt, …`) and the word stop inside a description do not count as a stop. The stop line
 *      is judged by the original line - as in budget-stop (the gate is fail-closed: the stop is caught by the whole line).
 *   2. The trace: the stop line names a card code card-NNN - adjacency: the code is searched in the same line, not in
 *      the rest of the card. Citation strictness (as in budget-stop.cjs): quotes («…», "…",
 *      `…`) and illustration parentheses after the caught/finding/quote/quoting/example words are cut out before
 *      the code search - a code from a quote or an illustration does not count as a trace. One named code suffices,
 *      the one deciding the trace; the other named codes - the line's context.
 *   3. The trace card: the named code must point to a board card (live + done/) with the backlog status
 *      (the awaiting-decision flag) and an epic - the protocol lane: the label is read from the epic table of
 *      PROJECT.md by the protocol code (one of the nine goal kinds, as in epics.cjs; the project language is not hardwired).
 *
 * Verdict: RED if (i) the stop line has not a single card code outside quotes; (ii) the named code
 * is not found on the board; (iii) the found card is not backlog; (iv) its epic is not the protocol lane.
 * Cards without stop lines are not judged. Not recognizable mechanically: the completeness of the stop dictionary
 * (the threshold, who stopped, the decision) - part of the human's verdict at acceptance. The exception path (as in
 * budget-stop): a line
 *   - `Node`, YYYY-MM-DD: exception: … human-row-trace …
 * in this same card's History - the card's findings are skipped with an explicit mark; the human decides.
 *
 * Exit codes: 0 - green; 1 - RED (a stop without a trace: no code, the code is not found, not backlog,
 * not the protocol epic); 2 - a runtime error (the self-probe mismatched, the board directory or the epic table
 * of PROJECT.md is unreadable).
 * Module: require('./human-row-trace.cjs') → { id: 'human-row-trace', since: null, run, runBoard,
 * selftest, isStopLine, codesOf, protocolLane } - the form of the checks registry; inclusion by one line in
 * index.cjs - the accepting node's decision, by default the gate is called explicitly (--board).
 * Part of the core: carries no project traces (prohibition 16; fixture card codes are assembled in runtime -
 * no card-NNN-like literals in the body, the recognition regexes untouched; no dates in the body).
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const i18n = require('../../i18n/index.cjs');
const { cardFiles, zone, parseFrontmatter } = require('../../dashboard/lib/card.cjs');

// The stop-line dictionary - shared with budget-stop.cjs (its header holds the convention); duplicated,
// so the checker stands alone. A dictionary update - edit both headers. The words are labels of the
// dictionary (keys.json), not literals of the code: Russian cards stop with the Russian stems.
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const stemsOf = (key, lang) => ((i18n.KEYS.labels[key] || {})[lang] || []).map(escapeRe);
// An English stem ends at a word boundary; a Russian stem matches as a prefix (any ending follows).
const EN_STOPS = stemsOf('term.stop', 'en').map((s) => s + '\\b');
const RU_STOPS = stemsOf('term.stop', 'ru');
const STOP_HEAD_RE = new RegExp('^-\\s*`[^`]+`,\\s*\\d{4}-\\d{2}-\\d{2}:\\s*(?:' + EN_STOPS.join('|') + '|' + RU_STOPS.join('|') + ')', 'i');
const THRESHOLDS = stemsOf('term.threshold', 'en').concat(stemsOf('term.threshold', 'ru'));
const STOP_THRESHOLD_RE = new RegExp('(?:' + THRESHOLDS.join('|') + ')', 'i');
const QUOTE_RE = /«[^»]*»|"[^"]*"|`[^`]*`/g;
const ILLUSTRATIONS = stemsOf('term.illustration', 'en').concat(stemsOf('term.illustration', 'ru'));
const ILLUSTRATION_RE = new RegExp('(?:' + ILLUSTRATIONS.join('|') + ')\\w*[^\\n()«"»]{0,40}?\\([^()]*\\)', 'gi');
const CODE_RE = /\bcard-(\d+)\b/gi;
const EXCEPTION_RE = /^-\s*`[^`]+`,\s*\d{4}-\d{2}-\d{2}:\s*exception:[^\n]*human-row-trace/i;
const PROTOCOL_CODE = 'protocol';
const PROJECT_REL = 'project/config/PROJECT.md';
const msg = (key, params) => i18n.message(key, params, 'ru');

const err = (m) => Object.assign(new Error(m), { exitCode: 2 });

/**
 * Citation strictness: quotes («…», "…", `…`) and illustration parentheses after the caught/finding/
 * quote/quoting/example words are cut out before the trace-code search - a code from a quote in prose and an
 * illustration of a catch is not a trace. The order - as in budget-stop.cjs: quotes → illustrations → quotes.
 * The recognition of the stop line stays by the original line - the cutting concerns the code search only.
 */
function stripQuoted(line) {
  const q1 = String(line).replace(QUOTE_RE, ' ');
  const q2 = q1.replace(ILLUSTRATION_RE, ' ');
  return q2.replace(QUOTE_RE, ' ');
}

/** Event lines of the card's History zone; no zone - empty (as in budget-stop). */
function historyLines(text) {
  const history = zone(text, 'history');
  if (!history) return [];
  return history.split(/\r?\n/).filter((l) => /^\s*-\s/.test(l));
}

/** A stop line: the description opens with the stop word, a threshold is named (a word + a digit); by the original line. */
function isStopLine(line) {
  return STOP_HEAD_RE.test(line) && STOP_THRESHOLD_RE.test(line) && /\d/.test(line);
}

/** The named card codes of a stop line (outside quotes and illustration parentheses), in order, without repeats. */
function codesOf(line) {
  const out = [];
  for (const m of stripQuoted(line).matchAll(CODE_RE)) {
    const code = 'card-' + m[1];
    if (!out.includes(code)) out.push(code);
  }
  return out;
}

/** The protocol epic's lane: the label from the epic table of PROJECT.md by the protocol code (as in epics.cjs). */
function protocolLane(root) {
  const pm = path.join(root, PROJECT_REL);
  if (!fs.existsSync(pm)) {
    throw err(msg('board.human-row-trace.no_project'));
  }
  const re = new RegExp('^\\|\\s*`' + PROTOCOL_CODE + '`\\s*\\|\\s*([^|]+?)\\s*\\|');
  for (const line of fs.readFileSync(pm, 'utf8').split(/\r?\n/)) {
    const m = line.match(re);
    if (m) return m[1].replace(/`/g, '');
  }
  throw err(msg('board.human-row-trace.no_protocol_row', { rel: PROJECT_REL }));
}

/** Core of the gate: a scan of the board's cards (live + done/); cards without stop lines are not judged. */
function runBoard({ root } = {}) {
  root = root || process.cwd();
  const lane = protocolLane(root);
  const cards = new Map();
  for (const file of cardFiles(root)) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const m = path.basename(file).match(/card-(\d+)/i);
    if (!m || cards.has('card-' + m[1])) continue;
    const fm = parseFrontmatter(text);
    cards.set('card-' + m[1], { status: fm.status || null, epic: fm.epic || null });
  }
  const lines = [];
  let red = 0;
  let cardsScanned = 0;
  let stopsSeen = 0;
  for (const file of cardFiles(root)) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    cardsScanned += 1;
    const hLines = historyLines(text);
    const stops = hLines.filter(isStopLine);
    if (!stops.length) continue;
    stopsSeen += stops.length;
    const code = (path.basename(file).match(/card-\d+/i) || [path.basename(file)])[0];
    if (hLines.some((l) => EXCEPTION_RE.test(l))) {
      lines.push({
        status: 'skipped',
        fact: msg('board.human-row-trace.skipped', { code, n: stops.length }),
      });
      continue;
    }
    for (const stop of stops) {
      const codes = codesOf(stop);
      if (!codes.length) {
        red += 1;
        lines.push({
          status: 'red',
          fact: msg('board.human-row-trace.no_code', { code }),
        });
        continue;
      }
      const good = codes
        .map((c) => ({ code: c, card: cards.get(c) || null }))
        .find((x) => x.card && x.card.status === 'backlog' && x.card.epic === lane);
      if (good) {
        lines.push({
          status: 'green',
          fact: msg('board.human-row-trace.traced', { code, c: good.code, lane }),
        });
        continue;
      }
      for (const c of codes) {
        const card = cards.get(c) || null;
        red += 1;
        const why = !card
          ? msg('board.human-row-trace.why_not_found')
          : card.status !== 'backlog'
            ? msg('board.human-row-trace.why_not_backlog', { status: card.status })
            : msg('board.human-row-trace.why_wrong_lane', { epic: card.epic, lane });
        lines.push({
          status: 'red',
          fact: msg('board.human-row-trace.red', { code, c, why }),
        });
      }
    }
  }
  return { ready: red === 0, lines, cardsScanned, stopsSeen, red, lane };
}

// ---- --selftest: probes in a temp directory -------------------------------------------------------

const LANE_PROTOCOL = '3. Sample protocol';
const LANE_OTHER = '4. Sample resources';
const LANES_MD =
  '# configuration\n\n| Code | Epic |\n|---|---|\n' +
  '| `protocol` | ' + LANE_PROTOCOL + ' |\n' +
  '| `resources` | ' + LANE_OTHER + ' |\n';

// Prohibition 16: fixture card codes are never literals of the body - the clean-zone scanner matches card-\d{3}
// as a project trace; the code is assembled in runtime, the recognition regexes (card-\d+) untouched.
const PROBE_CARD = ['card', '001'].join('-');    // the trace card deciding the gate (probes a, h)
const PROBE_CLOSED = ['card', '002'].join('-');  // a closed trace card (probe c)
const PROBE_OTHER = ['card', '003'].join('-');   // a card of another epic (probe d)
const PROBE_UNKNOWN = ['card', '004'].join('-'); // the code is not on the board (probe e)
const PROBE_GHOST = ['card', '099'].join('-');   // a sample card in quotes and illustrations (f, h, i)

/** A probe card (a stopped node): one task line and a set of History lines. */
function probeCard(histLines) {
  return (
    '# probe\n\n## Task\n901 · tooling | what the probe delivers | the probe criterion | 2 | where next\n\n## Kit\n\n## History\n' +
    histLines.join('\n') +
    '\n\n## Result\n'
  );
}

/** A probe trace card: the frontmatter (status, epic) - the only thing the gate reads. */
function traceCard(code, status, epic) {
  return (
    '---\nid: "' + code + '-probe-trace"\nstatus: "' + status + '"\nepic: "' + epic + '"\n---\n\n' +
    '# ' + code + ' · a trace-card probe\n\n## Task\n\n902 · decision | a question to the human | the human decides | 2 | human\n\n## Kit\n\n## History\n\n## Result\n'
  );
}

function writeTree(dir, files) {
  for (const [rel, text] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  }
}

function selftest() {
  const base = process.env.FORMA_TEST_TMP && fs.existsSync(process.env.FORMA_TEST_TMP) ? process.env.FORMA_TEST_TMP : os.tmpdir();
  const dir = fs.mkdtempSync(path.join(base, 'human-row-trace-'));
  const results = [];
  const check = (name, cond) => results.push({ ok: !!cond, name });
  const today = new Date().toISOString().slice(0, 10);
  const STOP = (rest) => '- `Spec`, ' + today + ': ' + rest;
  try {
    // a: a stop with the code of a backlog card of the protocol epic - GREEN
    writeTree(path.join(dir, 'a'), {
      'project/config/PROJECT.md': LANES_MD,
      '.devtool/features/probe-911-stop-awaiting.md': probeCard([
        STOP('stop — the attempts threshold 2 of 2 is exhausted, a question to the human: write rights; the card ' + PROBE_CARD + ' is open in the protocol epic — awaiting a decision.'),
      ]),
      ['.devtool/features/' + PROBE_CARD + '-probe-trace.md']: traceCard(PROBE_CARD, 'backlog', LANE_PROTOCOL),
    });
    const ra = runBoard({ root: path.join(dir, 'a') });
    check('a: a stop with the code of a backlog card of the protocol epic = GREEN', ra.ready && ra.stopsSeen === 1 && ra.lines.some((l) => l.status === 'green' && l.fact.includes(PROBE_CARD)));

    // b: a stop without a code - RED (fail-closed)
    writeTree(path.join(dir, 'b'), {
      'project/config/PROJECT.md': LANES_MD,
      '.devtool/features/probe-912-stop-no-code.md': probeCard([
        STOP('stop — the attempts threshold is exhausted (1 of 1), no further - a question to the human.'),
      ]),
    });
    const rb = runBoard({ root: path.join(dir, 'b') });
    check('b: a stop without a code = RED (named: no trace-card code)', !rb.ready && rb.lines.some((l) => l.status === 'red' && l.fact.includes(msg('board.human-row-trace.no_code_marker'))));

    // c: a stop with the code of a closed card - RED
    writeTree(path.join(dir, 'c'), {
      'project/config/PROJECT.md': LANES_MD,
      '.devtool/features/probe-913-stop-closed.md': probeCard([
        STOP('stop — the threshold 2 of 2 is exhausted; the card ' + PROBE_CLOSED + ' named as the trace.'),
      ]),
      ['.devtool/features/' + PROBE_CLOSED + '-probe-closed.md']: traceCard(PROBE_CLOSED, 'done', LANE_PROTOCOL),
    });
    const rc = runBoard({ root: path.join(dir, 'c') });
    check('c: a stop with the code of a closed card = RED (named: not backlog)', !rc.ready && rc.lines.some((l) => l.status === 'red' && l.fact.includes(msg('board.human-row-trace.why_not_backlog', { status: 'done' })) && l.fact.includes(PROBE_CLOSED)));

    // d: a stop with the code of a card of another epic - RED
    writeTree(path.join(dir, 'd'), {
      'project/config/PROJECT.md': LANES_MD,
      '.devtool/features/probe-914-stop-other-epic.md': probeCard([
        STOP('stop — the threshold 2 of 2 is exhausted; the card ' + PROBE_OTHER + ' named as the trace.'),
      ]),
      ['.devtool/features/' + PROBE_OTHER + '-probe-other-epic.md']: traceCard(PROBE_OTHER, 'backlog', LANE_OTHER),
    });
    const rd = runBoard({ root: path.join(dir, 'd') });
    check('d: a stop with the code of a card of another epic = RED (named: not the protocol epic)', !rd.ready && rd.lines.some((l) => l.status === 'red' && l.fact.includes(msg('board.human-row-trace.why_wrong_lane', { epic: LANE_OTHER, lane: LANE_PROTOCOL })) && l.fact.includes(PROBE_OTHER)));

    // e: a stop with a code that is not on the board - RED
    writeTree(path.join(dir, 'e'), {
      'project/config/PROJECT.md': LANES_MD,
      '.devtool/features/probe-915-stop-unknown-code.md': probeCard([
        STOP('stop — the threshold 2 of 2 is exhausted; the card ' + PROBE_UNKNOWN + ' named as the trace.'),
      ]),
    });
    const re2 = runBoard({ root: path.join(dir, 'e') });
    check('e: a stop with a code not on the board = RED (named: not found)', !re2.ready && re2.lines.some((l) => l.status === 'red' && l.fact.includes(msg('board.human-row-trace.why_not_found')) && l.fact.includes(PROBE_UNKNOWN)));

    // f: ordinary History lines - 0 hits
    writeTree(path.join(dir, 'f'), {
      'project/config/PROJECT.md': LANES_MD,
      '.devtool/features/probe-916-ordinary-lines.md': probeCard([
        '- `Kit`, ' + today + ': stage exec — work on the card.',
        '- `Kit`, ' + today + ': attempt, 123 tokens (100 cache-read), 10 out, 5 s, `sess-1` — a spend record (human-row-trace probe-999).',
        '- `Intent`, ' + today + ': human approved the five fields, 0 tokens, 0 s — the plan approved by the answer "yes".',
        '- `Intent`, ' + today + ': the human decided (' + today + '): "I accept" — a decision record, not a stop.',
        '- `Core`, ' + today + ': closed — the image reached.',
        '- `Kit`, ' + today + ': caught probe-911 (stop — threshold 2 of 2, card ' + PROBE_GHOST + ') — the stop form inside an illustration parenthesis.',
        '- `Kit`, ' + today + ': «stop — threshold 1 of 1, card ' + PROBE_GHOST + '» — a quoted stop form at the start of the description.',
      ]),
    });
    const rf = runBoard({ root: path.join(dir, 'f') });
    check('f: ordinary lines (stage/attempt/human approved/human decided/closed/quoted forms) = GREEN, 0 stops, no false hits', rf.ready && rf.stopsSeen === 0 && rf.lines.length === 0);

    // g: an exception in the same card - the finding skipped with an explicit mark
    writeTree(path.join(dir, 'g'), {
      'project/config/PROJECT.md': LANES_MD,
      '.devtool/features/probe-917-exception.md': probeCard([
        STOP('stop — the attempts threshold 1 of 1 is exhausted, no further.'),
        '- `Intent`, ' + today + ': exception: human-row-trace — there was a stop, the trace was opened retroactively — the human decides.',
      ]),
    });
    const rg = runBoard({ root: path.join(dir, 'g') });
    check('g: an exception in the card = the finding skipped with a mark, the code green', rg.ready && rg.stopsSeen === 1 && rg.lines.some((l) => l.status === 'skipped'));

    // h: two named codes, one decides (a backlog card of the protocol epic) - GREEN
    writeTree(path.join(dir, 'h'), {
      'project/config/PROJECT.md': LANES_MD,
      '.devtool/features/probe-918-two-codes.md': probeCard([
        STOP('stop — the attempts threshold 2 of 2; the edit by the ' + PROBE_GHOST + ' sample did not fit the criterion; the card ' + PROBE_CARD + ' is open — awaiting a decision.'),
      ]),
      ['.devtool/features/' + PROBE_CARD + '-probe-trace.md']: traceCard(PROBE_CARD, 'backlog', LANE_PROTOCOL),
    });
    const rh = runBoard({ root: path.join(dir, 'h') });
    check('h: of two named codes one decides (a backlog card of the protocol epic) = GREEN - one deciding code suffices', rh.ready && rh.lines.some((l) => l.status === 'green' && l.fact.includes(PROBE_CARD)));

    // i: a stop line, the code only inside a quotation-illustration - RED (citation strictness)
    writeTree(path.join(dir, 'i'), {
      'project/config/PROJECT.md': LANES_MD,
      '.devtool/features/probe-919-code-in-quote.md': probeCard([
        STOP('stop — by the sample «stop — threshold 2 of 2, card ' + PROBE_GHOST + '» — a dictionary illustration, not a record.'),
      ]),
    });
    const ri = runBoard({ root: path.join(dir, 'i') });
    check('i: a stop line, the code only inside a quotation-illustration = RED (citation strictness: a code from a quote is not a trace)', !ri.ready && ri.lines.some((l) => l.status === 'red' && l.fact.includes(msg('board.human-row-trace.no_code_marker'))));

    const failed = results.filter((r) => !r.ok);
    return {
      ok: failed.length === 0,
      note: failed.length
        ? msg('board.selftest.mismatch') + failed.map((r) => r.name).join('; ')
        : msg('board.human-row-trace.selftest_ok'),
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---- the form of the checks registry --------------------------------------------------------------

/** Findings for the registry (`run(ctx)` → lines, an empty list - clean); registration in index.cjs - the accepting node's decision. */
function run(ctx = {}) {
  const r = runBoard({ root: ctx.root });
  return r.lines.filter((l) => l.status === 'red').map((l) => 'human-row-trace: ' + l.fact);
}

module.exports = { id: 'human-row-trace', since: null, run, runBoard, selftest, isStopLine, codesOf, protocolLane };

// ---- CLI ------------------------------------------------------------------------------------------

if (require.main === module) {
  const argv = process.argv.slice(2);
  const ri = argv.indexOf('--root');
  const root = ri >= 0 ? path.resolve(argv[ri + 1]) : process.cwd();
  try {
    if (argv.includes('--selftest')) {
      const st = selftest();
      console.log((st.ok ? '✓ ' : '✗ ') + st.note);
      process.exit(st.ok ? 0 : 1);
    }
    const r = runBoard({ root });
    for (const l of r.lines) console.log((l.status === 'green' ? '✓ ' : l.status === 'red' ? '✗ ' : '· ') + l.fact);
    if (!r.lines.length) console.log(msg('board.human-row-trace.cli_none', { n: r.cardsScanned }));
    if (r.ready) console.log(msg('board.human-row-trace.cli_green', { n: r.stopsSeen, cards: r.cardsScanned }));
    else console.log(msg('board.human-row-trace.cli_red', { n: r.red }));
    process.exit(r.ready ? 0 : 1);
  } catch (e) {
    console.error(msg('board.stop') + e.message);
    process.exit(e.exitCode || 2);
  }
}
