// engine-to-protocol.cjs: --apply <file> --add <the same file> carries the new file over; without --add - a refusal;
// an --add outside the MAP / layer 4 / not from the new list - a refusal before any write.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'engine-to-protocol.cjs');
const NEW = '.forma/board/fresh-tool.cjs';
const DST = ['.forma', 'protocol', 'skills', 'forma', 'core', 'board', 'fresh-tool.cjs'];

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2p-add-'));
  const put = (rel, text) => { const f = path.join(dir, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
  fs.mkdirSync(path.join(dir, '.forma', 'protocol', '.git'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.forma', 'protocol', 'skills', 'forma', 'core'), { recursive: true });
  put('.forma/protocol/skills/forma/adapters/claude/scripts/known.cjs', 'known\n');
  put('.claude/scripts/known.cjs', 'known\n');
  put(NEW, 'fresh\n');
  put('.claude/project-layer.txt', '.claude/scripts/own-layer.cjs\n');
  put('.claude/scripts/own-layer.cjs', 'own\n');
  put('outside/map.txt', 'x\n');
  put('project/config/X.md', 'x\n');
  return dir;
}
const run = (dir, ...a) => spawnSync(process.execPath, [SCRIPT, ...a], { cwd: dir, encoding: 'utf8' });
const dst = (dir) => path.join(dir, ...DST);

test('--apply F --add F writes the new file into the template', () => {
  const dir = fixture();
  try {
    const r = run(dir, '--apply', NEW, '--add', NEW);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.readFileSync(dst(dir), 'utf8'), 'fresh\n');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('--apply F without --add refuses with the new-file message, nothing written', () => {
  const dir = fixture();
  try {
    const r = run(dir, '--apply', NEW);
    assert.equal(r.status, 1);
    assert.match(r.stderr, new RegExp('\u043d\u043e\u0432\u044b\u0439 \u0444\u0430\u0439\u043b: \u043f\u0435\u0440\u0435\u043d\u043e\u0441\u0438\u0442\u0441\u044f \u043f\u043e --add'));
    assert.equal(fs.existsSync(dst(dir)), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('--add for a file outside the MAP, layer 4 or not from the new list refuses before any write', () => {
  for (const bad of ['outside/map.txt', '.claude/scripts/own-layer.cjs', 'project/config/X.md', '.claude/scripts/known.cjs']) {
    const dir = fixture();
    try {
      const r = run(dir, '--apply', NEW, '--add', NEW, '--add', bad);
      assert.equal(r.status, 1, bad + ': ' + r.stderr);
      assert.match(r.stderr, new RegExp('--add (\u043e\u0442\u043a\u0430\u0437\u0430\u043d|\u043d\u0435 \u0438\u0437 \u0441\u043f\u0438\u0441\u043a\u0430 \u043d\u043e\u0432\u044b\u0445)'), bad);
      assert.equal(fs.existsSync(dst(dir)), false, bad);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test('a run-protocol-* profile from project/extensions/ is an engine tool: it lands in the new ones, other extension copies do not', () => {
  const dir = fixture();
  try {
    const put = (rel, text) => { const f = path.join(dir, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
    put('.forma/protocol/skills/forma/adapters/claude/agents/run/existing.md', 'e\n');
    put('.claude/agents/run/existing.md', 'e\n');
    for (const n of ['run-protocol-x.md', 'run-other.md']) {
      put('.claude/agents/run/' + n, 't\n');
      put('project/extensions/template/claude/agents/run/' + n, 't\n');
    }
    const r = run(dir);
    assert.equal(r.status, 3, r.stderr);   // an unplaced new file - a stop with a question, as for any new one
    assert.match(r.stderr, /run-protocol-x\.md/);
    assert.doesNotMatch(r.stderr + r.stdout, /run-other\.md/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
