// Unit tests of adapters/claude/scripts/checks/support/clean-zone.cjs: a layer 4 entry
// (.claude/project-layer.txt) naming a directory must take all the files inside out of the check,
// not only an exact path match.
const test = require('node:test');
const assert = require('node:assert/strict');
const { isOwn, inCleanZone } = require('../skills/forma/adapters/claude/scripts/checks/support/clean-zone.cjs');

test('isOwn: an exact file match', () => {
  const own = new Set(['.claude/scripts/po_shift_check.py']);
  assert.equal(isOwn('.claude/scripts/po_shift_check.py', own), true);
  assert.equal(isOwn('.claude/scripts/other.py', own), false);
});

test('isOwn: a directory entry covers the files inside', () => {
  const own = new Set(['.claude/skills/novamira-wp-deploy']);
  assert.equal(isOwn('.claude/skills/novamira-wp-deploy', own), true);
  assert.equal(isOwn('.claude/skills/novamira-wp-deploy/SKILL.md', own), true);
  assert.equal(isOwn('.claude/skills/novamira-wp-deploy-other/SKILL.md', own), false);
});

test('inCleanZone: a file inside a layer 4 directory is not checked for project traces', () => {
  const own = new Set(['.claude/skills/novamira-wp-deploy']);
  assert.equal(inCleanZone('.claude/skills/novamira-wp-deploy/SKILL.md', own), false);
  // a neighboring skill of the same clean zone - checked as usual
  assert.equal(inCleanZone('.claude/skills/novamira-wp-elementor/SKILL.md', own), true);
});
