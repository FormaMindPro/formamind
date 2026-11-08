#!/usr/bin/env node
'use strict';
// The reverse check of ledger-parity: a card's spend line -> the call ledger. A fixture in a temp directory.
// The semantics: an id outside the ledger - a note ("the journal does not cover", ctx.info), not a violation;
// a numeric mismatch for a call the ledger has - a violation. Seconds are not reconciled (different T bases).
// The expected ru phrases are taken from the core dictionary (fixed ru) with the same parameters the check
// puts in: the test asserts the check's message, not its own copy of the string.
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('../../.forma/board/checks/ledger-parity.cjs');
const i18n = require('../../.forma/i18n/index.cjs');
const msg = (code, params) => i18n.message(code, params, 'ru');

const D1 = ['2000', '01', '02'].join('-');
const D2 = ['2000', '01', '03'].join('-');
const SINCE = ['2000', '01', '01'].join('-');
const FIX = 'c' + 'ard-000';
const DIR = '.agents';
const TAG = 'gemini';

let passed = 0;
const it = (name, fn) => { fn(); passed += 1; console.log('ok  ' + name); };

function fixture(ledgerLines, cardLines) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-rev-'));
  fs.mkdirSync(path.join(root, '.devtool', 'features'), { recursive: true });
  fs.mkdirSync(path.join(root, DIR, '.ledger'), { recursive: true });
  fs.writeFileSync(path.join(root, DIR, 'forma-adapter.cjs'), "module.exports = { engine: 'gemini' };\n");
  fs.writeFileSync(path.join(root, DIR, '.ledger', 'calls.jsonl'), ledgerLines.map((l) => JSON.stringify(l)).join('\n') + (ledgerLines.length ? '\n' : ''));
  fs.writeFileSync(path.join(root, '.devtool', 'features', FIX + '-t.md'), '# t\n\n## History\n' + cardLines.map((l) => '- ' + l).join('\n') + '\n');
  return root;
}
const row = (d, id, nums) => '`Run`, ' + d + ': attempt, ' + (nums || '100 tokens (10 cache-read), 5 out') + ', 1 s, ' + id + ' — gemini: x';
const call = (d, id, tokens) => Object.assign({ timestamp: d + 'T10:00:00Z', conversationId: id }, tokens || {});

it('an id outside the ledger - the "journal does not cover" note, not a violation; an id from the ledger - neither', () => {
  const root = fixture([call(D1, 'conv-in-ledger')], [row(D2, '`conv-in-ledger`'), row(D2, '`conv-missing-1`')]);
  const info = [];
  const p = run({ root, since: SINCE, info });
  assert.deepEqual(p, []);
  assert.equal(info.length, 1);
  assert.ok(info[0].includes(msg('board.ledger-parity.uncovered_note_one', { n: 1 }).trim()));
  assert.ok(info[0].includes('conv-missing-1'));
  assert.ok(!info[0].includes('conv-in-ledger'));
});

it('an id unknown line is skipped; a line of the ledger-install day is skipped; a line older than since is skipped', () => {
  const root = fixture([call(D1, 'conv-in-ledger')], [
    row(D2, '`id unknown`'),
    row(D1, '`conv-same-day-1`'),
    row(['1999', '12', '31'].join('-'), '`conv-old-1`'),
    row(D2, '`conv-in-ledger`'),
  ]);
  const info = [];
  assert.deepEqual(run({ root, since: SINCE, info }), []);
  assert.deepEqual(info, []);
});

it('an empty journal with the engine spend lines - a note, neither silence nor a violation', () => {
  const root = fixture([], [row(D2, '`conv-x-1`')]);
  const info = [];
  const p = run({ root, since: SINCE, info });
  assert.deepEqual(p, []);
  assert.equal(info.length, 1);
  // the note names the empty journal: the head of the message up to the first parameter, and the "empty" word
  const empty = msg('board.ledger-parity.empty_journal', { dir: DIR, n: 1, tag: TAG }).trim();
  assert.ok(info[0].includes(empty));
});

it('an empty journal without engine spend lines - silence', () => {
  const root = fixture([], []);
  assert.deepEqual(run({ root, since: SINCE }), []);
});

it('the numbers match (the ledger with totals, the same line) - silence', () => {
  const root = fixture(
    [call(D1, 'conv-num-ok', { input_tokens: 85, output_tokens: 5, cache_read_tokens: 10, cache_write_tokens: 0 })],
    [row(D2, '`conv-num-ok`')]
  );
  const info = [];
  assert.deepEqual(run({ root, since: SINCE, info }), []);
  assert.deepEqual(info, []);
});

it('a numeric mismatch for a call from the ledger - a violation with the line address and both sums', () => {
  const root = fixture(
    [call(D1, 'conv-num-bad', { input_tokens: 90, output_tokens: 5, cache_read_tokens: 10, cache_write_tokens: 0 })],
    [row(D2, '`conv-num-bad`')] // Σ 100 against 105 in the ledger
  );
  const info = [];
  const p = run({ root, since: SINCE, info });
  assert.equal(p.length, 1);
  // "with a mismatch of the numbers" - the bracketed phrase of the header, taken from the dictionary
  const header = msg('board.ledger-parity.mismatch_header', { n: 1 });
  const phrase = header.slice(header.indexOf('(') + 1, header.indexOf(')'));
  assert.ok(p[0].includes(phrase));
  assert.ok(p[0].includes('conv-num-bad'));
  assert.ok(p[0].includes('100 tokens'));
  assert.ok(p[0].includes(msg('board.ledger-parity.diff_tokens', { s: 100, t: 105 })));
  assert.ok(p[0].includes(new RegExp(FIX + '-t\\.md').source));
  assert.deepEqual(info, []);
});

it('unknown tokens lines for a call from the ledger - nothing to reconcile, silence; "out unknown" does not hinder', () => {
  const root = fixture(
    [call(D1, 'conv-unk', { input_tokens: 85, output_tokens: 5, cache_read_tokens: 10, cache_write_tokens: 0 })],
    [row(D2, '`conv-unk`', 'unknown tokens (cache-read unknown), out unknown')]
  );
  assert.deepEqual(run({ root, since: SINCE, info: [] }), []);
});

it('the batch shares summed over the id lines give the ledger total - silence', () => {
  const root = fixture(
    [call(D1, 'conv-batch', { input_tokens: 0, output_tokens: 10, cache_read_tokens: 20, cache_write_tokens: 0 })],
    [row(D2, '`conv-batch`', '15 tokens (10 cache-read), 5 out'), row(D2, '`conv-batch`', '15 tokens (10 cache-read), 5 out')]
  );
  assert.deepEqual(run({ root, since: SINCE, info: [] }), []);
});

it('extraRows - a line not on the board yet is reconciled on a par with the read ones', () => {
  const root = fixture([call(D1, 'conv-extra')], []);
  const info = [];
  const p = run({
    root, since: SINCE, info,
    extraRows: [
      { file: FIX + '-t.md', line: '- ' + row(D2, '`conv-extra`') },           // ties the ledger call
      { file: FIX + '-t.md', line: '- ' + row(D2, '`conv-extra-missing`') },   // outside the ledger - a note
    ],
  });
  assert.deepEqual(p, []);
  assert.equal(info.length, 1);
  assert.ok(info[0].includes('conv-extra-missing'));
});

console.log(`\n${passed} reverse checks passed`);
