#!/usr/bin/env node
'use strict';
// Обратная сверка ledger-parity: строка расхода карточки → журнал вызовов. Фикстура во временном каталоге.
// Семантика: id вне журнала — сведение («журнал не покрывает», ctx.info), не нарушение; числовое расхождение
// для вызова, который в журнале есть, — нарушение. Секунды не сверяются (разные основания T).
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('../../.forma/board/checks/ledger-parity.cjs');

const D1 = ['2000', '01', '02'].join('-');
const D2 = ['2000', '01', '03'].join('-');
const SINCE = ['2000', '01', '01'].join('-');
const FIX = 'c' + 'ard-000';

let passed = 0;
const it = (name, fn) => { fn(); passed += 1; console.log('ok  ' + name); };

function fixture(ledgerLines, cardLines) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-rev-'));
  fs.mkdirSync(path.join(root, '.devtool', 'features'), { recursive: true });
  fs.mkdirSync(path.join(root, '.agents', '.ledger'), { recursive: true });
  fs.writeFileSync(path.join(root, '.agents', 'forma-adapter.cjs'), "module.exports = { engine: 'gemini' };\n");
  fs.writeFileSync(path.join(root, '.agents', '.ledger', 'calls.jsonl'), ledgerLines.map((l) => JSON.stringify(l)).join('\n') + (ledgerLines.length ? '\n' : ''));
  fs.writeFileSync(path.join(root, '.devtool', 'features', FIX + '-t.md'), '# t\n\n## History\n' + cardLines.map((l) => '- ' + l).join('\n') + '\n');
  return root;
}
const row = (d, id, nums) => '`Run`, ' + d + ': attempt, ' + (nums || '100 tokens (10 cache-read), 5 out') + ', 1 s, ' + id + ' — gemini: x';
const call = (d, id, tokens) => Object.assign({ timestamp: d + 'T10:00:00Z', conversationId: id }, tokens || {});

it('id вне журнала — сведение «журнал не покрывает», не нарушение; id из журнала — ни того ни другого', () => {
  const root = fixture([call(D1, 'conv-in-ledger')], [row(D2, '`conv-in-ledger`'), row(D2, '`conv-missing-1`')]);
  const info = [];
  const p = run({ root, since: SINCE, info });
  assert.deepEqual(p, []);
  assert.equal(info.length, 1);
  assert.match(info[0], /журнал не покрывает/);
  assert.match(info[0], /conv-missing-1/);
  assert.doesNotMatch(info[0], /conv-in-ledger/);
});

it('id unknown пропущена; строка дня установки журнала пропущена; строка раньше since пропущена', () => {
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

it('пустой журнал при строках расхода движка — сведение, а не молчание и не нарушение', () => {
  const root = fixture([], [row(D2, '`conv-x-1`')]);
  const info = [];
  const p = run({ root, since: SINCE, info });
  assert.deepEqual(p, []);
  assert.equal(info.length, 1);
  assert.match(info[0], /пуст/);
});

it('пустой журнал без строк расхода движка — тихо', () => {
  const root = fixture([], []);
  assert.deepEqual(run({ root, since: SINCE }), []);
});

it('числа сходятся (журнал с итогами, строка та же) — тихо', () => {
  const root = fixture(
    [call(D1, 'conv-num-ok', { input_tokens: 85, output_tokens: 5, cache_read_tokens: 10, cache_write_tokens: 0 })],
    [row(D2, '`conv-num-ok`')]
  );
  const info = [];
  assert.deepEqual(run({ root, since: SINCE, info }), []);
  assert.deepEqual(info, []);
});

it('числовое расхождение для вызова из журнала — нарушение с адресом строки и обеими суммами', () => {
  const root = fixture(
    [call(D1, 'conv-num-bad', { input_tokens: 90, output_tokens: 5, cache_read_tokens: 10, cache_write_tokens: 0 })],
    [row(D2, '`conv-num-bad`')] // Σ 100 против 105 в журнале
  );
  const info = [];
  const p = run({ root, since: SINCE, info });
  assert.equal(p.length, 1);
  assert.match(p[0], /расхождением чисел/);
  assert.match(p[0], /conv-num-bad/);
  assert.match(p[0], /100 tokens/);
  assert.match(p[0], /в журнале 105/);
  assert.match(p[0], new RegExp(FIX + '-t\\.md'));
  assert.deepEqual(info, []);
});

it('строки unknown tokens для вызова из журнала — сверять нечего, тихо; «out unknown» не мешает', () => {
  const root = fixture(
    [call(D1, 'conv-unk', { input_tokens: 85, output_tokens: 5, cache_read_tokens: 10, cache_write_tokens: 0 })],
    [row(D2, '`conv-unk`', 'unknown tokens (cache-read unknown), out unknown')]
  );
  assert.deepEqual(run({ root, since: SINCE, info: [] }), []);
});

it('доли пакета в сумме по строкам id дают итог журнала — тихо', () => {
  const root = fixture(
    [call(D1, 'conv-batch', { input_tokens: 0, output_tokens: 10, cache_read_tokens: 20, cache_write_tokens: 0 })],
    [row(D2, '`conv-batch`', '15 tokens (10 cache-read), 5 out'), row(D2, '`conv-batch`', '15 tokens (10 cache-read), 5 out')]
  );
  assert.deepEqual(run({ root, since: SINCE, info: [] }), []);
});

it('extraRows — строка, которой на доске ещё нет, сверяется наравне с прочитанными', () => {
  const root = fixture([call(D1, 'conv-extra')], []);
  const info = [];
  const p = run({
    root, since: SINCE, info,
    extraRows: [
      { file: FIX + '-t.md', line: '- ' + row(D2, '`conv-extra`') },           // связывает вызов журнала
      { file: FIX + '-t.md', line: '- ' + row(D2, '`conv-extra-missing`') },   // вне журнала — сведение
    ],
  });
  assert.deepEqual(p, []);
  assert.equal(info.length, 1);
  assert.match(info[0], /conv-extra-missing/);
});

console.log(`\n${passed} проверок обратной сверки пройдено`);
