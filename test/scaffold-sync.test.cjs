'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  checkLanguage,
  compareFiles,
  listTargetLanguages,
  main,
} = require('../scripts/scaffold-sync.cjs');

const ROOT = path.resolve(__dirname, '..');
const REAL_SCAFFOLD = path.join(ROOT, 'templates', '_scaffold');

test('scaffold-sync: lists bundled target languages', () => {
  const langs = listTargetLanguages(REAL_SCAFFOLD);
  assert.ok(langs.includes('ru'), 'ru language package is listed');
  assert.equal(langs.includes('en'), false, 'en is the canonical base, not listed in target languages');
});

test('scaffold-sync: live ru package has 100% parity with en', () => {
  const res = checkLanguage(REAL_SCAFFOLD, 'ru');
  assert.equal(res.pass, true, `discrepancies found: ${JSON.stringify(res.discrepancies)}`);
  assert.equal(res.discrepancies.length, 0);
  assert.ok(res.filesChecked >= 30);
});

test('scaffold-sync: detects missing and extra files on synthetic fixtures', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scaffold-sync-test-'));
  try {
    const enDir = path.join(tmp, 'en');
    const mockDir = path.join(tmp, 'de');
    fs.mkdirSync(enDir, { recursive: true });
    fs.mkdirSync(mockDir, { recursive: true });

    fs.writeFileSync(path.join(enDir, 'A.md'), '# Title\n\nSome text.\n');
    fs.writeFileSync(path.join(enDir, 'B.md'), '# Title B\n');
    fs.writeFileSync(path.join(mockDir, 'A.md'), '# Title\n\nSome text.\n');
    fs.writeFileSync(path.join(mockDir, 'C.md'), '# Unexpected\n'); // extra file

    const res = checkLanguage(tmp, 'de');
    assert.equal(res.pass, false);

    const missing = res.discrepancies.find((d) => d.type === 'missing-file');
    assert.ok(missing, 'missing file detected');
    assert.equal(missing.rel, 'B.md');

    const extra = res.discrepancies.find((d) => d.type === 'extra-file');
    assert.ok(extra, 'extra file detected');
    assert.equal(extra.rel, 'C.md');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('scaffold-sync: detects missing anchors and heading count mismatches', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scaffold-sync-anchor-'));
  try {
    const enDir = path.join(tmp, 'en');
    const mockDir = path.join(tmp, 'fr');
    fs.mkdirSync(enDir, { recursive: true });
    fs.mkdirSync(mockDir, { recursive: true });

    const enText = '# Main\n\n<!-- k:feature -->\n\n## Sub\n\n<!-- k:config -->\n';
    const frText = '# Main\n\n<!-- k:feature -->\n'; // missing '## Sub' and '<!-- k:config -->'

    fs.writeFileSync(path.join(enDir, 'test.md'), enText);
    fs.writeFileSync(path.join(mockDir, 'test.md'), frText);

    const res = checkLanguage(tmp, 'fr');
    assert.equal(res.pass, false);

    const missingAnchor = res.discrepancies.find((d) => d.type === 'missing-anchor');
    assert.ok(missingAnchor);
    assert.match(missingAnchor.expected, /k:config/);

    const headingMismatch = res.discrepancies.find((d) => d.type === 'heading-count-mismatch');
    assert.ok(headingMismatch);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('scaffold-sync: CLI exits 0 on valid languages and 1 on broken fixtures', () => {
  // 1. Live ru check
  const codeOk = main(['--scaffold-dir', REAL_SCAFFOLD, '--lang', 'ru']);
  assert.equal(codeOk, 0);

  // 2. Mock broken language check
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scaffold-sync-cli-'));
  try {
    const enDir = path.join(tmp, 'en');
    const mockDir = path.join(tmp, 'xx');
    fs.mkdirSync(enDir, { recursive: true });
    fs.mkdirSync(mockDir, { recursive: true });
    fs.writeFileSync(path.join(enDir, 'test.md'), '# Heading\n');

    const codeFail = main(['--scaffold-dir', tmp, '--lang', 'xx']);
    assert.equal(codeFail, 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
