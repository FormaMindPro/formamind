#!/usr/bin/env node
'use strict';

/**
 * budget-stop - the gate of the attempt-budget change (prohibition 3, fail-closed): a change line of the attempt
 * budget in a card's History must (a) carry the new value - the form `budget N→M`, (b) rest on a stop line with
 * a report in the same card; the budget field in the Task must match the last recorded change. There is no silent
 * change: every new value stands behind a recorded stop. No model calls: the status by the exit code,
 * the findings - in stdout; consumers - the Intent node at the card check and at the closings.
 *
 *   node .forma/board/checks/budget-stop.cjs --board [--root <dir>]   (a board scan: live cards + done/)
 *   node .forma/board/checks/budget-stop.cjs --selftest               (probes into the OS temp directory)
 *
 * The convention of the forms (the line's format carries the obligatory data - by the model of approval-parity):
 *   1. A budget change line (History): `- `Node`, YYYY-MM-DD: budget N→M …` - the word `budget` (or the Russian
 *      `budget` stem with a case ending of up to two letters), an optional colon, the number N, the arrow `→` or `->`, the number M;
 *      spaces around the arrow are allowed. The form itself carries the new value M. The budget word must be
 *      adjacent to the arrow expression: the word's presence in a line without adjacency does not form a change form.
 *      Citation strictness: quotes («…», "…", `…`) and illustration parentheses after the caught/finding/
 *      quote/quoting/example words are cut out before the search - a quoted form in prose and a description of a catch
 *      is not a change record; a form outside quotes is caught as before (the gate stays fail-closed).
 *   2. A stop line with a report (History): the line's description opens with the word `stop` (or the Russian stem) and names
 *      a threshold - the line has a budget/threshold/attempt word and a digit. A change line itself
 *      can be the stop line, if its description opens with the word `stop`
 *      (a combined record of the stop and the change). A spend line (`attempt, …`) and a mention of the word `stop` inside
 *      a description (for example, in a holder's name) do not count as a stop.
 *   3. The budget field in the Task: the fourth field of the task line `NNN · kind | what it delivers | criterion | BUDGET |
 *      where next`, a number with an optional word ("2", "3 attempts").
 *
 * Verdict: RED if (i) the change line has no stop line in the same card; (ii) the budget field in the Task
 * ≠ the last recorded change (the last in the order of the History lines); (iii) a card with changes has an
 * unreadable budget field - the equality is not proven. Cards without change lines are not judged. Not recognizable
 * mechanically: a silently edited budget field without any change line - no ground for comparison; that is part of
 * the human's verdict at acceptance. The exception path (as in approval-parity): a line
 *   `- `Node`, YYYY-MM-DD: exception: … budget-stop …`
 * in this same card's History - the card's findings are skipped with an explicit mark; the human decides.
 *
 * Exit codes: 0 - green; 1 - RED (a change without a stop, the field ≠ the change, the field unreadable);
 * 2 - a runtime error (the self-probe mismatched, the board directory unreadable).
 * Module: require('./budget-stop.cjs') → { id: 'budget-stop', since: null, run, runBoard, selftest, … } -
 * the form of the checks registry; inclusion by one line in index.cjs - the accepting node's decision, by default
 * the gate is called explicitly (--board).
 * Part of the core: carries no project traces (prohibition 16).
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const i18n = require('../../i18n/index.cjs');
const { cardFiles, zone } = require('../../dashboard/lib/card.cjs');

// The form words are labels of the dictionary (keys.json), not literals of the code: Russian cards
// change the budget with the Russian stems. An update of the words - an edit of keys.json.
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const stemsOf = (key, lang) => ((i18n.KEYS.labels[key] || {})[lang] || []).map(escapeRe);
const BUDGET_EN = stemsOf('term.budget', 'en');
const BUDGET_RU = stemsOf('term.budget', 'ru');
// The change regex: the budget stem from the dictionary (EN word-bounded, RU with a suffix class over the escaped Cyrillic range U+0430..U+044F), then `: N → M` - built at runtime; the gate guards this file too.
const CHANGE_RE = new RegExp('(?:\\b(?:' + BUDGET_EN.join('|') + ')\\b|' + BUDGET_RU.join('|') + '[\\u0430-\\u044F\\u0451]{0,2})\\s*:?\\s*(\\d+)\\s*(?:→|->)\\s*(\\d+)', 'iu');
const QUOTE_RE = /«[^»]*»|"[^"]*"|`[^`]*`/g;
const ILLUSTRATIONS = stemsOf('term.illustration', 'en').concat(stemsOf('term.illustration', 'ru'));
const ILLUSTRATION_RE = new RegExp('(?:' + ILLUSTRATIONS.join('|') + ')\\w*[^\\n()«"»]{0,40}?\\([^()]*\\)', 'gi');
// stop at the head of the description; the English stem ends at a word boundary, the Russian stem matches as a prefix.
const STOP_HEAD_RE = new RegExp('^-\\s*`[^`]+`,\\s*\\d{4}-\\d{2}-\\d{2}:\\s*(?:' + stemsOf('term.stop', 'en').map((s) => s + '\\b').join('|') + '|' + stemsOf('term.stop', 'ru').join('|') + ')', 'i');
const THRESHOLDS = stemsOf('term.threshold', 'en').concat(stemsOf('term.threshold', 'ru'));
const STOP_THRESHOLD_RE = new RegExp('(?:' + THRESHOLDS.join('|') + ')', 'i');
const EXCEPTION_RE = /^-\s*`[^`]+`,\s*\d{4}-\d{2}-\d{2}:\s*exception:[^\n]*budget-stop/i;
const msg = (key, params) => i18n.message(key, params, 'ru');

const err = (m) => Object.assign(new Error(m), { exitCode: 2 });

/**
 * Citation strictness: quotes («…», "…", `…`) and illustration parentheses after the caught/finding/quote/
 * quoting/example words are cut out before the change-form search - a quoted form in prose and a description
 * of a catch is not a change record. The order: quotes → illustrations → quotes (an illustration may carry a
 * quote inside; cutting the quotes first opens the adjacency of the marker to the parenthesis). Stop lines and
 * exceptions are judged by the original line - the cutting concerns the change-form search only.
 */
function stripQuoted(line) {
  const q1 = String(line).replace(QUOTE_RE, ' ');
  const q2 = q1.replace(ILLUSTRATION_RE, ' ');
  return q2.replace(QUOTE_RE, ' ');
}

/** Event lines of the card's History zone; no zone - empty. */
function historyLines(text) {
  const history = zone(text, 'history');
  if (!history) return [];
  return history.split(/\r?\n/).filter((l) => /^\s*-\s/.test(l));
}

/** Budget change lines: a match with the `budget N→M` form outside quotes and illustration parentheses; the order - the order of the History lines. */
function changesOf(lines) {
  const out = [];
  for (const line of lines) {
    const m = CHANGE_RE.exec(stripQuoted(line));
    if (m) out.push({ line: line.trim(), from: Number(m[1]), to: Number(m[2]) });
  }
  return out;
}

/** A stop line: the description opens with the stop word, a threshold is named (a word + a digit). */
function isStopLine(line) {
  return STOP_HEAD_RE.test(line) && STOP_THRESHOLD_RE.test(line) && /\d/.test(line);
}

/** The exception path: an `exception: … budget-stop …` line in this same card's History. */
function hasException(lines) {
  return lines.some((l) => EXCEPTION_RE.test(l));
}

/** The budget field in the Task: the fourth field of the first task line with four separators. */
function taskBudgetOf(text) {
  const task = zone(text, 'task');
  const line = task.split(/\r?\n/).find((l) => (l.match(/\|/g) || []).length >= 4);
  if (!line) return { parsed: null, raw: null };
  const segs = line.split('|');
  const raw = (segs[segs.length - 2] || '').trim();
  const m = raw.match(/(\d+)/);
  return { parsed: m ? Number(m[1]) : null, raw };
}

/** Core of the gate: a scan of the board's cards (live + done/); cards without changes are not judged. */
function runBoard({ root } = {}) {
  root = root || process.cwd();
  const lines = [];
  let red = 0;
  let cardsScanned = 0;
  let changesSeen = 0;
  for (const file of cardFiles(root)) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    cardsScanned += 1;
    const hLines = historyLines(text);
    const changes = changesOf(hLines);
    if (!changes.length) continue;
    changesSeen += changes.length;
    const code = (path.basename(file).match(/card-\d+/) || [path.basename(file)])[0];
    const changesText = changes.map((c) => `${c.from}→${c.to}`).join(', ');
    if (hasException(hLines)) {
      lines.push({
        status: 'skipped',
        fact: msg('board.budget-stop.skipped', { code, changes: changesText }),
      });
      continue;
    }
    const stopOk = hLines.some(isStopLine);
    if (!stopOk) {
      red += 1;
      lines.push({
        status: 'red',
        fact: msg('board.budget-stop.red_no_stop', { code, changes: changesText }),
      });
    }
    const last = changes[changes.length - 1];
    const { parsed, raw } = taskBudgetOf(text);
    if (parsed === null) {
      red += 1;
      lines.push({
        status: 'red',
        fact: msg('board.budget-stop.field_unreadable', {
          code,
          raw: raw ? msg('board.budget-stop.field_raw', { raw }) : msg('board.budget-stop.field_no_line'),
          changes: `${last.from}→${last.to}`,
        }),
      });
    } else if (parsed !== last.to) {
      red += 1;
      lines.push({
        status: 'red',
        fact: msg('board.budget-stop.field_mismatch', { code, parsed, changes: `${last.from}→${last.to}` }),
      });
    } else if (stopOk) {
      lines.push({ status: 'green', fact: msg('board.budget-stop.green', { code, changes: `${last.from}→${last.to}`, parsed }) });
    }
  }
  return { ready: red === 0, lines, cardsScanned, changesSeen, red };
}

// ---- --selftest: probes in a temp directory -------------------------------------------------------

/** A probe card: one task line (the budget field substituted) and a set of History lines. */
function probeCard(budgetField, histLines) {
  return (
    '# probe\n\n## Task\n901 · tooling | what the probe delivers | the probe criterion | ' +
    budgetField +
    ' | where next\n\n## Kit\n\n## History\n' +
    histLines.join('\n') +
    '\n\n## Result\n'
  );
}

function writeProbe(dir, name, text) {
  const p = path.join(dir, '.devtool', 'features', name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
}

function selftest() {
  const base = process.env.FORMA_TEST_TMP && fs.existsSync(process.env.FORMA_TEST_TMP) ? process.env.FORMA_TEST_TMP : os.tmpdir();
  const dir = fs.mkdtempSync(path.join(base, 'budget-stop-'));
  const results = [];
  const check = (name, cond) => results.push({ ok: !!cond, name });
  const today = new Date().toISOString().slice(0, 10);
  const STOP = '- `Spec`, ' + today + ': stop — the budget 1 of 1 is exhausted, a report: the edit did not fit the criterion, escalation for a new budget.';
  try {
    // a: a change with a stop and a matching field - GREEN
    writeProbe(path.join(dir, 'a'), 'probe-901-budget-with-stop.md', probeCard('2', [
      STOP,
      '- `Intent`, ' + today + ': budget 1 → 2 attempts — the new budget recorded by the stop.',
    ]));
    const ra = runBoard({ root: path.join(dir, 'a') });
    check('a: a change with a stop and a matching field = GREEN', ra.ready && ra.changesSeen === 1 && ra.lines.some((l) => l.status === 'green'));

    // b: a change without a stop - RED (fail-closed)
    writeProbe(path.join(dir, 'b'), 'probe-902-budget-no-stop.md', probeCard('3', [
      '- `Intent`, ' + today + ': budget 2 → 3 attempts — the change recorded, there is no stop.',
    ]));
    const rb = runBoard({ root: path.join(dir, 'b') });
    check('b: a change without a stop = RED (named: no stop line)', !rb.ready && rb.lines.some((l) => l.status === 'red' && l.fact.includes(msg('board.budget-stop.no_stop_marker'))));

    // c: the budget field in the Task ≠ the recorded change - RED
    writeProbe(path.join(dir, 'c'), 'probe-903-budget-field-mismatch.md', probeCard('2', [
      STOP,
      '- `Intent`, ' + today + ': budget 2 → 3 attempts — the change by the stop, the field not updated.',
    ]));
    const rc = runBoard({ root: path.join(dir, 'c') });
    check('c: the budget field ≠ the recorded change = RED (the ≠ named)', !rc.ready && rc.lines.some((l) => l.status === 'red' && l.fact.includes('≠')));

    // d: ordinary History lines (stage exec, attempt, closed, Budget without an arrow, a "budget-stop" trap in a spend line) - 0 changes, GREEN
    writeProbe(path.join(dir, 'd'), 'probe-904-budget-ordinary-lines.md', probeCard('2', [
      '- `Kit`, ' + today + ': stage exec — work on the card.',
      '- `Kit`, ' + today + ': attempt, 123 tokens (100 cache-read), 10 out, 5 s, `sess-1` — a spend record (budget-stop probe-999).',
      '- `Intent`, ' + today + ': Budget: the second attempt of two — the last, without an arrow.',
      '- `Kit`, ' + today + ': Similar: probe-901.',
      '- `Core`, ' + today + ': closed — the image reached.',
    ]));
    const rd = runBoard({ root: path.join(dir, 'd') });
    check('d: ordinary History lines without arrow changes = GREEN, 0 changes, no false hits', rd.ready && rd.changesSeen === 0 && rd.lines.length === 0);

    // e: two changes, each with a stop, the field = the last change - GREEN
    writeProbe(path.join(dir, 'e'), 'probe-905-budget-two-changes.md', probeCard('3', [
      STOP,
      '- `Intent`, ' + today + ': budget 1 → 2 attempts — by the stop.',
      '- `Spec`, ' + today + ': stop — the budget 2 of 2 is exhausted, a report: the second attempt also missed the criterion.',
      '- `Intent`, ' + today + ': budget 2 → 3 attempts — by the second stop.',
    ]));
    const re = runBoard({ root: path.join(dir, 'e') });
    check('e: two changes with stops, the field = the last change = GREEN', re.ready && re.changesSeen === 2);

    // f: an exception in the same card - the finding skipped with an explicit mark
    writeProbe(path.join(dir, 'f'), 'probe-906-budget-exception.md', probeCard('3', [
      '- `Intent`, ' + today + ': budget 2 → 3 attempts — a change without a stop.',
      '- `Intent`, ' + today + ': exception: budget-stop — the stop happened in the session, the line was not written — approved by the human.',
    ]));
    const rf = runBoard({ root: path.join(dir, 'f') });
    check('f: an exception in the card = the finding skipped with a mark, the code green', rf.ready && rf.lines.some((l) => l.status === 'skipped'));

    // g (acceptance 2): a quoted form in prose - NOT a change
    writeProbe(path.join(dir, 'g'), 'probe-907-budget-quote-in-prose.md', probeCard('2', [
      '- `Intent`, ' + today + ': an acceptance check: caught probe-901 verified against the file — line 38 «budget 2 → 3 attempts», the grounds are in the line, there is no stop line.',
    ]));
    const rg = runBoard({ root: path.join(dir, 'g') });
    check('g: a quoted form «…» in prose = NOT a change, GREEN, 0 changes', rg.ready && rg.changesSeen === 0);

    // h (acceptance 2, variant): the form in code quotes - NOT a change
    writeProbe(path.join(dir, 'h'), 'probe-908-budget-quote-in-code.md', probeCard('2', [
      '- `Intent`, ' + today + ': line 38 `budget 2 → 3 attempts` — a quoted form in a line of code.',
    ]));
    const rh = runBoard({ root: path.join(dir, 'h') });
    check('h: a quoted form in code quotes = NOT a change, GREEN, 0 changes', rh.ready && rh.changesSeen === 0);

    // i (acceptance 3): a catch description without an adjacent budget word - NOT a change (a line with budget-stop.cjs in the text)
    writeProbe(path.join(dir, 'i'), 'probe-909-budget-catch-description.md', probeCard('2', [
      '- `Kit`, ' + today + ': stage exec — budget-stop.cjs built: --selftest 6 probes green (exit 0), --board of the live board — 1 catch of probe-901 (the change 2→3 without a stop line, exit 1 fail-closed).',
    ]));
    const ri = runBoard({ root: path.join(dir, 'i') });
    check('i: a catch description (the change 2→3) with a budget word without adjacency = NOT a change, GREEN, 0 changes', ri.ready && ri.changesSeen === 0);

    // j (acceptance 1, the guard against weakening): a real record outside quotes stays a change - RED
    writeProbe(path.join(dir, 'j'), 'probe-910-budget-real-record-quotes-in-reason.md', probeCard('3', [
      '- `Intent`, ' + today + ': budget 2 → 3 attempts — the ground «by command», quotes only in the ground.',
    ]));
    const rj = runBoard({ root: path.join(dir, 'j') });
    check('j: a real record outside quotes (quotes in the ground) = still RED without a stop', !rj.ready && rj.lines.some((l) => l.status === 'red' && l.fact.includes(msg('board.budget-stop.no_stop_marker'))));

    // k (acceptance 3, variant): the form inside parentheses after the caught word - NOT a change
    writeProbe(path.join(dir, 'k'), 'probe-911-budget-paren-after-marker.md', probeCard('2', [
      '- `Kit`, ' + today + ': caught probe-901 (the change budget 2→3 without a stop) — the form inside an illustration parenthesis.',
    ]));
    const rk = runBoard({ root: path.join(dir, 'k') });
    check('k: the form inside parentheses after the caught word = NOT a change, GREEN, 0 changes', rk.ready && rk.changesSeen === 0);

    const failed = results.filter((r) => !r.ok);
    return {
      ok: failed.length === 0,
      note: failed.length
        ? msg('board.selftest.mismatch') + failed.map((r) => r.name).join('; ')
        : msg('board.budget-stop.selftest_ok'),
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---- the form of the checks registry --------------------------------------------------------------

/** Findings for the registry (`run(ctx)` → lines, an empty list - clean); registration in index.cjs - the accepting node's decision. */
function run(ctx = {}) {
  const r = runBoard({ root: ctx.root });
  return r.lines.filter((l) => l.status === 'red').map((l) => 'budget-stop: ' + l.fact);
}

module.exports = { id: 'budget-stop', since: null, run, runBoard, selftest, changesOf, taskBudgetOf, isStopLine };

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
    if (!r.lines.length) console.log(msg('board.budget-stop.cli_none', { n: r.cardsScanned }));
    if (r.ready) console.log(msg('board.budget-stop.cli_green', { n: r.changesSeen, cards: r.cardsScanned }));
    else console.log(msg('board.budget-stop.cli_red', { n: r.red }));
    process.exit(r.ready ? 0 : 1);
  } catch (e) {
    console.error(msg('board.stop') + e.message);
    process.exit(e.exitCode || 2);
  }
}
