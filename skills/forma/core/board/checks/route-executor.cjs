'use strict';

// The route label binds the executor (AGENTS.md §2, §6). The routes where the work is done by `Run` (route-2, 5, 6, 7):
// a card that reached the check or was accepted (`review`, `done`) carries at least one `Run` attempt in its history.
// Otherwise the label lies: the work was done and accepted by `Intent` (prohibition 1). Executing it oneself - change
// the route label with a reason in the history.
//
// The exception path (the §6 card-and-board convention, fail-closed): the red is lifted only by a full line
// `exception: <what> — <why> — <who approved>` in the History zone of this same card - naming this gate
// (the check id `route-executor`) and the approver (the approval language: approved/approval/accepted and the
// Russian approval stems). No gate name, no approver name, a line outside History or no line at all - the red stays.
// Self-probe: node .forma/board/checks/route-executor.cjs --selftest (probes in the OS temp directory);
// through the reconciliations - sync-engines.cjs --selftest and check-board.cjs.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { cardFiles, createdDay, zone } = require('../../dashboard/lib/card.cjs');

const RUN_ROUTES = ['route-2', 'route-5', 'route-6', 'route-7'];
const i18n = require('../../i18n/index.cjs');
const RUN_ATTEMPT = new RegExp('^-\\s*`Run`,\\s*\\d{4}-\\d{2}-\\d{2}:\\s*(' + i18n.alt('hist.attempt') + ')', 'm');

const GATE_ID = 'route-executor';
// The approval stems - labels of the dictionary (Russian and English), not literals of the code.
const APPROVER_RE = new RegExp(i18n.alt('term.approver'), 'i');
const msg = (key, params) => i18n.message(key, params, 'ru');

/** A full exception line in this card's History: names this gate and the approver. An incomplete one does not count. */
function hasFullException(text) {
  const history = zone(text, 'history');
  if (!history) return false;
  for (const line of history.split(/\r?\n/)) {
    const i = line.toLowerCase().indexOf('exception:');
    if (i < 0) continue;
    const body = line.slice(i);
    if (new RegExp('\\b' + GATE_ID + '\\b', 'i').test(body) && APPROVER_RE.test(body)) return true;
  }
  return false;
}

function cardProblem(f, text) {
  const status = (text.match(/^status:\s*"?([\w-]+)/m) || [])[1];
  if (status !== 'review' && status !== 'done') return null;
  const labels = (text.match(/^labels:\s*\[(.*)\]/m) || [])[1] || '';
  const route = RUN_ROUTES.find((r) => new RegExp('"' + r + '"').test(labels));
  if (!route || RUN_ATTEMPT.test(text)) return null;
  if (hasFullException(text)) return null;
  return msg('board.route-executor.no_attempt', { f, route });
}

function run({ root, since }) {
  const problems = [];
  for (const file of cardFiles(root, /^card-\d+.*\.md$/)) {
    const text = fs.readFileSync(file, 'utf8');
    if (createdDay(text) < since) continue;
    const p = cardProblem(path.basename(file), text);
    if (p) problems.push(p);
  }
  return problems;
}

// ---- --selftest: probes in the OS temp directory ------------------------------------------------

function writeTree(dir, files) {
  for (const [rel, text] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  }
}

/** A dummy card: route-7, status done, without a `Run` attempt; lines in History or (on handoff) in Result. */
function fixtureCard(num, historyLines, resultLines, today) {
  return [
    '---',
    'id: "card-' + num + '-sample-route-executor"',
    'status: "done"',
    'priority: "medium"',
    'assignee: "Intent"',
    'epic: "3. Project protocol"',
    'labels: ["goal-sample", "route-7"]',
    'created: "' + today + 'T00:00:00.000Z"',
    '---',
    '# route probe ' + num,
    '',
    '## Task',
    'probe · self-check of the route executor rule',
    '',
    '## Kit',
    '',
    '## History',
    ...historyLines,
    '',
    '## Result',
    ...resultLines,
    '',
  ].join('\n');
}

function selftest() {
  const base = process.env.FORMA_TEST_TMP && fs.existsSync(process.env.FORMA_TEST_TMP) ? process.env.FORMA_TEST_TMP : os.tmpdir();
  const today = new Date().toISOString().slice(0, 10);
  const results = [];
  const check = (name, cond) => results.push({ ok: !!cond, name });
  // Fixture names - dynamic (prohibition 16): a card-NNN literal in a clean-zone source is caught by the trace check.
  const num = (k) => 900 + k;
  const name = (k, slug) => 'card-' + num(k) + '-' + slug + '.md';
  /** Probe: a fresh dummy board in a temp directory, a run on it, cleanup. */
  const probe = (files) => {
    const dir = fs.mkdtempSync(path.join(base, 'route-executor-'));
    try {
      writeTree(dir, files);
      return run({ root: dir, since: '' });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
  const card = (k, slug, historyLines, resultLines = []) => ({ [`.devtool/features/${name(k, slug)}`]: fixtureCard(num(k), historyLines, resultLines, today) });
  const exc = (body) => '- `Intent`, ' + today + ': exception: ' + body;
  try {
    // g) no exception at all - RED: the base rule is alive
    const r1 = probe(card(1, 'no-exception', ['- `Intent`, ' + today + ': stage close — closed without a `Run` attempt.']));
    check('route-7 without a Run attempt and without an exception = RED', r1.length === 1 && r1[0].includes(name(1, 'no-exception')));
    // a) a full exception line - GREEN (in done/, to cover closed cards too)
    const r2 = probe({ ['.devtool/features/done/' + name(2, 'full-exception')]: fixtureCard(num(2), [exc('route-executor — the route was closed without a `Run` attempt by the human\'s decision — the human approved in the session')], [], today) });
    check('a full exception line (gate + approver) in done/ = GREEN', r2.length === 0);
    // b) an exception without the gate name - RED (fail-closed)
    const r3 = probe(card(3, 'no-gate', [exc('the route was closed without a `Run` attempt by the human\'s decision — the human approved in the session')]));
    check('an exception without the gate name = RED', r3.length === 1 && r3[0].includes(name(3, 'no-gate')));
    // c) an exception without the approver - RED (fail-closed)
    const r4 = probe(card(4, 'no-approver', [exc('route-executor — the route was closed without a `Run` attempt, the reason is in the history')]));
    check('an exception without the approver = RED', r4.length === 1 && r4[0].includes(name(4, 'no-approver')));
    // someone else's gate named - RED: another check's name does not lift this gate
    const r5 = probe(card(5, 'other-gate', [exc('route-labels — the route was closed without a `Run` attempt — the human approved in the session')]));
    check('an exception with another gate\'s name = RED', r5.length === 1 && r5[0].includes(name(5, 'other-gate')));
    // an exception outside History (in Result) - RED: the zone is obligatory
    const r6 = probe(card(6, 'wrong-zone', ['- `Intent`, ' + today + ': stage close — closed.'], [exc('route-executor — the route was closed without a `Run` attempt — the human approved in the session')]));
    check('an exception outside the History zone = RED', r6.length === 1 && r6[0].includes(name(6, 'wrong-zone')));
    // a `Run` attempt is there - GREEN without any exception: the base rule is untouched
    const r7 = probe(card(7, 'with-run', ['- `Run`, ' + today + ': attempt — done by the route.']));
    check('a `Run` attempt in the history = GREEN without an exception', r7.length === 0);
    const failed = results.filter((r) => !r.ok);
    return {
      ok: failed.length === 0,
      note: failed.length
        ? msg('board.selftest.mismatch') + failed.map((r) => r.name).join('; ')
        : msg('board.route-executor.selftest_ok'),
    };
  } catch (e) {
    results.push({ ok: false, name: msg('board.selftest.crashed') + String((e && e.message) || e) });
    return { ok: false, note: results.filter((r) => !r.ok).map((r) => r.name).join('; ') };
  }
}

module.exports = { id: 'route-executor', since: 'route-executor', run, selftest };

if (require.main === module) {
  if (process.argv.slice(2).includes('--selftest')) {
    const st = selftest();
    console.log((st.ok ? '\u2713 ' : '\u2717 ') + 'route-executor: ' + st.note);
    process.exit(st.ok ? 0 : 1);
  }
  console.log(msg('board.route-executor.usage'));
  process.exit(0);
}
