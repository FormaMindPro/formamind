// card-session-spend: the main session spend is appended to a card in increments.
// The synthetic session journal lives in an isolated HOME (~/.claude/projects/<project>/<session>.jsonl),
// the synthetic card - in the project fixture; the test reads no real journals or cards.
// The "full read" is the same journal read at once against another card: the reference the sum of
// increments is checked against.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeFixture, runNode } = require('./helpers/fixture.cjs');
const { buildDataRaw } = require('./helpers/snapshot.cjs');
const i18n = require('../skills/forma/core/i18n/index.cjs');
const msg = (code, params) => i18n.message(code, params, 'ru');
// A regex from the ru dictionary template: {placeholders} become the given fragments (default lazy any).
const RU = require('../skills/forma/core/i18n/messages/ru.json');
const ruRe = (code, parts = {}) => new RegExp(String(RU[code]).split(/\{(\w+)\}/)
  .map((s, i) => (i % 2) ? (parts[s] || '[\\s\\S]*?') : s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(''));
// Cyrillic data the test writes (card bodies, transcript lines, a commit message) goes through unicode
// escapes: byte-identical data from ASCII source (the english-code gate scans this file).
const DATA = {
  keepGoing: '\u043f\u0440\u043e\u0434\u043e\u043b\u0436\u0430\u0439',
  cardTitle: '\u0442\u0435\u0441\u0442',
  task: '\u0417\u0430\u0434\u0430\u0447\u0430',
  kindLine: '\u043e\u0441\u043d\u0430\u0441\u0442\u043a\u0430 | \u0442\u0435\u0441\u0442 | \u043a\u0440\u0438\u0442\u0435\u0440\u0438\u0439 | 2 | \u0447\u0435\u043b\u043e\u0432\u0435\u043a\u0443',
  kit: '\u0421\u043d\u0430\u0440\u044f\u0436\u0435\u043d\u0438\u0435',
  history: '\u0418\u0441\u0442\u043e\u0440\u0438\u044f',
  result: '\u0420\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442',
  card: '\u041a\u0430\u0440\u0442\u043e\u0447\u043a\u0430 ',
  line: '\u0441\u0442\u0440\u043e\u043a\u0430',
  legacyDesc: '\u0440\u0430\u0441\u0445\u043e\u0434 \u043e\u0441\u043d\u043e\u0432\u043d\u043e\u0439 \u0441\u0435\u0441\u0441\u0438\u0438 \u043f\u043e \u0436\u0443\u0440\u043d\u0430\u043b\u0443 (card-session-spend): 3 \u043e\u0442\u0432\u0435\u0442\u043e\u0432, \u043e\u043a\u043d\u043e 10:00\u201310:10 UTC, \u0432\u044b\u0445\u043e\u0434 180, \u0437\u0430\u043f\u0438\u0441\u044c \u0432 \u043a\u0435\u0448 600.',
  rowPrefix: '\u0440\u0430\u0441\u0445\u043e\u0434 \u043e\u0441\u043d\u043e\u0432\u043d\u043e\u0439 \u0441\u0435\u0441\u0441\u0438\u0438 \u043f\u043e \u0436\u0443\u0440\u043d\u0430\u043b\u0443 (card-session-spend): 2 \u043e\u0442\u0432\u0435\u0442\u043e\u0432'
};

let fx;
let projDir;
test.before(() => {
  fx = makeFixture();
  // The script takes the journal directory from its own path (realpath of the main module), like Claude Code.
  projDir = path.join(fx.home, '.claude', 'projects', fs.realpathSync(fx.root).replace(/[^A-Za-z0-9]/g, '-'));
  fs.mkdirSync(projDir, { recursive: true });
});
test.after(() => { if (fx) fx.cleanup(); });

const SCRIPT = () => path.join(fx.root, '.claude', 'scripts', 'card-session-spend.cjs');
const features = () => path.join(fx.root, '.devtool', 'features');
const cardPath = (num) => path.join(features(), `card-${num}-test.md`);
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

// ---- the journal --------------------------------------------------------------------------------
const iso = (hms) => `2021-09-29T${hms}.000Z`;
const human = (hms) => ({ type: 'user', timestamp: iso(hms), message: { role: 'user', content: DATA.keepGoing } });
const toolResult = (hms) => ({ type: 'user', timestamp: iso(hms),
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } });
// u = [input, cache_write, cache_read, output]; tool - a tool call inside this record.
const answer = (hms, id, u, tool) => ({ type: 'assistant', timestamp: iso(hms), message: {
  id, role: 'assistant',
  usage: { input_tokens: u[0], cache_creation_input_tokens: u[1], cache_read_input_tokens: u[2], output_tokens: u[3] },
  content: [tool ? { type: 'tool_use', name: tool.name, input: tool.input } : { type: 'text', text: 'ok' }] } });
const editCard = (num) => ({ name: 'Edit', input: { file_path: path.join(features(), `card-${num}-test.md`) } });
const readOther = { name: 'Read', input: { file_path: 'x.md' } };

// First pass: three answers of the card (m1, m2 - one answer in two records, m3), the recording
// events are m2 and m3.
const stage1 = (n) => [
  human('10:00:00'),
  answer('10:00:10', 'm1', [10, 100, 1000, 50]),
  answer('10:00:30', 'm2', [20, 200, 2000, 60], editCard(n)),
  answer('10:00:30', 'm2', [20, 200, 2000, 60], readOther), // the same message.id - counted once
  toolResult('10:00:35'),
  human('10:10:00'),
  answer('10:10:20', 'm3', [30, 300, 3000, 70], editCard(n)),
];
// New answers: m4 - right after the first pass boundary (the anchor: 30 s of the gap go into the new
// line), m5 - another card's event, m6 - the card again after the foreign one (the segment from the
// human's line on).
const stage2 = (n) => [
  answer('10:10:50', 'm4', [40, 400, 4000, 80], editCard(n)),
  human('10:20:00'),
  answer('10:20:05', 'm5', [50, 500, 5000, 90], editCard('999')),
  human('10:30:00'),
  answer('10:30:15', 'm6', [60, 600, 6000, 100], editCard(n)),
];
// A conversation with no card recording - falls to no one.
const noise = () => [human('10:40:00'), answer('10:40:10', 'm7', [1, 1, 1, 1])];

// The numbers that follow from the journal's shape (by hand, not from the script):
//   first pass    m1+m2+m3: N = 1160+2280+3400, R = 1000+2000+3000, T = 10+20+0+5+300(cut by --idle)+20
//   increment     m4+m6:    N = 4520+6760,      R = 4000+6000,      T = 30 (anchor) + 15
const FIRST = { N: 6840, R: 6000, T: 355 };
const NEXT = { N: 11280, R: 10000, T: 45 };
const FULL = { N: 18120, R: 16000, T: 400 };

// ---- run and parse ------------------------------------------------------------------------------
function writeCard(num, historyLines = []) {
  fs.writeFileSync(cardPath(num), [
    '---', `id: "card-${num}-test"`, 'status: "review"', 'assignee: "Intent"', 'labels: ["goal-protocol", "route-4"]', '---',
    `# card-${num} \u00b7 ${DATA.cardTitle}`, '', `## ${DATA.task}`, `${num} \u00b7 ${DATA.kindLine}`, '',
    `## ${DATA.kit}`, '', `## ${DATA.history}`, ...historyLines, '', `## ${DATA.result}`, ''].join('\n'));
}
const putSession = (sid, rows) => fs.writeFileSync(path.join(projDir, `${sid}.jsonl`), jsonl(rows));
const run = (num, sid, ...extra) => runNode(fx, [SCRIPT(), num, '--session', sid, ...extra]);
const cardText = (num) => fs.readFileSync(cardPath(num), 'utf8');

// N, R, T of this session's spend lines out of the text (the card's or the output's).
function spendOf(text, sid) {
  const re = /attempt,\s*([\d ]+) tokens \(([\d ]+) cache-read\)(?:, [\d ]+ out)?, (\d+) s, `([^`]+)` — [^\n]*/g;
  const out = [];
  for (const m of text.matchAll(re)) {
    if (m[4] === sid) out.push({ N: Number(m[1].replace(/ /g, '')), R: Number(m[2].replace(/ /g, '')), T: Number(m[3]), line: m[0] });
  }
  return out;
}
const sum = (list) => list.reduce((a, x) => ({ N: a.N + x.N, R: a.R + x.R, T: a.T + x.T }), { N: 0, R: 0, T: 0 });
const nums = (x) => ({ N: x.N, R: x.R, T: x.T });

// The full read of the journal: the same records, but for card `n` (printing, no card recording).
function fullRead(n, sid, rows) {
  writeCard(n);
  putSession(sid, rows);
  const r = run(n, sid);
  assert.equal(r.status, 0, r.stderr);
  const [one, ...rest] = spendOf(r.stdout, sid);
  assert.equal(rest.length, 0);
  return nums(one);
}

test('the full read of the journal gives the expected numbers (the test reference)', () => {
  const full = fullRead('910', 's-full-910', [...stage1('910'), ...stage2('910'), ...noise()]);
  assert.deepEqual(full, FULL);
});

test('two --write runs with new answers between them: the sum of the session lines equals one full read', () => {
  const n = '901', sid = 's-two-writes-901';
  writeCard(n);
  putSession(sid, stage1(n));
  let r = run(n, sid, '--write');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(spendOf(cardText(n), sid).map(nums), [FIRST]);

  putSession(sid, [...stage1(n), ...stage2(n), ...noise()]);
  r = run(n, sid, '--write');
  assert.equal(r.status, 0, r.stderr);
  const lines = spendOf(cardText(n), sid);
  assert.equal(lines.length, 2, 'the second write is a separate increment line');
  assert.deepEqual(nums(lines[1]), NEXT, 'the second line is only the new answers, not the running sum');
  assert.deepEqual(sum(lines), fullRead('911', 's-full-911', [...stage1('911'), ...stage2('911'), ...noise()]));
  assert.deepEqual(sum(lines), FULL);
});

test('a re-run with no new answers writes nothing', () => {
  const n = '902', sid = 's-no-new-902';
  writeCard(n);
  putSession(sid, [...stage1(n), ...stage2(n)]);
  assert.equal(run(n, sid, '--write').status, 0);
  const before = cardText(n);
  // Neither a repeat, nor a conversation without a card recording (new answers that fall to no one)
  // add lines.
  putSession(sid, [...stage1(n), ...stage2(n), ...noise()]);
  for (const args of [['--write'], ['--write'], []]) {
    const r = run(n, sid, ...args);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, ruRe('spend.card-session.no_new'));
    assert.doesNotMatch(r.stdout, /attempt,/);
  }
  assert.equal(cardText(n), before, 'the card did not change');
  assert.equal(spendOf(before, sid).length, 1);
});

test('printing without --write when lines are already written shows only the unaccounted remainder', () => {
  const n = '903', sid = 's-print-903';
  writeCard(n);
  putSession(sid, stage1(n));
  assert.equal(run(n, sid, '--write').status, 0);
  putSession(sid, [...stage1(n), ...stage2(n)]);
  const r = run(n, sid);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(spendOf(r.stdout, sid).map(nums), [NEXT]);
  assert.equal(spendOf(cardText(n), sid).length, 1, 'printing does not touch the card');
});

test('--from/--to: a manually set window, the result as before, the "already accounted" edge is not applied', () => {
  const n = '904', sid = 's-manual-904';
  writeCard(n);
  putSession(sid, [...stage1(n), ...stage2(n)]);
  assert.equal(run(n, sid, '--write').status, 0); // the card already carries the session lines
  const r = run(n, sid, '--from', '2021-09-29T10:00:00Z', '--to', '2021-09-29T10:10:30Z');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(spendOf(r.stdout, sid).map(nums), [FIRST]);
  // A one-record window (m4): only its spend, time - 0.
  const one = run(n, sid, '--from', '2021-09-29T10:10:40Z', '--to', '2021-09-29T10:10:55Z');
  assert.deepEqual(spendOf(one.stdout, sid).map(nums), [{ N: 4520, R: 4000, T: 0 }]);
});

test('a manual-window line is marked and does not move the "already accounted" boundary', () => {
  const n = '905', sid = 's-manual-mark-905';
  writeCard(n);
  putSession(sid, [...stage1(n), ...stage2(n)]);
  const manual = run(n, sid, '--from', '2021-09-29T10:00:00Z', '--to', '2021-09-29T10:10:30Z', '--write');
  assert.equal(manual.status, 0, manual.stderr);
  const [line] = spendOf(cardText(n), sid);
  assert.match(line.line, ruRe('spend.card-session.manual_mark'));
  assert.doesNotMatch(line.line, ruRe('spend.card-session.edge'));
  // An automatic run counts everything from the start: the manual line set no boundary.
  assert.deepEqual(spendOf(run(n, sid).stdout, sid).map(nums), [FULL]);
});

test('a legacy line (cumulative, no boundary mark): the boundary is the end of the window-end minute', () => {
  const n = '906', sid = 's-legacy-906';
  const legacy = '- `Intent`, 2021-09-29: attempt, 6 840 tokens (6 000 cache-read), 355 s, `' + sid + '` — claude-code: ' +
    DATA.legacyDesc;
  // The new answer is at 10:20, past the end of the 10:10 minute.
  const tail = [human('10:20:00'), answer('10:20:05', 'm8', [40, 400, 4000, 80], editCard(n))];
  writeCard(n, [legacy]);
  putSession(sid, [...stage1(n), ...tail]);
  const r = run(n, sid, '--write');
  assert.equal(r.status, 0, r.stderr);
  const lines = spendOf(cardText(n), sid);
  assert.equal(lines.length, 2);
  assert.deepEqual(nums(lines[1]), { N: 4520, R: 4000, T: 300 + 5 });
  assert.deepEqual(sum(lines), fullRead('912', 's-full-912', [...stage1('912'), ...[human('10:20:00'), answer('10:20:05', 'm8', [40, 400, 4000, 80], editCard('912'))]]));
});

// ---- the counter: increments of one session are all counted, cumulative duplicates - still once --
function tallyTotal(num, historyLines) {
  writeCard(num, historyLines);
  const r = runNode(fx, [path.join(fx.root, '.forma', 'dashboard', 'tally.cjs'), cardPath(num)]);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout).total;
}
const spendRow = (n, r, t, tail) => '- `Intent`, 2021-09-29: attempt, ' + n + ' tokens (' + r + ' cache-read), ' + t + ' s, `s-tally` — claude-code: ' +
  DATA.rowPrefix + tail;

test('tally: lines with different boundaries are increments, summed; unmarked - cumulative, counted once', () => {
  const marked = tallyTotal('907', [
    spendRow(1000, 500, 10, msg('spend.card-session.edge', { iso: '2021-09-29T10:10:20.000Z' }) + '.'),
    spendRow(2000, 800, 20, msg('spend.card-session.edge', { iso: '2021-09-29T10:30:15.000Z' }) + '.'),
    spendRow(2000, 800, 20, msg('spend.card-session.edge', { iso: '2021-09-29T10:30:15.000Z' }) + '.'), // the same boundary - a duplicate, not an increment
  ]);
  assert.equal(marked.tokens, 3000);
  assert.equal(marked.seconds, 30);
  const legacy = tallyTotal('908', [spendRow(1000, 500, 10, '.'), spendRow(2000, 800, 20, '.')]);
  assert.equal(legacy.tokens, 1000, 'old cumulative lines collapse into the first, as before');
});

test('tally: one call id with different numbers - different passes, with the same numbers - a duplicate', () => {
  const row = (n, r, t) => '- `Intent`, 2021-09-29: attempt, ' + n + ' tokens (' + r + ' cache-read), ' + t + ' s, `s-shared` — claude-code: section build.';
  const shared = tallyTotal('909', [row(1000, 500, 10), row(2000, 800, 20), row(2000, 800, 20)]);
  assert.equal(shared.tokens, 3000, 'two different records under one id are both counted, an exact copy once');
});

// ---- the dashboard: buildData (dashboard/data/cards.cjs) - the same key as in tally --------------
// Card `num` in the assembled data: an object with the card path and its passes.
function boardCard(num) {
  const found = [];
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      if (typeof v.path === 'string' && v.path.includes(`card-${num}-test.md`) && Array.isArray(v.attempts)) found.push(v);
      Object.values(v).forEach(walk);
    }
  };
  walk(buildDataRaw(fx));
  assert.ok(found.length >= 1, 'the card did not make it into the dashboard data');
  return found[0];
}

test('buildData: lines of one session with different boundaries are increments, both counted; unmarked - one, as before', () => {
  writeCard('920', [
    spendRow(1000, 500, 10, msg('spend.card-session.edge', { iso: '2021-09-29T10:10:20.000Z' }) + '.'),
    spendRow(2000, 800, 20, msg('spend.card-session.edge', { iso: '2021-09-29T10:30:15.000Z' }) + '.'),
    spendRow(2000, 800, 20, msg('spend.card-session.edge', { iso: '2021-09-29T10:30:15.000Z' }) + '.'), // the same boundary - a duplicate
  ]);
  const marked = boardCard('920');
  assert.equal(marked.attempts.length, 2);
  assert.equal(marked.tokensByEngine['claude-code'].tokens, 3000);
  writeCard('921', [spendRow(1000, 500, 10, '.'), spendRow(2000, 800, 20, '.')]);
  const legacy = boardCard('921');
  assert.equal(legacy.attempts.length, 1, 'old cumulative lines collapse into the first');
  assert.equal(legacy.tokensByEngine['claude-code'].tokens, 1000);
  assert.equal('windowEnd' in legacy.attempts[0], false, 'an unmarked record gets no new field');
});

// ---- card touches: a commit through forma-commit and a card file edit from Bash/PowerShell -------
const bash = (command) => ({ name: 'Bash', input: { command } });
const powershell = (command) => ({ name: 'PowerShell', input: { command } });

// Six answers, each inside one card's segment: a1+a2 -> 006 (a commit through forma-commit),
// b1+b2 -> 007 (sed -i on the card file), c1 -> 008 (Add-Content), d1 -> 006 (the card-006-*.md
// template). Reading a card file (cat) is not a touch: no touches.
// N of an answer = the sum of its four counters: a1 116, a2 228, b1 340, b2 452, c1 564, d1 676; 2376 in total.
const touches = () => [
  human('11:00:00'),
  answer('11:00:10', 'a1', [1, 10, 100, 5], bash('cat .devtool/features/card-009-test.md')),
  answer('11:00:20', 'a2', [2, 20, 200, 6], bash('node protocol/scripts/forma-commit.cjs "' + DATA.card + '006: ' + DATA.cardTitle + '"')),
  human('11:10:00'),
  answer('11:10:10', 'b1', [3, 30, 300, 7]),
  answer('11:10:20', 'b2', [4, 40, 400, 8], bash("sed -i 's/a/b/' .devtool/features/card-007-test.md")),
  human('11:20:00'),
  answer('11:20:10', 'c1', [5, 50, 500, 9], powershell('Add-Content .devtool\\features\\card-008-test.md "' + DATA.line + '"')),
  human('11:30:00'),
  answer('11:30:10', 'd1', [6, 60, 600, 10], bash('cat >> .devtool/features/card-006-*.md <<EOF\n' + DATA.line + '\nEOF')),
];

test('touches: a commit through forma-commit and a write from Bash/PowerShell; an answer belongs to exactly one card, the sum equals the full read', () => {
  const sid = 's-touches-006';
  putSession(sid, touches());
  const nOf = (n) => {
    writeCard(n);
    const r = run(n, sid);
    assert.equal(r.status, 0, `card-${n}: ${r.stderr}`);
    const [one, ...rest] = spendOf(r.stdout, sid);
    assert.equal(rest.length, 0);
    return one.N;
  };
  const byCard = { 006: nOf('006'), 007: nOf('007'), 008: nOf('008') };
  assert.deepEqual(byCard, { 006: 116 + 228 + 676, 007: 340 + 452, 008: 564 });
  writeCard('944');
  const full = run('944', sid, '--from', '2021-09-29T00:00:00Z', '--to', '2021-09-29T23:59:59Z');
  assert.equal(spendOf(full.stdout, sid)[0].N, 2376);
  assert.equal(byCard[006] + byCard[007] + byCard[008], 2376, 'the card windows do not overlap and cover the journal');
});

test('touches: reading a card file from Bash is not counted as a touch', () => {
  const sid = 's-touches-009';
  putSession(sid, touches());
  writeCard('009');
  const r = run('009', sid);
  assert.equal(r.status, 1);
  assert.match(r.stderr, ruRe('spend.card-session.no_touch'));
});
