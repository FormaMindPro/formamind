'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { skeletonOf } = require('../skills/forma/core/verify/verify-install.cjs');

const ROOT = path.resolve(__dirname, '..');
const SCAFFOLD_EN = path.join(ROOT, 'templates', '_scaffold', 'en');
const SCAFFOLD_RU = path.join(ROOT, 'templates', '_scaffold', 'ru');

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

test('scaffold parity: en and ru packages exist and have matching files', () => {
  assert.ok(fs.existsSync(SCAFFOLD_EN), 'templates/_scaffold/en exists');
  assert.ok(fs.existsSync(SCAFFOLD_RU), 'templates/_scaffold/ru exists');

  const enFiles = walk(SCAFFOLD_EN).map((f) => path.relative(SCAFFOLD_EN, f).replace(/\\/g, '/')).sort();
  const ruFiles = walk(SCAFFOLD_RU).map((f) => path.relative(SCAFFOLD_RU, f).replace(/\\/g, '/')).sort();

  assert.deepEqual(ruFiles, enFiles, 'file list in ru matches en');
  assert.ok(enFiles.length >= 30, 'scaffold has full set of files');
});

test('scaffold parity: anchors and markdown headings match between en and ru', () => {
  const enFiles = walk(SCAFFOLD_EN).map((f) => path.relative(SCAFFOLD_EN, f).replace(/\\/g, '/'));
  for (const rel of enFiles) {
    if (!rel.endsWith('.md')) continue;
    const enText = fs.readFileSync(path.join(SCAFFOLD_EN, rel), 'utf8');
    const ruText = fs.readFileSync(path.join(SCAFFOLD_RU, rel), 'utf8');

    // Anchors parity
    const enAnchors = [...enText.matchAll(/<!--\s*k:([a-zA-Z0-9_-]+)\s*-->/g)].map((m) => m[1]);
    const ruAnchors = [...ruText.matchAll(/<!--\s*k:([a-zA-Z0-9_-]+)\s*-->/g)].map((m) => m[1]);
    assert.deepEqual(ruAnchors, enAnchors, `${rel}: anchor mismatch`);

    // Heading structure parity (h1 and h2)
    const enSkel = skeletonOf(enText);
    const ruSkel = skeletonOf(ruText);
    assert.equal(ruSkel.h1, enSkel.h1, `${rel}: # heading count mismatch`);
    assert.equal(ruSkel.h2, enSkel.h2, `${rel}: ## heading count mismatch`);
  }
});
