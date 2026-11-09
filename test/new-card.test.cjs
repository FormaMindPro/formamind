'use strict';

// new-card.cjs: the card creation on the training fixture (bin/forma.cjs init). The script under test is
// the installed copy: new-card resolves the board and the dictionaries from its own location, so the
// protocol source copy runs only from an install; the live .forma/board copy is its byte-identical pair -
// the pair parity is a separate gate (cmp), not this test. Covered here: the stage line carries the
// separator and the dictionary text (no i18n key-code fallback), the history lines are signed by --node
// (`Intent` by default), and the number is taken without a race with just-created files - two invocations,
// side by side or in a row, never share one number. The Russian fragments of the script's own output are
// asserted through the dictionary value, never through a pinned copy.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { makeFixture, runNode } = require('./helpers/fixture.cjs');
const RU = require('../skills/forma/core/i18n/messages/ru.json');

const NEWCARD = '.forma/board/new-card.cjs';
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ru = (code, parts = {}) => String(RU[code]).replace(/\{(\w+)\}/g, (m, k) => (k in parts ? parts[k] : m));
const stageRe = (node) => new RegExp(`^- \`${node}\`, \\d{4}-\\d{2}-\\d{2}: stage card` + escRe(RU['board.new-card.stage_created']) + '$', 'm');
const routeRe = (node) => new RegExp(`^- \`${node}\`, \\d{4}-\\d{2}-\\d{2}: route route-0 \\(why: tooling\\)\\.$`, 'm');
const featuresOf = (f) => path.join(f.root, '.devtool', 'features');
const createdCards = (f, slug) => fs.readdirSync(featuresOf(f)).filter((n) => n.startsWith('card-') && n.includes(slug)).sort();
const idOf = (r) => /card-\d+-[a-z0-9-]+\.md/.exec(r.stdout)[0].replace(/\.md$/, '');
const cardText = (f, id) => fs.readFileSync(path.join(featuresOf(f), id + '.md'), 'utf8');
const withFx = async (fn) => { const f = makeFixture(); try { return await fn(f); } finally { f.cleanup(); } };

test('new-card: the stage line carries the separator and the dictionary text, no key-code fallback', () => withFx(async (f) => {
  const r = runNode(f, [NEWCARD, '--kind', 'analytics', '--title', 'probe stage line', '--stage', 'card']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const text = cardText(f, idOf(r));
  assert.match(text, stageRe('Intent'), 'the stage line: node, key, the dictionary text with the dash');
  assert.doesNotMatch(text, /stage card[a-z]/, 'a missing i18n key must not print its code into the line');
  assert.doesNotMatch(text, /new-card\.stage_created/, 'no dictionary key code in the card');
}));

test('new-card: --node signs the history lines, Intent stays the default, a bad name stops before the write', () => withFx(async (f) => {
  const r1 = runNode(f, [NEWCARD, '--kind', 'analytics', '--title', 'node probe one', '--route', '0', '--why', 'tooling', '--stage', 'card', '--node', 'Run']);
  assert.equal(r1.status, 0, r1.stdout + r1.stderr);
  let text = cardText(f, idOf(r1));
  assert.match(text, routeRe('Run'), 'the route line is signed by --node');
  assert.match(text, stageRe('Run'), 'the stage line is signed by --node');

  const r2 = runNode(f, [NEWCARD, '--kind', 'analytics', '--title', 'node probe two', '--route', '0', '--why', 'tooling']);
  assert.equal(r2.status, 0, r2.stdout + r2.stderr);
  text = cardText(f, idOf(r2));
  assert.match(text, routeRe('Intent'), 'without --node the lines stay Intent (backward compatibility)');

  const bad = runNode(f, [NEWCARD, '--kind', 'analytics', '--title', 'node probe three', '--node', '9x']);
  assert.equal(bad.status, 2, 'a bad node name stops');
  assert.match(bad.stderr, new RegExp(escRe(ru('board.new-card.bad_node', { node: '9x' }))), bad.stderr);
  assert.equal(createdCards(f, 'node-probe-three').length, 0, 'nothing is written');
}));

test('new-card: two calls in a row take two different numbers', () => withFx(async (f) => {
  const args = [NEWCARD, '--kind', 'analytics', '--title', 'race probe sequential', '--stage', 'card'];
  const r1 = runNode(f, args);
  assert.equal(r1.status, 0, r1.stdout + r1.stderr);
  const r2 = runNode(f, args);
  assert.equal(r2.status, 0, r2.stdout + r2.stderr);
  const n1 = Number(/card-(\d+)-/.exec(idOf(r1))[1]);
  const n2 = Number(/card-(\d+)-/.exec(idOf(r2))[1]);
  assert.equal(n2, n1 + 1, `two calls in a row: ${n1} then ${n2}`);
}));

test('new-card: two concurrent invocations never share a number (the exclusive create)', () => withFx(async (f) => {
  const spawnOne = () => new Promise((resolve) => {
    const p = spawn(process.execPath, [path.resolve(f.root, NEWCARD), '--kind', 'analytics', '--title', 'race probe parallel', '--stage', 'card'], { cwd: f.root, env: f.env });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => resolve({ code, out }));
  });
  const [a, b] = await Promise.all([spawnOne(), spawnOne()]);
  assert.equal(a.code, 0, a.out);
  assert.equal(b.code, 0, b.out);
  const cards = createdCards(f, 'race-probe-parallel');
  assert.equal(cards.length, 2, 'both invocations wrote a card: ' + cards.join(', '));
  const nums = new Set(cards.map((n) => Number(/^card-(\d+)-/.exec(n)[1])));
  assert.equal(nums.size, 2, 'two files, two numbers: ' + cards.join(', '));
}));
