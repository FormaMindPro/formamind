#!/usr/bin/env node
'use strict';

// The names resolver: codes into human names from the board, GOAL.md, and keys.json.
// node --test .forma/i18n/names.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const names = require('./names.cjs');

const ROOT = path.resolve(__dirname, '..', '..');

/** A temp root with the resolver copied in, one card and one goal. */
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'names-'));
  fs.cpSync(path.join(ROOT, '.forma', 'i18n'), path.join(dir, '.forma', 'i18n'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.devtool', 'features'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.devtool', 'features', 'card-7-probe.md'),
    '---\nid: "card-7-probe"\n---\n# card-7 \u00b7 Probe title\n\n## Task\n\n## Kit\n\n## History\n\n## Result\n');
  fs.writeFileSync(path.join(dir, '.devtool', 'features', 'card-8-nameless.md'),
    '---\nid: "card-8-nameless"\n---\n# card-8\n\n## Task\n\n## Kit\n\n## History\n\n## Result\n');
  fs.mkdirSync(path.join(dir, '.devtool', 'features', 'done'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.devtool', 'features', 'done', 'card-9-closed.md'),
    '---\nid: "card-9-closed"\n---\n# card-9 \u00b7 Closed title\n\n## Task\n\n## Kit\n\n## History\n\n## Result\n');
  fs.mkdirSync(path.join(dir, 'project', 'goals', 'goal-probe'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'project', 'goals', 'goal-probe', 'GOAL.md'),
    '# Main goal `probe` \u00b7 Probe name\n');
  return dir;
}

test('routes, overlays, law sections and prohibitions resolve in both languages', () => {
  const dir = fixture();
  try {
    assert.deepEqual(names.resolve(dir, 'route-8', 'ru'), { code: 'route-8', kind: 'route', name: '\u0441\u0442\u0440\u043e\u0439\u043a\u0430' });
    assert.equal(names.resolve(dir, 'route-2', 'en').name, 'the errand');
    assert.equal(names.resolve(dir, 'over-2', 'en').name, 'the contractor');
    assert.equal(names.resolve(dir, 'law-5', 'en').name, 'Prohibitions');
    assert.equal(names.resolve(dir, 'prohibition-20', 'ru').name, '\u043a\u043e\u0434 \u0441 \u0438\u043c\u0435\u043d\u0435\u043c');
    assert.equal(names.resolve(dir, 'prohibition-20', 'en').name, 'a code travels with its name');
    assert.equal(names.resolve(dir, 'route-9', 'en'), null, 'an unknown route must not resolve');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a card resolves by its board headline; a closed card in done resolves too; a nameless card does not', () => {
  const dir = fixture();
  try {
    const hit = names.resolve(dir, 'card-7', 'ru');
    assert.equal(hit.name, 'Probe title');
    assert.equal(names.render(hit, 'ru'), '\u0417\u0430\u0434\u0430\u0447\u0430-7 \u00abProbe title\u00bb');
    assert.equal(names.render(hit, 'en'), 'Card-7 "Probe title"');
    assert.equal(names.resolve(dir, 'card-9', 'en').name, 'Closed title');
    assert.equal(names.resolve(dir, 'card-8', 'ru'), null);
    assert.equal(names.resolve(dir, 'card-' + '999', 'ru'), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a goal resolves by folder or heading code; the name is the part after the middle dot', () => {
  const dir = fixture();
  try {
    assert.equal(names.resolve(dir, 'goal-probe', 'ru').name, 'Probe name');
    const hit = names.resolve(dir, 'goal-probe', 'ru');
    assert.match(names.render(hit, 'ru'), /\u0446\u0435\u043b\u044c \u00abProbe name\u00bb \(goal-probe\)/);
    assert.equal(names.resolve(dir, 'goal-other', 'ru'), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('scan keeps the order, drops duplicates, normalizes the section sign, omits name-less codes', () => {
  const dir = fixture();
  try {
    const hits = names.scan(dir, 'card-7 then route-8, card-7 again, \u00a75 and prohibition-20, card-8', 'en');
    assert.deepEqual(hits.map((h) => h.code), ['card-7', 'route-8', 'law-5', 'prohibition-20']);
    assert.ok(hits.every((h) => h.render && h.render.length));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the CLI prints code - name and exits 1 on an unresolved code', () => {
  const dir = fixture();
  try {
    const cli = path.join(dir, '.forma', 'i18n', 'names.cjs');
    const ok = spawnSync(process.execPath, [cli, 'card-7', 'route-8', 'goal-probe'], { encoding: 'utf8', env: { ...process.env, FORMA_LANG: 'en' } });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /card-7 \u2014 Probe title/);
    assert.match(ok.stdout, /route-8 \u2014 the build/);
    assert.match(ok.stdout, /goal-probe \u2014 Probe name/);
    const red = spawnSync(process.execPath, [cli, 'route-9'], { encoding: 'utf8', env: { ...process.env, FORMA_LANG: 'en' } });
    assert.equal(red.status, 1, 'an unresolved code must be red');
    assert.match(red.stdout, /route-9 \u2014 \?/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
