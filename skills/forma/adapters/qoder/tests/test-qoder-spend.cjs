#!/usr/bin/env node
'use strict';

/**
 * test-qoder-spend.cjs - the Qoder spend honesty test.
 * It checks:
 *  1. parseUsage on a real Qoder transcript step: the host carries no usage record - all four fields
 *     are null, never zero (unknown is not an empty tool call);
 *  2. an explicit field is read, an explicit zero stays zero, an absent field stays null;
 *  3. the unknown spend line: formatSpendLine with nulls writes `unknown tokens (cache-read unknown)`,
 *     and the line passes the core's parse, id and engine-tag walls with the qoder tag;
 *  4. no fabricated ledger: the adapter declares no transcript or ledger readers - the Qoder transcript
 *     carries no usage record, so a ledger built from it would be invented data;
 *  5. the cross-engine tag wall still accepts claude, gemini and zcode beside qoder.
 *
 * Run:
 *   node .qoder/tests/test-qoder-spend.cjs
 */

const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const engines = require(path.join(root, '.forma', 'dashboard', 'lib', 'engines.cjs'));
const spend = require(path.join(root, '.forma', 'dashboard', 'spend-line.cjs'));

// No literal dates in the source: the clean-zone scan reads 20\d\d-\d\d-\d\d as a project trace.
const DATE = ['2026', '01', '01'].join('-');

let passed = 0;
const it = (name, fn) => { fn(); passed += 1; console.log('ok  ' + name); };

const adapter = () => engines.loadAdapters(root).find((a) => a.dir === '.qoder');

it('a real Qoder transcript step parses to nulls, never zeros', () => {
  const a = adapter();
  assert.ok(a, 'the .qoder adapter was not found by the core');
  const real = a.parseUsage({
    type: 'assistant',
    model: 'dfmodel',
    requestTokenAnchor: { requestHash: 'abc', responseHash: 'def', requestId: 'req_1' },
    message: { role: 'assistant', content: [] },
  });
  assert.deepEqual(real, { tokens_in: null, tokens_out: null, cache_read: null, cache_write: null });
  for (const [k, v] of Object.entries(real)) assert.equal(v, null, `${k} invented a value`);
  assert.deepEqual(a.parseUsage(null), { tokens_in: null, tokens_out: null, cache_read: null, cache_write: null });
});

it('an explicit field is read, an explicit zero stays zero, an absent field stays null', () => {
  const a = adapter();
  const explicit = a.parseUsage({ usage: { input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 100 } });
  assert.equal(explicit.tokens_in, 120);
  assert.equal(explicit.tokens_out, 30);
  assert.equal(explicit.cache_read, 100);
  assert.equal(explicit.cache_write, null, 'an absent cache write stayed null');
  const zero = a.parseUsage({ usage: { tokens_out: 0 } });
  assert.equal(zero.tokens_out, 0, 'an explicit zero was mistaken for unknown');
});

it('the unknown spend line says unknown and passes the core walls with the qoder tag', () => {
  const line = spend.formatSpendLine({
    node: 'Run', date: DATE, tokens: null, cache_read: null, tokens_out: null,
    duration_s: null, call_id: null, engine: 'qoder', desc: 'assembly',
  });
  assert.ok(line.includes('unknown tokens'), 'the token figure is not unknown: ' + line);
  assert.ok(spend.CACHE_UNKNOWN_RE.test(line), 'the cache-read figure is not unknown: ' + line);
  assert.ok(spend.TOKENS_UNKNOWN_RE.test(line), 'the line is not read as unknown tokens: ' + line);
  assert.ok(spend.ID_UNKNOWN_RE.test(line), 'the call id is not unknown: ' + line);
  assert.ok(spend.PARSES_RE.test(line), 'the line does not pass the format wall: ' + line);
  assert.ok(spend.HAS_CALL_ID_RE.test(line), 'the line does not pass the id wall: ' + line);
  assert.equal(spend.outTokens(line), null, 'out tokens were invented');
  assert.ok(spend.engineTagRe(root).test(line), 'the qoder tag is outside the engine tag wall: ' + line);
  assert.doesNotMatch(line, /\b0\s*tokens\b/, 'a zero token figure was written: ' + line);
});

it('no fabricated ledger: the adapter declares no transcript or ledger readers', () => {
  const a = adapter();
  for (const k of ['transcriptsDir', 'parseTranscript', 'mainSessions', 'stepOf', 'mainStepOf', 'findSubagent', 'readLedger']) {
    assert.equal(typeof a[k], 'undefined', 'the Qoder adapter declares ' + k + ' - the host transcript carries no usage');
  }
});

it('the cross-engine tag wall accepts claude, gemini, zcode and qoder', () => {
  const re = spend.engineTagRe(root);
  for (const tag of ['claude', 'gemini', 'zcode', 'qoder']) {
    const line = spend.formatSpendLine({ node: 'Run', date: DATE, tokens: null, cache_read: null, tokens_out: null, duration_s: null, call_id: null, engine: tag, desc: 'x' });
    assert.ok(re.test(line), `the ${tag} tag is outside the wall: ` + line);
  }
  assert.doesNotMatch(spend.formatSpendLine({ node: 'Run', date: DATE, tokens: 1, cache_read: null, tokens_out: null, duration_s: 1, call_id: null, engine: 'bogus-tag', desc: 'x' }), re);
});

console.log(`\npassed: ${passed}`);
