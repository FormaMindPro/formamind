// The check registries (the board - the core; the Claude Code engine sync): every check has a file and a
// line in the registry, the form is kept, and on the fixture with minimal damage the check "catches" (a
// finding by its id), on the clean one it does not.
// The full output texts - checks-output.test.cjs; here - each check's behavior on its own.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { makeFixture } = require('./helpers/fixture.cjs');
const { mutator } = require('./helpers/mutate.cjs');
const { CASES, CHECKS_JSON } = require('./helpers/check-cases.cjs');
// Russian strings below: fragments of validateChecks messages (dashboard/lib/checks.cjs still holds them
// literally) and data written into the fixture - byte-identical from ASCII source through unicode escapes.
const M = {
  latin: '\u0436\u0434\u0430\u043b\u0438 \u043b\u0430\u0442\u0438\u043d\u0438\u0446\u0443 \u0447\u0435\u0440\u0435\u0437 \u0434\u0435\u0444\u0438\u0441',
  twice: 'id \u0432\u0441\u0442\u0440\u0435\u0447\u0430\u0435\u0442\u0441\u044f \u0434\u0432\u0430\u0436\u0434\u044b',
  sinceKey: 'since \u2014 \u043a\u043b\u044e\u0447 \u043f\u0440\u0430\u0432\u0438\u043b\u0430 \u0438\u043b\u0438 null',
  runFn: 'run \u2014 \u043d\u0435 \u0444\u0443\u043d\u043a\u0446\u0438\u044f',
  otherRole: '\u0434\u0440\u0443\u0433\u0430\u044f \u0440\u043e\u043b\u044c',
  see: '\u0421\u043c.',
  end: '\u043a\u043e\u043d\u0435\u0446'
};

let fx;
let BOARD;
let SYNC;
let lib;
let parity;
const load = (rel) => require(path.join(fx.root, ...rel.split('/')));

test.before(() => {
  fx = makeFixture();
  mutator(fx.root).write('.forma/living/checks.json', JSON.stringify(CHECKS_JSON, null, 2) + '\n');
  lib = load('.forma/dashboard/lib/checks.cjs');
  BOARD = load('.forma/board/checks/index.cjs');
  SYNC = load('.claude/scripts/checks/index.cjs');
  parity = load('.claude/scripts/checks/support/role-parity.cjs');
});
test.after(() => { if (fx) fx.cleanup(); });

const registryOf = (c) => (c.registry === 'board' ? BOARD : SYNC);
const byId = (registry, id) => registry.find((check) => check.id === id);
const findings = (check, info = []) => lib.runChecks([check], { root: fx.root, info });

test('the registries: the form is kept (a latin unique id, since - a key or null, run a function)', () => {
  assert.deepEqual(lib.validateChecks(BOARD), []);
  assert.deepEqual(lib.validateChecks(SYNC), []);
});

test('the engine-sync registry is assembled from the board registry: the same modules, in the same order', () => {
  const ids = SYNC.map((c) => c.id);
  const from = ids.indexOf(BOARD[0].id);
  assert.deepEqual(ids.slice(from, from + BOARD.length), BOARD.map((c) => c.id));
});

test('validateChecks: catches a foreign id, a repeat, a crooked since, run not a function', () => {
  const ok = { id: 'good-one', since: null, run: () => [] };
  assert.deepEqual(lib.validateChecks([ok]), []);
  assert.match(lib.validateChecks([{ ...ok, id: 'Bad_Id' }]).join('\n'), new RegExp(M.latin));
  assert.match(lib.validateChecks([ok, ok]).join('\n'), new RegExp('good-one: ' + M.twice));
  assert.match(lib.validateChecks([{ ...ok, since: 5 }]).join('\n'), new RegExp('good-one: ' + M.sinceKey));
  assert.match(lib.validateChecks([{ ...ok, run: 'x' }]).join('\n'), new RegExp('good-one: ' + M.runFn));
});

test('runChecks: the since-day comes from living/checks.json, the findings order - the registry order', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-since-'));
  try {
    fs.mkdirSync(path.join(root, '.forma', 'living'), { recursive: true });
    fs.writeFileSync(path.join(root, '.forma', 'living', 'checks.json'), JSON.stringify({ known: '2030-05-05' }));
    const seen = [];
    const spy = (id, since) => ({ id, since, run: (ctx) => { seen.push([id, ctx.since]); return [id]; } });
    const out = lib.runChecks([spy('a-first', 'known'), spy('b-second', null), spy('c-third', 'fresh')], { root });
    assert.deepEqual(out, ['a-first', 'b-second', 'c-third']);
    assert.deepEqual(seen[0], ['a-first', '2030-05-05']);
    assert.deepEqual(seen[1], ['b-second', null]);
    assert.match(seen[2][1], /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.forma', 'living', 'checks.json'), 'utf8')).fresh, seen[2][1]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('every check file is in the registry, the id equals the file name; no extra registry lines', () => {
  const dirs = [['.forma/board/checks', BOARD], ['.forma/dashboard/checks', SYNC], ['.claude/scripts/checks', SYNC]];
  for (const [dir, registry] of dirs) {
    const files = fs.readdirSync(path.join(fx.root, dir)).filter((f) => f.endsWith('.cjs') && f !== 'index.cjs');
    for (const f of files) {
      const id = f.replace(/\.cjs$/, '');
      const mod = load(`${dir}/${f}`);
      if (mod.id === undefined) continue; // a gate script (a pre-commit hook tool, called by HOOK_BODY), not a registry check - no index.cjs line needed
      assert.ok(byId(registry, id), `${dir}/${f}: the check "${id}" is not in the registry - an index.cjs line is needed`);
      assert.equal(mod.id, id, `${dir}/${f}: the id is not the file name`);
    }
  }
  for (const check of BOARD) assert.ok(fs.existsSync(path.join(fx.root, '.forma', 'board', 'checks', check.id + '.cjs')), `${check.id}: no file`);
});

test('the clean fixture: no check of either registry finds anything', () => {
  for (const check of SYNC) {
    const info = [];
    assert.deepEqual(findings(check, info), [], `${check.id}: findings on a clean fixture`);
    assert.deepEqual(info.filter((l) => /Codex/.test(l)), [], `${check.id}: Codex info on a clean fixture`);
  }
});

for (const c of CASES.filter((x) => x.id)) {
  test(`the "${c.name}" damage: the "${c.id}" check catches, the others do not`, () => {
    const m = mutator(fx.root);
    try {
      c.apply(m);
      const registry = registryOf(c);
      const target = byId(registry, c.id);
      assert.ok(target, `${c.id}: not in the ${c.registry} registry`);
      const info = [];
      const found = findings(target, info);
      if (c.expect) assert.match(found.join('\n'), c.expect, `${c.id}: did not catch the "${c.name}" damage`);
      else assert.deepEqual(found, [], `${c.id}: info must not be findings`);
      if (c.expectInfo) assert.match(info.join('\n'), c.expectInfo, `${c.id}: no info about the "${c.name}" damage`);
      const needle = c.expect || c.expectInfo;
      for (const other of registry.filter((x) => x.id !== c.id)) {
        const otherInfo = [];
        const text = findings(other, otherInfo).concat(otherInfo).join('\n');
        assert.doesNotMatch(text, needle, `${other.id}: catches someone else's "${c.name}" damage`);
      }
    } finally {
      m.restore();
    }
  });
}

test('role parity: identical texts - synced, different - drift, a missing file - missing', () => {
  const core = '.agents/plugins/forma/agents/core.md';
  const m = mutator(fx.root);
  try {
    // the pair exists because the second engine has an adapter (engines.cjs): a stub that declares its role folder
    m.write('.agents/forma-adapter.cjs', "module.exports = { id: 'gemini', engine: 'gemini', sources: { rolesDir: '.agents/plugins/forma/agents' } };\n");
    const pairOf = () => parity.compareRoles(fx.root).find((r) => r.pair.name === 'Agent: Core').res;
    assert.equal(pairOf().status, 'missing_gemini');
    m.write(core, m.read('.claude/agents/core.md'));
    assert.equal(pairOf().status, 'synced');
    m.write(core, '# ' + M.otherRole + '\n');
    assert.equal(pairOf().status, 'drift');
    assert.match(pairOf().diff, /Line 1:/);
  } finally {
    m.restore();
  }
});

test('role normalization: line ends and the rules file name are not a drift', () => {
  const a = parity.normalizeText('---\nmodel: x\n---\n' + M.see + ' CLAUDE.md  \r\n' + M.end + '\r\n', 'agent');
  const b = parity.normalizeText('---\nmodel: y\n---\n' + M.see + ' gemini-8.md\n' + M.end + '\n', 'agent');
  assert.equal(a, b);
  assert.notEqual(parity.normalizeText('a\n', 'other'), parity.normalizeText('b\n', 'other'));
});
