// check-release.cjs: the move-damage scanner catches the samples and leaves honest paths alone; the protocol clone is clean.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { gitRun } = require('../scripts/lib/git.cjs');
const { scanCorruption, RULES } = require('../scripts/check-release.cjs');
// Trace-pattern data the scanner must catch (the ru card label, the attempt and criterion words)
// and the language-finding input: byte-identical from ASCII source through unicode escapes.
const TR = {
  see: '\u0441\u043c.',
  card: '\u041a\u0430\u0440\u0442\u043e\u0447\u043a\u0430 ',
  attempt: '\u043f\u043e\u043f\u044b\u0442\u043a\u0430 ',
  crit: '\u043a\u0440\u0438\u0442\u0435\u0440\u0438\u0439 ',
  cleanMsg: '\u0427\u0438\u0441\u0442\u043e\u0435 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435',
};


const R = '.' + 'forma/'; // not a whole literal - so the scanner does not blush on its own test

function repoWith(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-check-'));
  gitRun(dir, 'init', '-q');
  for (const [f, t] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), t); }
  gitRun(dir, 'add', '-A');
  return dir;
}

test('the scanner catches the three kinds of damage', () => {
  const dir = repoWith({
    'a.md': `${TR.see} github.com/mattpocock/${R}skills\n`,
    'b.md': `the path ${R}protocol/${R}skills/forma/\n`,
    'c.md': `the key \`${R}skills:\` and ${R}dashboard's\n`,
    'd.md': `site pages/${R}templates/blocks\n`,
  });
  assert.deepEqual([...new Set(scanCorruption(dir).map((x) => x.file))].sort(), ['a.md', 'b.md', 'c.md', 'd.md']);
});

test('the scanner leaves honest paths alone', () => {
  const dir = repoWith({ 'ok.md': `\`${R}skills/forma/SKILL.md\`, \`${R}manual/\`, ../${R}board/x, node ${R}board/new-card.cjs\n` });
  assert.deepEqual(scanCorruption(dir), []);
});

test('no damage has leaked into the protocol clone itself', () => {
  const bad = scanCorruption(path.join(__dirname, '..'));
  assert.deepEqual(bad.map((b) => `${b.file}:${b.line} ${b.rule}`), []);
});

test('there are at least three damage rules', () => {
  assert.ok(RULES.length >= 3);
});

const { scanTraces, scanMessages, changelogGate } = require('../scripts/check-release.cjs');

test('project traces in files: the card code and number, an attempt, a criterion, a date, the site name', () => {
  const dir = repoWith({
    'a.cjs': '// ' + 'card-' + '123\n',
    'b.md': TR.see + ' ' + TR.card + '45\n',
    'c.cjs': '// ' + TR.attempt + '2\n',
    'd.md': '' + TR.crit + '3\n',
    'e.md': 'updated 20' + '31-01-05\n',
    'f.md': 'the site iamforma' + '.pro\n',
    'g.cjs': '// ' + 'goal-' + '12\n',
  });
  assert.deepEqual([...new Set(scanTraces(dir).map((x) => x.file))].sort(), ['a.cjs', 'b.md', 'c.cjs', 'd.md', 'e.md', 'f.md', 'g.cjs']);
});

test('the card-001...009, card-099, goal-00 stubs and dates in test/ are not a trace', () => {
  const dir = repoWith({
    'a.md': 'card-001-x, card-099, goal-00, goal-01\n',
    'test/t.cjs': "// created: '20" + "31-01-05'\n",
  });
  assert.deepEqual(scanTraces(dir), []);
});

test('a date in CHANGELOG.md is not a trace - the version history is published by design', () => {
  const changelog = repoWith({ 'CHANGELOG.md': '## [1.0.0] - 20' + '31-01-05\n' });
  assert.deepEqual(scanTraces(changelog), []);
  const other = repoWith({ 'NOTES.md': 'dated 20' + '31-01-05\n' });
  assert.deepEqual(scanTraces(other).map((x) => x.rule), ['date']);
});

test('project traces in commit messages; a date in a message is allowed', () => {
  assert.equal(scanMessages(['Card ' + '134: grid', 'card-' + '197: set', 'v1 — 20' + '31-01-05', 'Clean message']).length, 2);
});

test('commit messages in Cyrillic are a language finding', () => {
  const bad = scanMessages(['Clean message', TR.cleanMsg]);
  assert.deepEqual(bad.map((b) => b.rule), ['language']);
});

test('no project traces have leaked into the protocol clone itself', () => {
  const bad = scanTraces(path.join(__dirname, '..'));
  assert.deepEqual(bad.map((b) => `${b.file}:${b.line} ${b.rule}`), []);
});

test('project traces: the domain, the site connector and the card count in a message', () => {
  const dir = repoWith({
    'a.md': 'on formacraft.studio the site\n',
    'b.md': 'use `mcp__novamira-example-site__execute` here\n',
    'c.md': 'clean line about mcp__site__ connector\n',
  });
  assert.deepEqual([...new Set(scanTraces(dir).map((x) => x.file))].sort(), ['a.md', 'b.md']);
  assert.deepEqual(scanMessages(['Core closed 11 cards', 'Add graph renderer']).map((x) => x.rule), ['card-count']);
});

test('a version without a tag needs its CHANGELOG section - the release does not ship without it', () => {
  const pending = repoWith({ '.claude-plugin/plugin.json': '{"version":"2.0.0"}', 'CHANGELOG.md': '## [1.0.0] - 20' + '31-01-05\n' });
  assert.equal(changelogGate(pending).ok, false);
  const ready = repoWith({ '.claude-plugin/plugin.json': '{"version":"2.0.0"}', 'CHANGELOG.md': '## [2.0.0] - 20' + '31-01-05\n\n### Added\n\n- the change\n' });
  assert.equal(changelogGate(ready).ok, true);
  const released = repoWith({ '.claude-plugin/plugin.json': '{"version":"2.0.0"}', 'CHANGELOG.md': 'no section\n' });
  gitRun(released, 'commit', '--allow-empty', '-m', 'fixture');
  gitRun(released, 'tag', 'v2.0.0');
  assert.equal(changelogGate(released).ok, true);
});
