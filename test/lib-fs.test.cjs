// Unit tests of dashboard/lib/fs.cjs: the walk, JSON, reading without falling.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { walk, readJson, writeJsonAtomic, readIfExists } = require('../skills/forma/core/dashboard/lib/fs.cjs');

let dir;
test.before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lib-fs-'));
  fs.mkdirSync(path.join(dir, 'a', 'b'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'skipme'));
  fs.writeFileSync(path.join(dir, 'top.md'), 'x');
  fs.writeFileSync(path.join(dir, 'a', 'one.md'), 'x');
  fs.writeFileSync(path.join(dir, 'a', 'two.txt'), 'x');
  fs.writeFileSync(path.join(dir, 'a', 'b', 'deep.md'), 'x');
  fs.writeFileSync(path.join(dir, 'skipme', 'hidden.md'), 'x');
});
test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

test('walk: all files, paths from the root through "/"', () => {
  assert.deepEqual(walk(dir).sort(), ['a/b/deep.md', 'a/one.md', 'a/two.txt', 'skipme/hidden.md', 'top.md']);
});

test('walk: ext keeps the files with the ending', () => {
  assert.deepEqual(walk(dir, { ext: '.md' }).sort(), ['a/b/deep.md', 'a/one.md', 'skipme/hidden.md', 'top.md']);
});

test('walk: abs gives absolute paths', () => {
  const files = walk(dir, { abs: true, ext: '.txt' });
  assert.deepEqual(files, [path.join(dir, 'a', 'two.txt')]);
});

test('walk: skip skips a directory with its contents; it receives the relative path', () => {
  const seen = [];
  const files = walk(dir, { skip: (e, rel) => { seen.push(rel); return e.isDirectory() && e.name === 'skipme'; } });
  assert.ok(!files.some((f) => f.startsWith('skipme/')));
  assert.ok(seen.includes('a/b'), 'skip sees the directory path from the root');
});

test('walk: no directory - an empty list', () => {
  assert.deepEqual(walk(path.join(dir, 'absent-dir')), []);
});

test('walk: a directory that cannot be read falls, with tolerant it is skipped', () => {
  const file = path.join(dir, 'top.md');
  assert.throws(() => walk(file));
  assert.deepEqual(walk(file, { tolerant: true }), []);
});

test('readJson: the file present, absent, broken', () => {
  const ok = path.join(dir, 'ok.json');
  fs.writeFileSync(ok, '{"a":1}');
  fs.writeFileSync(path.join(dir, 'bad.json'), '{oops');
  assert.deepEqual(readJson(ok), { a: 1 });
  assert.equal(readJson(path.join(dir, 'absent.json')), null);
  assert.deepEqual(readJson(path.join(dir, 'absent.json'), {}), {});
  assert.deepEqual(readJson(path.join(dir, 'bad.json'), []), []);
});

test('writeJsonAtomic: indent 2, a trailing newline, no temp file left', () => {
  const f = path.join(dir, 'out.json');
  writeJsonAtomic(f, { a: [1, 2] });
  assert.equal(fs.readFileSync(f, 'utf8'), JSON.stringify({ a: [1, 2] }, null, 2) + '\n');
  assert.ok(!fs.readdirSync(dir).some((n) => n.endsWith('.tmp')));
});

test('readIfExists: the text, or the fallback value', () => {
  assert.equal(readIfExists(path.join(dir, 'top.md')), 'x');
  assert.equal(readIfExists(path.join(dir, 'absent.md')), '');
  assert.equal(readIfExists(path.join(dir, 'absent.md'), null), null);
});
