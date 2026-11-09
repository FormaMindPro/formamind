// The engine outputs on the fixture, reduced to a machine-independent form:
// the root and HOME paths by markers, the card creation date by a marker, the line endings - LF.
const { runNode } = require('./fixture.cjs');
const { snapshot } = require('./snapshot.cjs');

const slash = (s) => s.split('\\').join('/');

function clean(text, fx) {
  let out = text.split('\r\n').join('\n');
  for (const [from, to] of [[fx.root, '<ROOT>'], [slash(fx.root), '<ROOT>'], [fx.home, '<HOME>'], [slash(fx.home), '<HOME>']]) {
    out = out.split(from).join(to);
  }
  return out;
}

function run(fx, args) {
  const r = runNode(fx, args);
  return { status: r.status, out: clean((r.stdout || '') + (r.stderr || ''), fx) };
}

// The card title stays Russian on purpose: new-card transliterates it into the card slug
// (card-004-proba-setki.md), which behavior.test.cjs pins. Data, not code: unicode escapes.
const TITLE = '\u041f\u0440\u043e\u0431\u0430 \u0441\u0435\u0442\u043a\u0438';
const NEW_CARD_ARGS = ['.forma/board/new-card.cjs', '--kind', 'protocol', '--title', TITLE, '--route', '4', '--dry'];

function newCardDry(fx) {
  const r = run(fx, NEW_CARD_ARGS);
  return { status: r.status, out: slash(r.out).replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, '<now>') };
}

// Everything compared "before/after" a refactoring: name -> text.
function collect(fx) {
  const board = run(fx, ['.forma/board/check-board.cjs']);
  const sync = run(fx, ['.claude/scripts/sync-engines.cjs', '--check']);
  const card = newCardDry(fx);
  return {
    'build-data.json': snapshot(fx),
    'check-board.txt': `exit ${board.status}\n${board.out}`,
    'sync-engines-check.txt': `exit ${sync.status}\n${sync.out}`,
    'new-card-dry.txt': `exit ${card.status}\n${card.out}`,
  };
}

module.exports = { run, newCardDry, collect, NEW_CARD_ARGS };
