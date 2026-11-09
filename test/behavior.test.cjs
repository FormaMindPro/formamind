// Behavior pins of the engine on the training project fixture (test/fixture/overlay/).
// The safety net of a refactoring series: the behavior before and after every iteration is the same.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeFixture } = require('./helpers/fixture.cjs');
const { snapshot } = require('./helpers/snapshot.cjs');
const { run, newCardDry, collect } = require('./helpers/outputs.cjs');

const BASELINE = path.join(__dirname, '.baseline');
let fx;

test.before(() => { fx = makeFixture(); });
test.after(() => { if (fx) fx.cleanup(); });

test('buildData: two runs in a row give one snapshot', () => {
  const a = snapshot(fx);
  const b = snapshot(fx);
  assert.equal(a, b);
  const data = JSON.parse(a);
  assert.equal(data.totals.cardCount, 3, 'three cards in the fixture');
});

test('check-board: the fixture without damage - clean', () => {
  const r = run(fx, ['.forma/board/check-board.cjs']);
  assert.equal(r.status, 0, r.out);
  assert.equal(r.out.trim(), '');
});

test('check-board: fixture damage (the epic field removed) - falls', () => {
  const card = path.join(fx.root, '.devtool', 'features', 'card-001-nastroit-sborku-primera.md');
  const orig = fs.readFileSync(card, 'utf8');
  try {
    fs.writeFileSync(card, orig.replace(/^epic:.*\r?\n/m, ''));
    const r = run(fx, ['.forma/board/check-board.cjs']);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, new RegExp('card-001-nastroit-sborku-primera\\.md: ' + "\u043a\u0430\u0440\u0442\u043e\u0447\u043a\u0430 \u0431\u0435\u0437 \u044d\u043f\u0438\u043a\u0430"));
  } finally {
    fs.writeFileSync(card, orig);
  }
  assert.equal(run(fx, ['.forma/board/check-board.cjs']).status, 0, 'after the restore clean again');
});

test('new-card --dry: the next number, the epic and labels from PROJECT.md, no file written', () => {
  const before = fs.readdirSync(path.join(fx.root, '.devtool', 'features')).sort();
  const r = newCardDry(fx);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /<ROOT>\/\.devtool\/features\/card-004-proba-setki\.md/);
  assert.match(r.out, /^epic: "3\. Project protocol"$/m);
  assert.match(r.out, /^labels: \["goal-protocol", "route-4"\]$/m);
  assert.match(r.out, /^## Task$/m);
  assert.deepEqual(fs.readdirSync(path.join(fx.root, '.devtool', 'features')).sort(), before);
});

test('sync-engines --check: a clean install with the fixture - green', () => {
  const r = run(fx, ['.claude/scripts/sync-engines.cjs', '--check']);
  assert.equal(r.status, 0, r.out.slice(-3000));
  assert.match(r.out, new RegExp('\u0417\u0430\u043a\u043e\u043d, \u044f\u0434\u0440\u043e \u0438 \u0433\u043e\u0442\u043e\u0432\u044b\u0435 \u0430\u0434\u0430\u043f\u0442\u0435\u0440\u044b \u0432 \u043f\u043e\u0440\u044f\u0434\u043a\u0435.'));
});

test('the economy and adapter-conformance tests - in the installed project', () => {
  for (const file of ['.forma/dashboard/economy.test.cjs', '.forma/dashboard/i18n.test.cjs', '.claude/scripts/claude-economy.test.cjs', '.claude/scripts/forma-adapter.test.cjs']) {
    const r = run(fx, [file]);
    assert.equal(r.status, 0, `${file}:\n${r.out.slice(-3000)}`);
  }
});

test('matching the test/.baseline/ reference (when saved)', (t) => {
  if (!fs.existsSync(BASELINE)) { t.skip('no test/.baseline/ - node test/baseline.cjs save'); return; }
  const now = collect(fx);
  for (const [name, text] of Object.entries(now)) {
    const file = path.join(BASELINE, name);
    assert.ok(fs.existsSync(file), `no ${name} in test/.baseline/`);
    assert.equal(text, fs.readFileSync(file, 'utf8'), `${name} drifted from the reference`);
  }
});
