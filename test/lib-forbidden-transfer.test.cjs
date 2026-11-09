// Unit tests of scripts/lib/forbidden-transfer.cjs: what engine-to-protocol.cjs does not carry
// into the protocol by --apply, by --add, or by a MAP hit.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readOwnLayer, isForbiddenTransfer, FORBIDDEN_PREFIX } = require('../scripts/lib/forbidden-transfer.cjs');

test('FORBIDDEN_PREFIX covers the product zones', () => {
  assert.deepEqual(FORBIDDEN_PREFIX, ['project/', '.devtool/', '.forma/living/']);
});

test('isForbiddenTransfer: product/board/living zones are forbidden regardless of layer 4', () => {
  const own = new Set();
  assert.equal(isForbiddenTransfer('project/config/SITE.md', own), true);
  assert.equal(isForbiddenTransfer('project', own), true);
  assert.equal(isForbiddenTransfer('.devtool/features/card-001.md', own), true);
  assert.equal(isForbiddenTransfer('.forma/living/CHANGELOG.md', own), true);
  assert.equal(isForbiddenTransfer('.claude/agents/core.md', own), false);
});

test('isForbiddenTransfer: a layer 4 entry - a file or a directory path, the directory covers everything inside', () => {
  const own = new Set(['.claude/skills/novamira-wp-deploy', '.claude/scripts/po_shift_check.py']);
  assert.equal(isForbiddenTransfer('.claude/skills/novamira-wp-deploy', own), true);
  assert.equal(isForbiddenTransfer('.claude/skills/novamira-wp-deploy/SKILL.md', own), true);
  assert.equal(isForbiddenTransfer('.claude/scripts/po_shift_check.py', own), true);
  assert.equal(isForbiddenTransfer('.claude/skills/novamira-wp-elementor/SKILL.md', own), false);
});

test('readOwnLayer: the .claude/project-layer.txt lines without comments and empty lines', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'own-layer-'));
  try {
    fs.mkdirSync(path.join(dir, '.claude'));
    fs.writeFileSync(path.join(dir, '.claude', 'project-layer.txt'), '# a comment\n\n.claude/scripts/a.cjs\n.claude/skills/b\n');
    assert.deepEqual(readOwnLayer(dir), new Set(['.claude/scripts/a.cjs', '.claude/skills/b']));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readOwnLayer: no file - an empty set', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'own-layer-empty-'));
  try {
    assert.deepEqual(readOwnLayer(dir), new Set());
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
