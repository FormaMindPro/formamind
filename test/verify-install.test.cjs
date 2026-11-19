// The install integrity: the installer writes the manifest, `verify-install` checks it against the disk.
// A clean install (en and ru) - green; every violation is named by address, with the expected and the found.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FORMA = path.resolve(__dirname, '..', 'bin', 'forma.cjs');
const tmps = [];

const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-verify-')); tmps.push(d); return d; };
function install(lang, dir = tmp()) {
  const r = spawnSync(process.execPath, [FORMA, 'init', '--dir', dir, '--engines', 'claude', '--board', 'skip', '--lang', lang, '--yes'], { encoding: 'utf8' });
  return { dir, r };
}
const verify = (dir) => {
  const r = spawnSync(process.execPath, [path.join(dir, '.forma', 'verify', 'verify-install.cjs'), '--root', dir], { encoding: 'utf8' });
  return { status: r.status, out: r.stdout + r.stderr };
};
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
const write = (dir, rel, t) => fs.writeFileSync(path.join(dir, rel), t);

test.after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });

for (const lang of ['en', 'ru']) {
  test(`the --lang ${lang} install: the manifest written, the check green`, () => {
    const { dir, r } = install(lang);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /install is intact/);
    const m = JSON.parse(read(dir, '.forma/install-manifest.json'));
    assert.equal(m.lang, lang);
    assert.ok(Object.keys(m.files).length > 100 && Object.keys(m.skeleton).length > 20);
    assert.match(read(dir, 'project/config/PROJECT.md'), lang === 'ru'
      ? /<!-- k:language -->[^\n]*\u0420\u0443\u0441\u0441\u043A\u0438\u0439/
      : /<!-- k:language -->[^\n]*English/);
    assert.equal(fs.existsSync(path.join(dir, '.forma/translation-pending.json')), false);
    const v = verify(dir);
    assert.equal(v.status, 0, v.out);
  });
}

test('the unbundled language install: installs English scaffold and schedules translation marker', () => {
  const { dir, r } = install('de');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fs.existsSync(path.join(dir, '.forma/translation-pending.json')), true);
  const m = JSON.parse(read(dir, '.forma/translation-pending.json'));
  assert.equal(m.to, 'de');
  assert.ok(m.files.length >= 30);
});

test('the skeleton translation: the heading text changes - the check green; a lost heading - red with the address', () => {
  const { dir } = install('ru');
  write(dir, 'project/ops/VALUE.md', read(dir, 'project/ops/VALUE.md').replace(/^# .*/m, '# Value').replace(/^## .*/gm, '## Section'));
  const ok = verify(dir);
  assert.equal(ok.status, 0, ok.out);
  write(dir, 'project/ops/VALUE.md', read(dir, 'project/ops/VALUE.md').replace(/^## .*/gm, ''));
  const v = verify(dir);
  assert.equal(v.status, 1);
  assert.match(v.out, /project\/ops\/VALUE\.md — «##» headings — expected: ≥ \d+ — found: 0/);
});

test('the red names the address, the expected and the found', async (t) => {
  const { dir: base } = install('en');
  // every case - on its own copy of the clean install; the edit receives its root
  const cases = [
    ['a hook removed', (d) => fs.rmSync(path.join(d, '.claude/hooks/intent-start.sh')),
      /\.claude\/hooks\/intent-start\.sh — expected: installer file — found: file missing/],
    ['the hook dropped out of settings.json', (d) => {
      const s = JSON.parse(read(d, '.claude/settings.json'));
      for (const g of s.hooks.SessionStart) g.hooks = g.hooks.filter((h) => !/check-ready/.test(h.command));
      write(d, '.claude/settings.json', JSON.stringify(s));
    }, /hooks\.SessionStart\[startup\] — expected: command «bash \.claude\/hooks\/check-ready\.sh»/],
    ['an installer file changed', (d) => write(d, '.forma/board/new-card.cjs', read(d, '.forma/board/new-card.cjs') + '\n// x\n'),
      /\.forma\/board\/new-card\.cjs — expected: sha256 \w+… — found: sha256 \w+… \(file changed after install\)/],
    ['the .cjs syntax', (d) => write(d, '.forma/board/check-board.cjs', '(((\n'),
      /check-board\.cjs — expected: parses as CommonJS — found: /],
    ['a root CLAUDE.md', (d) => write(d, 'CLAUDE.md', 'x\n'),
      /CLAUDE\.md — expected: no root CLAUDE\.md/],
    ['a placeholder in tools:', (d) => write(d, '.claude/agents/spec.md', read(d, '.claude/agents/spec.md').replace(/^tools:.*/m, 'tools: Read, mcp__<srv>__*')),
      /spec\.md — tools: — expected: tool names without placeholders — found: mcp__<srv>__\*/],
    ['the manifest removed', (d) => fs.rmSync(path.join(d, '.forma/install-manifest.json')),
      /install-manifest\.json — expected: install manifest — found: file missing/],
  ];
  for (const [name, apply, expect] of cases) {
    await t.test(name, () => {
      const copy = tmp();
      fs.cpSync(base, copy, { recursive: true });
      apply(copy);
      const v = verify(copy);
      assert.equal(v.status, 1, v.out);
      assert.match(v.out, expect);
    });
  }
});

test('a reinstall on a live project: the check green, the skeleton not recalculated', () => {
  const { dir } = install('en');
  write(dir, 'project/ops/ROADMAP.md', read(dir, 'project/ops/ROADMAP.md') + '\n## A human added a section\n');
  const again = install('en', dir).r;
  assert.equal(again.status, 0, again.stdout + again.stderr);
  const v = verify(dir);
  assert.equal(v.status, 0, v.out);
});

test('the dev cycle: a manifest older than the clone is a named finding, refreshManifest re-records it', () => {
  const VI = require('../skills/forma/core/verify/verify-install.cjs');
  const { dir } = install('en');
  // no clone - a consumer project: no staleness finding
  let v = verify(dir);
  assert.equal(v.status, 0, v.out);
  // the dev clone appears, its version is ahead: the finding names the address, the expected and the remedy
  fs.mkdirSync(path.join(dir, '.forma', 'protocol'), { recursive: true });
  write(dir, '.forma/protocol/package.json', JSON.stringify({ version: '9.9.9', line: 2 }));
  v = verify(dir);
  assert.equal(v.status, 1);
  assert.match(v.out, /install-manifest\.json — version — expected: the dev clone .* 9\.9\.9 — found: 0\.0\.\d+ .* forma-commit .* installer/s);
  // the engine's file drifted since the install: the refresh re-records the hashes and picks the clone's version
  write(dir, '.claude/hooks/intent-start.sh', read(dir, '.claude/hooks/intent-start.sh') + '\n# a dev edit\n');
  const m0 = JSON.parse(read(dir, '.forma/install-manifest.json'));
  const ref = VI.refreshManifest(dir, { version: '9.9.9', line: 2 });
  assert.equal(ref.version, '9.9.9');
  assert.equal(ref.line, 2);
  assert.ok(ref.changed >= 1, 'at least the drifted file re-recorded');
  assert.deepEqual(ref.missing, []);
  const m1 = JSON.parse(read(dir, '.forma/install-manifest.json'));
  assert.equal(m1.version, '9.9.9');
  assert.notEqual(m1.files['.claude/hooks/intent-start.sh'], m0.files['.claude/hooks/intent-start.sh']);
  v = verify(dir);
  assert.equal(v.status, 0, v.out); // the drift and the lag are both gone
  assert.equal(m1.version, VI.refreshManifest(dir, {}).version); // a call without arguments keeps the version
  // a file gone from the disk keeps its entry: a refresh never blesses a deletion
  fs.rmSync(path.join(dir, '.claude/hooks/intent-start.sh'));
  const ref2 = VI.refreshManifest(dir, {});
  assert.deepEqual(ref2.missing, ['.claude/hooks/intent-start.sh']);
  v = verify(dir);
  assert.equal(v.status, 1);
  assert.match(v.out, /\.claude\/hooks\/intent-start\.sh — expected: installer file — found: file missing/);
});
