// An update without --engines reinstalls the engines the project's manifest records (once claude alone was the
// default and the other engines lagged behind); --all is the explicit form (a first install with no manifest:
// every active engine); --engines wins over --all; a dormant recorded engine is skipped with a note.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FORMA = path.resolve(__dirname, '..', 'bin', 'forma.cjs');
const run = (dir, ...flags) => spawnSync(process.execPath, [FORMA, 'init', '--dir', dir, '--board', 'skip', '--yes', ...flags], { encoding: 'utf8' });
const manifestOf = (dir) => JSON.parse(fs.readFileSync(path.join(dir, '.forma', 'install-manifest.json'), 'utf8'));
const engineIds = (dir) => manifestOf(dir).engines.map((e) => e.id);

test('update without --engines: the recorded engines are reinstalled, a deleted engine file comes back', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-upd-1-'));
  try {
    assert.equal(run(dir, '--engines', 'claude,gemini,zcode').status, 0);
    fs.rmSync(path.join(dir, '.zcode', 'rules', 'zcode-8.md'));
    fs.rmSync(path.join(dir, '.agents', 'rules', 'gemini-8.md'));
    const r = run(dir); // the plain --yes update: no --engines
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /Gemini \(Antigravity\)/);
    assert.match(r.stdout, /ZCode:/);
    assert.ok(fs.existsSync(path.join(dir, '.zcode', 'rules', 'zcode-8.md')), 'zcode §8 is back');
    assert.ok(fs.existsSync(path.join(dir, '.agents', 'rules', 'gemini-8.md')), 'gemini §8 is back');
    assert.deepEqual(engineIds(dir), ['claude', 'gemini', 'zcode']);
    assert.match(r.stdout, /the set recorded in \.forma\/install-manifest\.json/);
    assert.match(r.stdout, /install is intact/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('--all on a project without a manifest: every active engine, dormant ones excluded', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-upd-2-'));
  try {
    const r = run(dir, '--all');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /--all: no install manifest — every active engine/);
    assert.deepEqual(engineIds(dir), ['claude', 'gemini', 'zcode']);
    assert.ok(!fs.existsSync(path.join(dir, '.codex')), 'codex sleeps');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('--engines wins over --all', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-upd-3-'));
  try {
    assert.equal(run(dir, '--engines', 'claude,gemini,zcode').status, 0);
    const r = run(dir, '--all', '--engines', 'claude');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stderr, /--engines wins/);
    // only the named engine ran: no Gemini/ZCode install lines, the manifest records claude alone
    assert.doesNotMatch(r.stdout, /Gemini \(Antigravity\)/);
    assert.doesNotMatch(r.stdout, /ZCode:/);
    assert.deepEqual(engineIds(dir), ['claude']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a dormant engine recorded in the manifest is skipped with a note, not an error', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-upd-4-'));
  try {
    assert.equal(run(dir, '--engines', 'claude').status, 0);
    const m = manifestOf(dir);
    m.engines.push({ id: 'codex', note: 'not verified: no profile yet' });
    fs.writeFileSync(path.join(dir, '.forma', 'install-manifest.json'), JSON.stringify(m, null, 2) + '\n');
    const r = run(dir); // the recorded set: claude + codex (dormant)
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /engine codex: recorded in the manifest, dormant in this release — skipped/);
    assert.ok(!fs.existsSync(path.join(dir, '.codex')));
    assert.deepEqual(engineIds(dir), ['claude']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a first install without --engines and without --all keeps the claude default', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-upd-5-'));
  try {
    const r = run(dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(engineIds(dir), ['claude']);
    assert.ok(!fs.existsSync(path.join(dir, '.agents', 'rules', 'gemini-8.md')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the help carries the --all line and the update default', () => {
  const r = spawnSync(process.execPath, [FORMA, 'init', '--help'], { encoding: 'utf8' });
  const all = r.stdout.split(String.fromCharCode(10)).find((l) => l.includes('--all'));
  assert.match(all, /every component the project records/);
  assert.match(r.stdout, /recorded engines are reinstalled/);
});
