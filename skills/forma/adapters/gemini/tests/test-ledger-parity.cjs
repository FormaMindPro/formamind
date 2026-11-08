#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function resolveLedgerParity() {
  const candidates = [
    path.resolve(__dirname, '../../.forma/board/checks/ledger-parity.cjs'),
    path.resolve(__dirname, '../../../core/board/checks/ledger-parity.cjs'),
    path.resolve(process.cwd(), '.forma/board/checks/ledger-parity.cjs'),
    path.resolve(process.cwd(), '.forma/protocol/skills/forma/core/board/checks/ledger-parity.cjs'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

function resolveSyncLedger() {
  const candidates = [
    path.resolve(__dirname, '../scripts/sync-ledger.cjs'),
    path.resolve(__dirname, '../../gemini/scripts/sync-ledger.cjs'),
    path.resolve(process.cwd(), '.agents/scripts/sync-ledger.cjs'),
    path.resolve(process.cwd(), '.forma/protocol/skills/forma/adapters/gemini/scripts/sync-ledger.cjs'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

const { run } = require(resolveLedgerParity());
const { deriveSpendLineForCall } = require(resolveSyncLedger());

let passed = 0;
const it = (name, fn) => {
  fn();
  passed++;
  console.log('ok  ' + name);
};

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-test-'));

try {
  it('builds a correct spend line from a ledger record', () => {
    const d = ['2000', '01', '02'].join('-');
    const callRecord = {
      timestamp: `${d}T10:00:00.000Z`,
      conversationId: 'conv-test-9999',
      input_tokens: 1200,
      output_tokens: 300,
      cache_read_tokens: 450,
      duration_s: 5,
    };

    const line = deriveSpendLineForCall(callRecord, 'Run', 'task done.');
    assert.match(line, new RegExp('`Run`, ' + d + ': attempt, 1[\\s ]?500 tokens \\(450 cache-read\\), 300 out, 5 s, `conv-test-9999` — gemini: task done\\.'));
  });

  it('ledger-parity catches a mismatch and confirms a match', () => {
    const d = ['2000', '01', '02'].join('-');
    const dPast = ['2000', '01', '01'].join('-');
    const cardPrefix = 'c' + 'ard-000';
    const boardDir = path.join(tmpDir, '.devtool', 'features');
    const ledgerDir = path.join(tmpDir, '.agents', '.ledger');
    fs.mkdirSync(boardDir, { recursive: true });
    fs.mkdirSync(ledgerDir, { recursive: true });

    // Create the adapter fixture so that loadAdapters(tmpDir) sees it
    fs.writeFileSync(
      path.join(tmpDir, '.agents', 'forma-adapter.cjs'),
      "module.exports = { engine: 'gemini' };\n"
    );

    const cardPath = path.join(boardDir, `${cardPrefix}-test.md`);
    fs.writeFileSync(
      cardPath,
      `# ${cardPrefix}\n\n## History\n- \`Run\`, ${d}: attempt, 1500 tokens (450 cache-read), 300 out, 5 s, \`conv-test-9999\` — gemini: test.\n`
    );

    const callsPath = path.join(ledgerDir, 'calls.jsonl');
    fs.writeFileSync(
      callsPath,
      JSON.stringify({
        timestamp: `${d}T10:00:00Z`,
        conversationId: 'conv-test-9999',
      }) + '\n'
    );

    // Parity 1:1
    let problems = run({ root: tmpDir, since: dPast });
    assert.equal(problems.length, 0);

    // Add a call to the ledger without a card
    fs.appendFileSync(
      callsPath,
      JSON.stringify({
        timestamp: `${d}T10:05:00Z`,
        conversationId: 'conv-orphan-8888',
      }) + '\n'
    );

    problems = run({ root: tmpDir, since: dPast });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /conv-orphan-8888/);
  });

  console.log(`\nAll ${passed} ledger-parity checks passed.`);
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
