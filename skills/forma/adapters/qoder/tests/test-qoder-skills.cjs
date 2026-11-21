#!/usr/bin/env node
'use strict';

/**
 * test-qoder-skills.cjs - the Qoder skill surface and the names reminder.
 * It checks:
 *  1. the core canon `.forma/skills/human-register/SKILL.md` and the mirror `.qoder/skills/...` exist;
 *  2. the mirror is byte-identical to the canon (a hand-edited copy is a drift);
 *  3. the role `intent.md` declares the skill in its `uses:` line;
 *  4. settings.json wires `names-context.cjs` on UserPromptSubmit, and the hook is installed;
 *  5. the hook appends names for codes in a human prompt, stays silent without codes, and is fail-open
 *     on unreadable input.
 *
 * Run:
 *   node .qoder/tests/test-qoder-skills.cjs
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function findRoot(start) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, 'AGENTS.md'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return path.resolve(start);
    dir = up;
  }
}

const root = findRoot(__dirname);
const CANON = path.join(root, '.forma', 'skills', 'human-register', 'SKILL.md');
const MIRROR = path.join(root, '.qoder', 'skills', 'human-register', 'SKILL.md');
const HOOK = path.join(root, '.qoder', 'engine', 'hooks', 'names-context.cjs');

let passed = 0;
const it = (name, fn) => { fn(); passed += 1; console.log('ok  ' + name); };

const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

it('the canon and the Qoder mirror of human-register exist', () => {
  assert.ok(fs.existsSync(CANON), 'no core canon at .forma/skills/human-register/SKILL.md');
  assert.ok(fs.existsSync(MIRROR), 'no Qoder mirror at .qoder/skills/human-register/SKILL.md');
});

it('the Qoder mirror is byte-identical to the core canon', () => {
  assert.equal(sha(MIRROR), sha(CANON), 'the Qoder mirror drifted from the core canon');
});

it('the role intent.md names human-register in uses:', () => {
  const text = fs.readFileSync(path.join(root, '.qoder', 'engine', 'agents', 'intent.md'), 'utf8');
  const m = /^uses:\s*(.+)$/m.exec(text);
  assert.ok(m, 'intent.md has no uses: line');
  assert.ok(m[1].split(',').map((s) => s.trim()).includes('human-register'), 'uses: lacks human-register');
});

it('settings.json wires names-context.cjs on UserPromptSubmit', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, '.qoder', 'settings.json'), 'utf8'));
  const commands = (config.hooks.UserPromptSubmit || []).flatMap((e) => (e.hooks || []).map((h) => h.command));
  assert.ok(commands.some((c) => /names-context\.cjs/.test(c)), 'UserPromptSubmit does not run names-context');
  assert.ok(fs.existsSync(HOOK), 'the names-context hook is not installed');
});

/** A temp project with the resolver, one card and one goal; the hook copied in. */
function probeRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qoder-names-'));
  fs.cpSync(path.join(root, '.forma', 'i18n'), path.join(dir, '.forma', 'i18n'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.devtool', 'features'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.devtool', 'features', 'card-7-probe.md'),
    '---\nid: "card-7-probe"\n---\n# card-7 \u00b7 Probe title\n\n## Task\n\n## Kit\n\n## History\n\n## Result\n');
  fs.mkdirSync(path.join(dir, 'project', 'goals', 'goal-probe'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'project', 'goals', 'goal-probe', 'GOAL.md'),
    '# Main goal `probe` \u00b7 Probe name\n');
  fs.mkdirSync(path.join(dir, '.qoder', 'engine', 'hooks'), { recursive: true });
  fs.copyFileSync(HOOK, path.join(dir, '.qoder', 'engine', 'hooks', 'names-context.cjs'));
  return dir;
}

const run = (dir, input) => spawnSync(process.execPath, [path.join(dir, '.qoder', 'engine', 'hooks', 'names-context.cjs')], {
  cwd: dir, input, encoding: 'utf8', env: { ...process.env, FORMA_LANG: 'en' },
});

it('the hook appends names for the codes in the human prompt', () => {
  const dir = probeRoot();
  try {
    const r = run(dir, JSON.stringify({ prompt: 'Please take card-7, route-8, goal-probe and prohibition-20' }));
    assert.equal(r.status, 0, r.stderr);
    for (const want of ['Card-7 "Probe title"', 'route "the build" (route-8)', 'goal "Probe name" (goal-probe)', 'prohibition 20']) {
      assert.ok(r.stdout.includes(want), 'the hook did not print ' + want + ': ' + r.stdout);
    }
    assert.ok(r.stdout.includes('[names]'), 'no names tag: ' + r.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it('the hook stays silent without codes and is fail-open on unreadable input', () => {
  const dir = probeRoot();
  try {
    const quiet = run(dir, JSON.stringify({ prompt: 'no protocol codes here' }));
    assert.equal(quiet.status, 0);
    assert.equal(quiet.stdout.trim(), '', 'the hook printed without codes: ' + quiet.stdout);
    const broken = run(dir, 'not json at all');
    assert.equal(broken.status, 0, 'the hook is not fail-open');
    assert.equal(broken.stdout.trim(), '', 'the hook printed on unreadable input');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

console.log(`\n${passed} checks passed`);
