// The check output texts on the fixture with damage (one case per check and all at once) match what is recorded
// in test/fixture/golden/. A refactoring of the checks changes neither the findings, nor their order, nor a word.
// Record again: UPDATE_GOLDEN=1 npm test (after a deliberate edit of a finding text).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeFixture } = require('./helpers/fixture.cjs');
const { run } = require('./helpers/outputs.cjs');
const { mutator } = require('./helpers/mutate.cjs');
const { CASES, CHECKS_JSON } = require('./helpers/check-cases.cjs');

const GOLDEN = path.join(__dirname, 'fixture', 'golden');
const BOARD = ['.forma/board/check-board.cjs'];
const syncArgs = (c) => ['.claude/scripts/sync-engines.cjs', ...(c.args || ['--check'])];
let fx;

test.before(() => {
  fx = makeFixture();
  // The rule since-days are fixed: a fresh install writes them via ruleSince ("tomorrow"), and the text would change every day.
  mutator(fx.root).write('.forma/living/checks.json', JSON.stringify(CHECKS_JSON, null, 2) + '\n');
});
test.after(() => { if (fx) fx.cleanup(); });

const shown = (title, r) => `# ${title}\nexit ${r.status}\n${r.out}`;
const lf = (s) => s.split('\r\n').join('\n');

function compare(name, actual) {
  const file = path.join(GOLDEN, name + '.txt');
  if (process.env.UPDATE_GOLDEN) {
    fs.mkdirSync(GOLDEN, { recursive: true });
    fs.writeFileSync(file, actual);
    return;
  }
  assert.ok(fs.existsSync(file), `no ${name}.txt in test/fixture/golden/ - UPDATE_GOLDEN=1 npm test`);
  assert.equal(actual, lf(fs.readFileSync(file, 'utf8')), `${name}: the output drifted from what is recorded`);
}

function withCase(cases, fn) {
  const m = mutator(fx.root);
  try {
    for (const c of cases) c.apply(m);
    return fn();
  } finally {
    m.restore();
  }
}

test('the clean fixture: the board and the sync output', () => {
  compare('clean', shown('check-board', run(fx, BOARD)) + shown('sync-engines', run(fx, syncArgs({}))));
});

for (const c of CASES) {
  test(`the "${c.name}" damage: the output as recorded`, () => {
    const actual = withCase([c], () => (c.registry === 'board' ? run(fx, BOARD) : run(fx, syncArgs(c))));
    compare(c.name, shown(c.registry === 'board' ? 'check-board' : 'sync-engines', actual));
  });
}

test('all the damage at once: the board and the sync output, the findings order', () => {
  const all = CASES.filter((c) => c.combine !== false);
  const text = withCase(all, () => shown('check-board', run(fx, BOARD))
    + shown('check-board card-001', run(fx, [...BOARD, 'card-001']))
    + shown('sync-engines --diff', run(fx, syncArgs({ args: ['--check', '--diff'] }))));
  compare('combined', text);
});
