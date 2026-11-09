// card-move.cjs: the card handover in one call (AGENTS.md §6-7) on the training fixture.
// Note texts the test writes into cards are data (unicode escapes); expected ru fragments of the script's
// own output are matched by the dictionary key, not by a pinned copy.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeFixture } = require('./helpers/fixture.cjs');
const { run } = require('./helpers/outputs.cjs');
const RU = require('../skills/forma/core/i18n/messages/ru.json');
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ruSrc = (code, parts = {}) => String(RU[code]).split(/\{(\w+)\}/)
  .map((s, i) => (i % 2) ? (parts[s] || '[\\s\\S]*?') : escRe(s)).join('');
const ruRe = (code, parts) => new RegExp(ruSrc(code, parts));
const DATA = {
  probe: '\u043f\u0440\u043e\u0431\u0430',
  humanAccepted: '\u0447\u0435\u043b\u043e\u0432\u0435\u043a \u043f\u0440\u0438\u043d\u044f\u043b',
  kitReady: '\u043a\u043e\u043c\u043f\u043b\u0435\u043a\u0442 \u0433\u043e\u0442\u043e\u0432',
  doneRu: '\u0433\u043e\u0442\u043e\u0432\u043e',
  created: '\u0421\u043e\u0437\u0434\u0430\u043d\u043e:',
  first: '\u041f\u0415\u0420\u0412\u042b\u0419',
  second: '\u0412\u0422\u041e\u0420\u041e\u0419',
  foreignZone: '\u0427\u0443\u0436\u0430\u044f \u0437\u043e\u043d\u0430'
};

let fx;
test.before(() => { fx = makeFixture(); });
test.after(() => { if (fx) fx.cleanup(); });

const MOVE = '.forma/board/card-move.cjs';
const live = (id) => path.join(fx.root, '.devtool', 'features', id + '.md');
const done = (id) => path.join(fx.root, '.devtool', 'features', 'done', id + '.md');
const ID = 'card-001-nastroit-sborku-primera';

test('card-move: the full circle - status, assignee, the stage line, the board check clean', () => {
  const steps = [
    ['kit', 'todo', 'Kit', 'kit'], ['run', 'in-progress', 'Kit', 'exec'], ['intent', 'review', 'Intent', 'check'],
    ['accept', 'review', 'Intent', 'accept'],
  ];
  for (const [to, status, assignee, stage] of steps) {
    const r = run(fx, [MOVE, '001', '--to', to, '--note', DATA.probe + ' ' + to]);
    assert.equal(r.status, 0, r.out);
    const text = fs.readFileSync(live(ID), 'utf8');
    assert.match(text, new RegExp(`^status: "${status}"$`, 'm'));
    assert.match(text, new RegExp(`^assignee: "${assignee}"$`, 'm'));
    assert.match(text, new RegExp(`^- \`\\w+\`, \\d{4}-\\d{2}-\\d{2}: stage ${stage} — ${DATA.probe} ${to}\\.$\\n\\n## Result`, 'm'));
  }
  assert.equal(run(fx, ['.forma/board/check-board.cjs']).status, 0);
});

test('card-move: close - done/Core, completedAt, the file moves to done/', () => {
  const r = run(fx, [MOVE, 'card-001', '--to', 'close', '--note', DATA.humanAccepted]);
  assert.equal(r.status, 0, r.out);
  assert.ok(!fs.existsSync(live(ID)) && fs.existsSync(done(ID)));
  const text = fs.readFileSync(done(ID), 'utf8');
  assert.match(text, /^status: "done"$/m);
  assert.match(text, /^assignee: "Core"$/m);
  assert.match(text, /^completedAt: "\d{4}-/m);
  assert.equal(run(fx, [MOVE, '001', '--to', 'kit', '--note', 'x']).status, 2, 'a closed card is not handed over');
});

test('card-move: input errors - code 2, the file untouched', () => {
  assert.equal(run(fx, [MOVE, '001', '--to', 'nowhere', '--note', 'x']).status, 2);
  assert.equal(run(fx, [MOVE, '001', '--to', 'kit']).status, 2, 'no --note');
  assert.equal(run(fx, [MOVE, '999', '--to', 'kit', '--note', 'x']).status, 2, 'no card');
});

test('card-move: spend - the attempt line before the stage line, tally reads it', () => {
  const f = makeFixture();
  try {
    const p = path.join(f.root, '.devtool', 'features', ID + '.md');
    const ok = run(f, [MOVE, '001', '--to', 'run', '--note', DATA.kitReady, '--tokens', '52339', '--duration-ms', '41500',
      '--agent-id', 'a1b2c3d4e5f60718', '--cache-read', '40100', '--turns', '7']);
    assert.equal(ok.status, 0, ok.out);
    const text = fs.readFileSync(p, 'utf8');
    assert.match(text, new RegExp('^- `Kit`, \\d{4}-\\d{2}-\\d{2}: attempt, 52 339 tokens \\(40 100 cache-read\\), out unknown, 42 s, 7 turns, `a1b2c3d4e5f60718` — claude-code: ' + DATA.kitReady + '\\.\\n- `Kit`, \\d{4}-\\d{2}-\\d{2}: stage exec — ' + DATA.kitReady + '\\.\\n\\n## Result', 'm'));
    const noR = run(f, [MOVE, '001', '--to', 'intent', '--note', DATA.doneRu, '--tokens', '900', '--duration-ms', '3000', '--agent-id', 'c3d4e5f6a7b80912']);
    assert.equal(noR.status, 0, noR.out);
    assert.match(fs.readFileSync(p, 'utf8'),
      new RegExp('attempt, 900 tokens \\(cache-read unknown\\), out unknown, 3 s, `c3d4e5f6a7b80912` — claude-code: ' + DATA.doneRu + '\\.' + ruSrc('board.card-move.cache_read_unknown')));
    assert.equal(run(f, ['.forma/board/check-board.cjs']).status, 0);
    assert.equal(run(f, [MOVE, '001', '--to', 'accept', '--note', 'x', '--tokens', '5']).status, 2, 'not all spend fields');
    assert.equal(run(f, [MOVE, '001', '--to', 'accept', '--note', 'x', '--tokens', 'abc', '--duration-ms', '1', '--agent-id', 'z']).status, 2);
  } finally { f.cleanup(); }
});

// --kit / --result: the zone body is written by the same call as the handover (no separate card edit).
const { spawnSync } = require('node:child_process');
const withFx = (fn) => { const f = makeFixture(); try { fn(f); } finally { f.cleanup(); } };
const move = (f, args, input) => spawnSync(process.execPath, [MOVE, ...args], { cwd: f.root, encoding: 'utf8', env: f.env, input });
const cardText = (f) => fs.readFileSync(path.join(f.root, '.devtool', 'features', ID + '.md'), 'utf8');
const zoneOf = (text, head) => text.split(/\n## /).find((z) => z.startsWith(head)) || '';

test('card-move: --kit from stdin and --result as a string - the zones filled, the board check clean', () => withFx((f) => {
  assert.equal(move(f, ['001', '--to', 'kit', '--note', 'opened']).status, 0);
  const r1 = move(f, ['001', '--to', 'run', '--note', DATA.kitReady, '--kit', '-'], '- Role: run-text\n- Channel: internal\n');
  assert.equal(r1.status, 0, r1.stdout + r1.stderr);
  let text = cardText(f);
  assert.match(zoneOf(text, 'Kit'), /- Role: run-text\n- Channel: internal/);
  assert.match(text, /^status: "in-progress"$/m);
  const r2 = move(f, ['001', '--to', 'intent', '--note', DATA.doneRu, '--result', DATA.created + ' https://example.test/n/1']);
  assert.equal(r2.status, 0, r2.stdout + r2.stderr);
  text = cardText(f);
  assert.match(zoneOf(text, 'Result'), new RegExp(escRe(DATA.created) + ' https:\\/\\/example\\.test\\/n\\/1'));
  assert.match(text, /^status: "review"$/m);
  assert.equal(spawnSync(process.execPath, ['.forma/board/check-board.cjs'], { cwd: f.root, encoding: 'utf8', env: f.env }).status, 0);
}));

test('card-move: --kit replaces the zone body, does not append', () => withFx((f) => {
  move(f, ['001', '--to', 'kit', '--note', 'a']);
  move(f, ['001', '--to', 'run', '--note', 'b', '--kit', DATA.first]);
  assert.equal(move(f, ['001', '--to', 'run', '--note', 'c', '--kit', DATA.second]).status, 0);
  const kit = zoneOf(cardText(f), 'Kit');
  assert.match(kit, new RegExp(escRe(DATA.second)));
  assert.doesNotMatch(kit, new RegExp(escRe(DATA.first)));
}));

test('card-move: --kit/--result - only on their own handovers, no emptiness, no "## " line; the file untouched', () => withFx((f) => {
  const before = cardText(f);
  const bad = [
    [['001', '--to', 'accept', '--note', 'x', '--kit', 'z'], ruRe('board.card-move.kit_only_run')],
    [['001', '--to', 'run', '--note', 'x', '--result', 'z'], ruRe('board.card-move.result_only_intent')],
    [['001', '--to', 'run', '--note', 'x', '--kit', ''], ruRe('board.card-move.empty_value')],
    [['001', '--to', 'run', '--note', 'x', '--kit', 'a\n## ' + DATA.foreignZone + '\nb'], ruRe('board.card-move.heading_line')],
  ];
  for (const [args, re] of bad) {
    const r = move(f, args);
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stderr, re);
  }
  assert.equal(move(f, ['001', '--to', 'run', '--note', 'x', '--kit', '-'], '  \n').status, 2, 'empty stdin');
  assert.equal(cardText(f), before);
}));
