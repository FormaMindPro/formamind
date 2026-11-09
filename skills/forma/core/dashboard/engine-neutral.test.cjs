#!/usr/bin/env node
'use strict';
/**
 * The dashboard reads the engines as equals: the spend label from the adapters, the column from the engine's
 * folder, the speed without `out unknown` lines in the denominator, the filter by the card's kind.
 *   node .forma/dashboard/engine-neutral.test.cjs
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { engineTagRe } = require('./spend-line.cjs');
const { parseAttempts } = require('./data/attempts.cjs');
const { buildSpeed, buildSummary } = require('./data/speed.cjs');
const { buildSpend } = require('./data/spend.cjs');
const engines = require('./lib/engines.cjs');
const { readNodeConfig } = require('./data/nodes.cjs');

let passed = 0;
const it = (name, fn) => { fn(); passed += 1; console.log('ok  ' + name); };

function fakeRoot(adapters) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-neutral-'));
  for (const [dir, body] of Object.entries(adapters)) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
    fs.writeFileSync(path.join(root, dir, 'forma-adapter.cjs'), body);
  }
  fs.mkdirSync(path.join(root, '.devtool', 'features'), { recursive: true });
  return root;
}
const adapter = (engine, spendTag, id) => `module.exports = { engine: '${engine}', spendTag: '${spendTag}'${id ? `, id: '${id}'` : ''} };`;

it('a tag from the adapters\' spendTag/engine/id passes, an unknown one does not', () => {
  const root = fakeRoot({ '.a': adapter('eng-a', 'eng-a-tag', 'a'), '.m': adapter('mini-code', 'mini-code', 'mini') });
  const re = engineTagRe(root);
  for (const tag of ['eng-a-tag', 'eng-a', 'a', 'mini-code', 'mini']) assert.ok(re.test(`x — ${tag}: \u0441\u0434\u0435\u043b\u0430\u043d\u043e`), tag);
  assert.ok(!re.test('x — unknown-engine: \u0441\u0434\u0435\u043b\u0430\u043d\u043e'));
  assert.ok(!re.test('x — codex: \u0441\u0434\u0435\u043b\u0430\u043d\u043e'), 'the engine name without an adapter is not privileged');
});

it('the adapter removed - its tag becomes unknown', () => {
  const root = fakeRoot({ '.a': adapter('eng-a', 'eng-a'), '.m': adapter('mini', 'mini') });
  assert.ok(engineTagRe(root).test('x — mini: y'));
  fs.rmSync(path.join(root, '.m'), { recursive: true });
  assert.ok(!engineTagRe(root).test('x — mini: y'));
});

const DATE = [String(1999 + 1), "01", "01"].join("-");
const line = (extra, tag) => `- \`Run\`, ${DATE}: attempt, 1000 tokens (400 cache-read)${extra}, \`abcdef0123456789\` — ${tag}: work.`;
const card = (id, kind, status, lines) => ({
  id, kind, status, attempts: parseAttempts(lines.join('\n')),
});

it('output tokens: a number reads, out unknown and an old line - null', () => {
  const a = parseAttempts([line(', 600 out, 10 s', 'eng-a'), line(', out unknown, 10 s', 'eng-a'), line(', 10 s', 'eng-a')].join('\n'));
  assert.deepEqual(a.map((z) => z.tokensOut), [600, null, null]);
});

it('speed: out unknown stays out of the denominator and is marked; the kind filter changes the numbers', () => {
  const cards = [
    card('c1', 'build', 'done', [line(', 600 out, 10 s', 'eng-a'), line(', out unknown, 30 s', 'eng-a')]),
    card('c2', 'docs', 'done', [line(', 100 out, 10 s', 'eng-a')]),
  ];
  const s = buildSpeed(cards);
  const all = s.byKind.all.engines['eng-a'];
  assert.equal(all.outPerSec, 700 / 20);
  assert.equal(all.outUnknown, 1);
  assert.equal(all.secPerAttempt, 50 / 3);
  assert.equal(all.attemptsPerClosed, 1.5);
  assert.equal(all.closedCards, 2);
  assert.equal(all.cacheShare, 0.4);
  assert.equal(s.byKind.build.engines['eng-a'].outPerSec, 60);
  assert.equal(s.byKind.docs.engines['eng-a'].outPerSec, 10);
  assert.deepEqual(s.kinds, ['build', 'docs']);
});

it('the column and the speed snapshot appear from an engine folder with an adapter, without spend lines', () => {
  const root = fakeRoot({ '.a': adapter('eng-a', 'eng-a') });
  const before = buildSpend(root, []).economy;
  assert.ok(before.engines['eng-a']);
  assert.deepEqual(before.byEngine.keys, ['eng-a']);
  assert.ok(before.speed.byKind.all.engines['eng-a']);
  fs.rmSync(path.join(root, '.a'), { recursive: true });
  const after = buildSpend(root, []).economy;
  assert.deepEqual(Object.keys(after.engines), []);
  assert.equal(engines.engineTags(root).length, 0);
});

const NM = (m, e) => `{ Intent: { model: '${m}', effort: '${e}' }, Spec: { model: '${m}', effort: '${e}' }, Kit: { model: '${m}', effort: '${e}' }, Run: { model: '${m}', effort: '${e}' }, Core: { model: '${m}', effort: '${e}' } }`;

it('two adapters with tables give two row groups, an adapter without a table - an empty group', () => {
  const root = fakeRoot({
    '.a': `module.exports = { engine: 'eng-a', spendTag: 'eng-a', nodeModels: ${NM('model-a', 'high')} };`,
    '.m': `module.exports = { engine: 'mini-code', spendTag: 'mini', id: 'mini', nodeModels: ${NM('model-m', 'medium')} };`,
    '.z': adapter('eng-z', 'eng-z'),
  });
  const rows = readNodeConfig(root);
  const of = (e) => rows.filter((r) => r.engine === e);
  assert.equal(of('eng-a').length, 5);
  assert.equal(of('mini').length, 5);
  assert.ok(of('mini').every((r) => r.model === 'model-m' && r.effort === 'medium'));
  assert.ok(of('eng-a').every((r) => r.model === 'model-a'));
  assert.equal(of('eng-z').length, 1);
  assert.equal(of('eng-z')[0].empty, true);
  assert.deepEqual(readNodeConfig(fakeRoot({})), []);
});

it('one engine\'s tag aliases reduce into one byEngine and speed key', () => {
  const root = fakeRoot({ '.m': adapter('mini-code', 'mini', 'mini') });
  const dir = path.join(root, '.devtool', 'features');
  let n = 0;
  const l = (tag) => line(', 5 out, 10 s', tag).replace('abcdef0123456789', 'abcdef01234567' + (10 + n++));
  fs.writeFileSync(path.join(dir, 'case-x.md'), `---\nid: "case-x"\nstatus: "done"\n---\n## History\n${l('mini')}\n${l('mini')}\n${l('mini-code')}\n`);
  const cards = [card('c1', 'build', 'done', [l('mini'), l('mini'), l('mini-code')])];
  const e = buildSpend(root, cards).economy;
  assert.deepEqual(e.byEngine.keys, ['mini']);
  assert.equal(e.byEngine.columns.mini.attempts, 3);
  assert.deepEqual(Object.keys(e.speed.byKind.all.engines), ['mini']);
  assert.equal(e.speed.byKind.all.engines.mini.attempts, 3);
  assert.deepEqual(Object.keys(e.engines), ['mini']);
});

it('tokens/s per engine+model pair: two tags, two models, an unknown model - a separate row, out unknown does not deflate', () => {
  const root = fakeRoot({
    '.a': `module.exports = { engine: 'eng-a', spendTag: 'eng-a', nodeModels: ${NM('model-a', 'high')} };`,
    '.m': `module.exports = { engine: 'mini-code', spendTag: 'mini', id: 'mini', nodeModels: { ...${NM('model-m', 'low')}, Run: { model: 'model-m2', effort: 'low' } } };`,
  });
  const l = (node, extra, tag, n) => line(extra, tag).replace('`Run`', '`' + node + '`').replace('abcdef0123456789', 'abcdef01234567' + (10 + n));
  const cards = [card('c1', 'build', 'done', [
    l('Intent', ', 600 out, 10 s', 'eng-a', 0), l('Run', ', 300 out, 30 s', 'eng-a', 1), l('Run', ', out unknown, 99 s', 'eng-a', 2),
    l('Run', ', 90 out, 3 s', 'mini-code', 3), l('Intent', ', 50 out, 10 s', 'mini', 4), l('Helper', ', 7 out, 1 s', 'mini', 5),
  ])];
  const rows = buildSpend(root, cards).economy.speed.byKind.all.models;
  const get = (eng, mdl) => rows.find((r) => r.engine === eng && r.model === mdl);
  assert.equal(get('eng-a', 'model-a').out, 900);
  assert.equal(get('eng-a', 'model-a').outSeconds, 40);
  assert.equal(get('eng-a', 'model-a').outPerSec, 22.5);
  assert.equal(get('eng-a', 'model-a').attempts, 3);
  assert.equal(get('eng-a', 'model-a').outUnknown, 1);
  assert.equal(get('mini', 'model-m2').outPerSec, 30);
  assert.equal(get('mini', 'model-m').outPerSec, 5);
  assert.equal(get('mini', 'unknown').outPerSec, 7);
  assert.equal(rows.length, 4);
});

it('summary: seconds and tokens per closed card with a rank, the latency median, tokens/s of active work, small samples', () => {
  // eng-a: 5 closed cards of 1 attempt each (10 s, 1000 tokens), 5 journal entries; eng-b: 1 card with 3 attempts, a journal without the field
  const a = Array.from({ length: 5 }, (_, i) => card('a' + i, 'build', 'done', [line(', 100 out, 10 s', 'eng-a')]));
  const b = card('b0', 'build', 'done', [line(', out unknown, 40 s', 'eng-b'), line(', out unknown, 40 s', 'eng-b'), line(', out unknown, 40 s', 'eng-b')]);
  const open = card('o0', 'build', 'review', [line(', 5 out, 1 s', 'eng-a')]); // not closed: stays out of the "per closed" one
  const ledgers = {
    'eng-a': [
      { conversationId: 'x1', timestamp: '1', output_tokens: 100, duration_s: 10, first_response_s: 2 },
      { conversationId: 'x2', timestamp: '2', output_tokens: 100, duration_s: 10, first_response_s: 4 },
      { conversationId: 'x3', timestamp: '3', output_tokens: 100, duration_s: 10, first_response_s: 6 },
      { conversationId: 'x4', timestamp: '4', output_tokens: 100, duration_s: 10, first_response_s: null },
      // a continuation: the output - the increment (100 -> 200 = 100), the time - active_s (20), not the accumulated totals
      { conversationId: 'x3', timestamp: '5', output_tokens: 200, duration_s: 900, active_s: 20, continuation: true, first_response_s: 8 },
    ],
    'eng-b': [{ conversationId: 'y1', timestamp: '1', output_tokens: 50, duration_s: 10 }],
  };
  const sm = buildSummary([...a, b, open], ledgers, ['eng-c']);
  const A = sm.engines['eng-a'], B = sm.engines['eng-b'], C = sm.engines['eng-c'];
  assert.deepEqual([A.secPerClosed.v, A.secPerClosed.n, A.secPerClosed.m, A.secPerClosed.low], [10, 5, 5, false]);
  assert.equal(A.tokensPerClosed.v, 1000);
  assert.equal(B.secPerClosed.v, 120); assert.equal(B.tokensPerClosed.v, 3000);
  assert.equal(A.secPerClosed.rank, 1); assert.equal(B.secPerClosed.rank, 2);
  assert.equal(A.tokensPerClosed.rank, 1); assert.equal(B.tokensPerClosed.rank, 2);
  assert.equal(B.secPerClosed.low, true); assert.deepEqual([B.secPerClosed.n, B.secPerClosed.m], [1, 1]);
  assert.equal(A.firstResponse.v, 5); // the median of 2, 4, 6, 8
  assert.deepEqual([A.firstResponse.n, A.firstResponse.m, A.firstResponse.low], [4, 5, true]);
  assert.equal(B.firstResponse.v, null); // no field - null, not zero
  assert.equal(A.outPerActiveSec.v, 500 / 60); // (100*4 + 100 of increment) / (10*4 + 20) s
  assert.equal(A.retryShare.v, 0); assert.ok(Math.abs(B.retryShare.v - 2 / 3) < 1e-9);
  assert.equal(C.secPerClosed.v, null); assert.equal(C.secPerClosed.rank, undefined); assert.equal(C.outPerActiveSec.v, null);
  // the output is known for fewer than half the attempts - tokens/s is marked a small sample at any volume
  const lowOut = buildSummary([card('d0', 'build', 'done', [line(', 5 out, 10 s', 'eng-d'), ...Array.from({ length: 4 }, () => line(', out unknown, 10 s', 'eng-d'))])],
    { 'eng-d': Array.from({ length: 6 }, (_, i) => ({ conversationId: 'z' + i, timestamp: String(i), output_tokens: 10, duration_s: 10 })) });
  assert.equal(lowOut.engines['eng-d'].outPerActiveSec.low, true);
  assert.equal(lowOut.engines['eng-d'].outPerActiveSec.v, 1);
});

it('summary: the total spend and the per-closed-card one, tokens/s of a call, only the recorded price, the "Total"', () => {
  const priced = (extra, tag) => line(extra + ', $0.5000 (ext-provider)', tag);
  const cards = [
    card('s1', 'build', 'done', [line(', 100 out, 10 s', 'eng-a'), line(', 300 out, 30 s', 'eng-a'), line(', out unknown, 60 s', 'eng-a')]),
    card('s2', 'build', 'review', [line(', 50 out, 5 s', 'eng-a')]),
    card('s3', 'build', 'done', [line(', 10 out, 2 s', 'eng-b')]),
    card('s4', 'build', 'done', [line(', 20 out, 4 s', 'eng-a'), line(', 40 out, 8 s', 'eng-b')]),
  ];
  const sm = buildSummary(cards, {}, ['eng-z']);
  const A = sm.engines['eng-a'], B = sm.engines['eng-b'], Z = sm.engines['eng-z'], T = sm.total;
  assert.deepEqual([A.tokensTotal.v, A.tokensTotal.n, A.tokensTotal.m], [5000, 5, 5]);
  assert.deepEqual([A.secTotal.v, A.secTotal.n], [10 + 30 + 60 + 5 + 4, 5]);
  assert.equal(A.outPerCallSec.v, (100 + 300 + 50 + 20) / (10 + 30 + 5 + 4)); // an out unknown line stays out of the denominator
  assert.equal(A.outPerCallSec.n, 4); assert.equal(A.outPerCallSec.m, 5);
  assert.equal(A.outPerCallSec.low, true); // 4 observations < 5
  assert.equal(A.usdTotal.v, null); assert.equal(A.usdPerClosed.v, null); // no price recorded - null, not zero
  assert.equal(A.secPerClosed.v, (100 + 4) / 2); // the closed s1 (100 s) and s4 (4 s)
  assert.equal(B.tokensPerClosed.v, 1000 * 2 / 2);
  assert.equal(Z.tokensTotal.v, null); assert.equal(Z.secTotal.v, null); assert.equal(Z.outPerCallSec.v, null);
  assert.equal(T.closedCards, 3); // s4 with two engines - one card
  assert.equal(T.tokensTotal.v, 7000);
  assert.equal(T.secTotal.v, 10 + 30 + 60 + 5 + 4 + 2 + 8);
  assert.equal(T.outPerCallSec.v, (100 + 300 + 50 + 20 + 10 + 40) / (10 + 30 + 5 + 4 + 2 + 8));
  assert.equal(T.usdTotal.v, null);
  // the price: the sum only over the attempts with a recorded price, n - such attempts
  const p = buildSummary([card('p1', 'build', 'done', [priced(', 10 out, 5 s', 'eng-p'), line(', 10 out, 5 s', 'eng-p')])]);
  assert.deepEqual([p.engines['eng-p'].usdTotal.v, p.engines['eng-p'].usdTotal.n, p.engines['eng-p'].usdTotal.m], [0.5, 1, 2]);
  assert.equal(p.engines['eng-p'].usdPerClosed.v, 0.5);
  assert.equal(p.total.usdTotal.v, 0.5);
});

it('summary from the adapter\'s directory: the journal reads by the adapters\' list, no file - "no data", not zero', () => {
  const root = fakeRoot({ '.a': adapter('eng-a', 'eng-a'), '.m': adapter('mini-code', 'mini', 'mini') });
  fs.mkdirSync(path.join(root, '.a', '.ledger'));
  fs.writeFileSync(path.join(root, '.a', '.ledger', 'calls.jsonl'),
    JSON.stringify({ conversationId: 'q1', timestamp: '1', output_tokens: 30, duration_s: 10, first_response_s: 3 }) + '\n{\u0431\u0438\u0442\u0430\u044f \u0441\u0442\u0440\u043e\u043a\u0430\n');
  const sm = buildSpend(root, []).economy.speed.summary;
  assert.deepEqual(sm.tags, ['eng-a', 'mini']);
  assert.equal(sm.engines['eng-a'].firstResponse.v, 3);
  assert.equal(sm.engines['eng-a'].outPerActiveSec.v, 3);
  assert.equal(sm.engines.mini.firstResponse.v, null);
  assert.equal(sm.engines.mini.outPerActiveSec.v, null);
});

console.log(`\n${passed} passed`);
