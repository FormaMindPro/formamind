'use strict';

// cycle-report.cjs: the cycle summary for the Core verdict, read from a synthetic board in a temporary
// directory. The script under test is the protocol source copy (skills/forma/core/board/); the live
// .forma/board copy is its byte-identical pair - the pair parity is a separate gate (cmp), not this test.
// Fixture card codes are composed at run time, 'card-' + (900 + k): a card-NNN literal in a clean zone
// flags prohibition 16, and the fixture carries no traces of a project. The Russian labels of the output
// are asserted through the dictionary value, never through a pinned copy of the text.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PROTO = path.resolve(__dirname, '..');
const SCRIPT = path.join(PROTO, 'skills', 'forma', 'core', 'board', 'cycle-report.cjs');
const EN = require(path.join(PROTO, 'skills', 'forma', 'core', 'i18n', 'messages', 'en.json'));
const RU = require(path.join(PROTO, 'skills', 'forma', 'core', 'i18n', 'messages', 'ru.json'));

// The temp base: FORMA_TEST_TMP when the path is alive, then the RAM disk, then the system fallback
// (the rule of the RAM disk). A dead FORMA_TEST_TMP falls through - the variable is never trusted blindly.
function tmpBase() {
  const env = process.env.FORMA_TEST_TMP;
  if (env && fs.existsSync(env)) return env;
  if (process.platform === 'win32' && fs.existsSync('R:\\')) return 'R:\\forma-tmp';
  if (process.platform !== 'win32' && fs.existsSync('/dev/shm')) return '/dev/shm';
  return os.tmpdir();
}

// The fixture codes are built, not written: no card-NNN literal anywhere in this file.
const probe = (k) => ['card', String(900 + k)].join('-');
const num = (k) => String(900 + k);
const DAY = () => new Date().toISOString().slice(0, 10);

// The five-field line of the Task zone: green gate for the working cards, red for the failing one.
const FIVE = (n) => `${n} · tooling | a synthetic summary script | check: node --eval process.exit(0) ; nothing else to decide | 2 | Intent checks by the gates`;
const FIVE_RED = (n) => `${n} · protocol | a synthetic failing script | check: node --eval process.exit(2) ; nothing else to decide | 3 | Intent checks by the gates`;

// A spend line (AGENTS.md §3 canon) and a stage line, as the nodes write them into History.
function spend(node, tokens, opts = {}) {
  const cache = opts.cache == null ? '(cache-read unknown)' : `(${opts.cache} cache-read)`;
  const tokensPart = opts.unknownTokens ? `unknown tokens ${cache}` : `${tokens} tokens ${cache}`;
  const out = opts.out == null ? ', out unknown' : `, ${opts.out} out`;
  const s = opts.s == null ? 'unknown s' : `${opts.s} s`;
  const id = opts.id == null ? '`id unknown`' : `\`${opts.id}\``;
  return `- \`${node}\`, ${DAY()}: attempt, ${tokensPart}${out}, ${s}, ${id} — test: synthetic call`;
}
const stage = (node, key, note) => `- \`${node}\`, ${DAY()}: stage ${key} — ${note}`;

function cardText(name, { labels = [], five, history = [], status = 'todo' } = {}) {
  const fm = ['---', `id: "${name}"`, `status: "${status}"`, 'assignee: "Kit"',
    'labels: [' + labels.map((l) => `"${l}"`).join(', ') + ']', '---'].join('\n');
  return `${fm}\n\n# ${name}\n\n## Task\n${five || 'no five-field line here'}\n\n## Kit\n\n## History\n${history.join('\n')}\n\n## Result\n`;
}

let fx;
test.before(() => {
  fx = { root: fs.mkdtempSync(path.join(tmpBase(), 'cycle-report-')) };
  const live = path.join(fx.root, '.devtool', 'features');
  const done = path.join(live, 'done');
  fs.mkdirSync(done, { recursive: true });
  const write = (dir, name, text) => fs.writeFileSync(path.join(dir, name + '.md'), text);
  write(live, probe(1) + '-proba-svodka', cardText(probe(1) + '-proba-svodka', {
    labels: ['goal-t1', 'route-7'], five: FIVE(num(1)),
    history: [stage('Kit', 'kit', 'first.'), spend('Kit', 100, { cache: 10, out: 10, s: 5, id: 'agent-a' }),
      spend('Kit', 200, { cache: 20, out: 20, s: 6, id: 'agent-b' }), spend('Run', 50, { out: 5, s: 2, id: 'agent-c' }),
      stage('Run', 'exec', 'second.')],
  }));
  write(done, probe(2) + '-proba-krug', cardText(probe(2) + '-proba-krug', {
    labels: ['goal-t1'], five: FIVE_RED(num(2)), status: 'done',
    history: [stage('Spec', 'card', 'written.'), spend('Spec', 0, { unknownTokens: true })],
  }));
  write(live, probe(3) + '-proba-vybor', cardText(probe(3) + '-proba-vybor', {
    labels: ['other'], five: FIVE(num(3)), history: [stage('Kit', 'kit', 'third.')],
  }));
  write(live, probe(4) + '-proba-pusto', cardText(probe(4) + '-proba-pusto', { history: [] }));
  write(live, probe(5) + '-proba-a', cardText(probe(5) + '-proba-a'));
  write(live, probe(5) + '-proba-b', cardText(probe(5) + '-proba-b'));
});
test.after(() => { try { fs.rmSync(fx.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch { /* temp cleanup is best-effort */ } });

function run(args, env = {}) {
  return spawnSync(process.execPath, [SCRIPT, '--root', fx.root, ...args], {
    cwd: fx.root, encoding: 'utf8', timeout: 120000, maxBuffer: 1 << 28,
    env: { ...process.env, FORMA_LANG: '', ...env },
  });
}

test('selection by the goal label: live and done cards, the foreign label stays out', () => {
  const r = run(['--label', 'goal-t1']);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes(EN['board.cycle-report.title']), 'the title line');
  assert.ok(r.stdout.includes(`## ${probe(1)}`), 'the live card is in');
  assert.ok(r.stdout.includes(`## ${probe(2)}`), 'the done card is in: at the verdict the cycle may be closed');
  assert.ok(!r.stdout.includes(`## ${probe(3)}`), 'a card without the label stays out');
  assert.ok(r.stdout.includes(`${EN['board.cycle-report.labels']}: goal-t1`), 'the selection line names the label');
});

test('explicit codes: union with the label, full and short codes, comma form', () => {
  const r = run(['--label', 'goal-t1', '--cards', `${probe(3)},${probe(4)}`]);
  assert.equal(r.status, 0, r.stderr);
  for (const p of [probe(1), probe(2), probe(3), probe(4)]) {
    assert.ok(r.stdout.includes(`## ${p}`), `in the report: ${p}`);
  }
  assert.ok(r.stdout.includes(`${EN['board.cycle-report.codes']}: ${probe(3)}, ${probe(4)}`), 'the selection line names the codes');
});

test('a short code resolves by its unique prefix; ambiguous and missing codes are refused (exit 2)', () => {
  const short = run(['--cards', probe(1)]);
  assert.equal(short.status, 0, short.stderr);
  assert.ok(short.stdout.includes(`## ${probe(1)}`));
  const ambiguous = run(['--cards', probe(5)]);
  assert.equal(ambiguous.status, 2);
  assert.match(ambiguous.stderr, /ambiguous/);
  assert.match(ambiguous.stderr, new RegExp(probe(5) + '-proba-a'));
  const missing = run(['--cards', ['card', String(303)].join('-')]);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /not on the board/);
});

test('nothing named - nothing reported (exit 2); a label matching nothing - exit 1, not an empty report', () => {
  const none = run([]);
  assert.equal(none.status, 2);
  assert.ok(none.stderr.includes(EN['board.cycle-report.usage_select']), 'the usage line names both ways of selection');
  const noMatch = run(['--label', 'goal-nosuch']);
  assert.equal(noMatch.status, 1);
  assert.ok(noMatch.stderr.includes(EN['board.cycle-report.no_cards']));
});

test('five fields, the last stage line, the gate statuses and the verdict, per card', () => {
  const r = run(['--label', 'goal-t1', '--cards', [probe(3), probe(4)].join(',')]);
  assert.equal(r.status, 0, r.stderr);
  for (const [field, value] of [['kind', num(1) + ' · tooling'], ['delivers', 'a synthetic summary script'],
    ['criterion', 'check: node --eval process.exit(0)'], ['budget', '2'], ['next', 'Intent checks by the gates']]) {
    assert.ok(r.stdout.includes(`| ${EN['board.cycle-report.field_' + field]} | ${value}`), `the ${field} row of the green-gate card`);
  }
  assert.ok(r.stdout.includes(EN['board.cycle-report.stage'] + ': `Run`') && r.stdout.includes('stage exec — second.'),
    'the last stage line is the latest one');
  assert.ok(!r.stdout.includes('— first.'), 'an earlier stage line is not shown');
  assert.ok(r.stdout.includes(`gate-1: ${EN['board.cycle-report.gate_green']}`),
    'the green gate of the green-gate card; the card section as rendered: ' +
    r.stdout.slice(r.stdout.indexOf('## ' + probe(1)), r.stdout.indexOf('## ' + probe(3))));
  assert.ok(r.stdout.includes(EN['board.cycle-report.ready']), 'the green verdict');
  assert.ok(r.stdout.includes(`gate-1: ${EN['board.cycle-report.gate_red']}`), 'the red gate of the red-gate card');
  assert.ok(r.stdout.includes(EN['board.cycle-report.not_ready']), 'the red verdict');
  assert.ok(r.stdout.includes(EN['board.cycle-report.no_fields']), 'the no-fields card reports its Task zone has no five-field line');
  assert.ok(r.stdout.includes(EN['board.cycle-report.gate_error'].split('{msg}')[0]), 'the no-fields card reports the check-ready failure, not a fake verdict');
});

test('the spend lines are summed per node by the shared parser; unknown-token lines counted apart', () => {
  const r = run(['--label', 'goal-t1']);
  assert.equal(r.status, 0, r.stderr);
  const spend = EN['board.cycle-report.spend'];
  const head = spend.split('\n')[0];
  assert.ok(r.stdout.includes(`## ${head}`), 'the spend table heading');
  assert.ok(r.stdout.includes('| `Kit` | 2 | 300 | 30 | 11 |'), 'Kit: 100 + 200 tokens, 30 out, 11 s');
  assert.ok(r.stdout.includes('| `Run` | 1 | 50 | 5 | 2 |'), 'Run: one line');
  assert.ok(r.stdout.includes('| `Spec` | 1 | 0 | - | - |'), 'Spec: only an unknown-token line');
  assert.ok(r.stdout.includes(`| ${EN['board.cycle-report.total']} | 4 | 350 | 35 | 13 |`), 'the total row');
  assert.ok(r.stdout.includes(EN['board.cycle-report.unknown'].replace('{n}', '1')), 'the unknown-token footnote');
});

test('--out writes the file; --stdout prints the full markdown even when --out is given', () => {
  const out = path.join(fx.root, 'report.md');
  const quiet = run(['--label', 'goal-t1', '--out', out]);
  assert.equal(quiet.status, 0, quiet.stderr);
  assert.ok(quiet.stdout.includes('ok: ' + EN['board.cycle-report.written'].split('{file}')[0]), 'a confirmation line, not the report');
  assert.ok(!quiet.stdout.includes(EN['board.cycle-report.title']), 'the markdown stays out of the console');
  const file = fs.readFileSync(out, 'utf8');
  assert.ok(file.startsWith(`# ${EN['board.cycle-report.title']}`), 'the file carries the report');
  assert.ok(file.includes(`## ${probe(1)}`), 'the file carries the cards');
  const both = run(['--label', 'goal-t1', '--out', out, '--stdout']);
  assert.equal(both.status, 0, both.stderr);
  assert.ok(both.stdout.includes(EN['board.cycle-report.title']), 'with --stdout the console carries the full markdown too');
});

test('the labels speak the project language: FORMA_LANG=ru renders the ru values of the dictionary', () => {
  const r = run(['--label', 'goal-t1'], { FORMA_LANG: 'ru' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes(RU['board.cycle-report.title']), 'the ru title');
  assert.ok(r.stdout.includes(RU['board.cycle-report.spend']), 'the ru spend heading');
  assert.ok(r.stdout.includes(RU['board.cycle-report.total']), 'the ru total row');
});
