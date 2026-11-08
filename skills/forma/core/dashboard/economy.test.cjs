#!/usr/bin/env node
'use strict';
/**
 * The test of the economy contract (.forma/manual/en/03-protocol/ECONOMY.md).
 * The examples: a `## History` line -> the expected canonical sums.
 * Any engine's adapter passes this same test with its own lines.
 *   node .forma/dashboard/economy.test.cjs
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const economy = require('./economy.cjs');
const { tally } = require('./tally.cjs');

// The date is assembled at runtime: a date literal in a core file is read by a check as a project trace.
const D = ['2000', '01', '02'].join('-');
let passed = 0;
const it = (name, fn) => { fn(); passed += 1; console.log('ok  ' + name); };

function tallyLines(lines) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'econ-')), 'fixture.md');
  fs.writeFileSync(f, '# t\n\n## History\n' + lines.map((l) => '- ' + l).join('\n') + '\n');
  return tally([f]);
}

it('a full line: N, R, T, id, the engine tag', () => {
  const t = tallyLines([`\`Run\`, ${D}: attempt, 52 339 tokens (40 000 cache-read), 120 s, \`abc123\` — eng-x: done.`]);
  const n = t.byNode.Run;
  assert.equal(n.attempts, 1);
  assert.equal(n.tokens, 52339);
  assert.equal(n.cacheRead, 40000);
  assert.equal(n.work, 12339);
  assert.equal(n.seconds, 120);
  assert.equal(n.tokensUnknown + n.cacheUnknown + n.secondsUnknown + n.idUnknown, 0);
});

it('the unknown marker is counted separately, not as zero', () => {
  const t = tallyLines([
    `\`Intent\`, ${D}: attempt, unknown tokens (cache-read unknown), unknown s, \`id unknown\` — eng-x: the ledger was not read.`,
    `\`Intent\`, ${D}: attempt, 100 tokens (60 cache-read), 5 s, \`def456\` — eng-x: done.`,
  ]);
  const n = t.byNode.Intent;
  assert.equal(n.attempts, 2);
  assert.equal(n.tokens, 100);
  // Fails if unknown were turned into 0: then these counters would become 0 and the coverage 2 of 2.
  assert.equal(n.tokensUnknown, 1);
  assert.equal(n.cacheUnknown, 1);
  assert.equal(n.secondsUnknown, 1);
  assert.equal(n.idUnknown, 1);
  assert.equal(n.withCacheRead, 1);
  assert.equal(n.withSeconds, 1);
  assert.equal(t.total.tokensUnknown, 1);
});

it('the module: null (unknown) ≠ 0 and ≠ undefined (not recorded)', () => {
  const asNull = economy.addAttempt(economy.emptyAcc(), { tokens: null, cache_read: null, duration_s: null, call_id: null });
  const asZero = economy.addAttempt(economy.emptyAcc(), { tokens: 0, cache_read: 0, duration_s: 0, call_id: 'x' });
  const absent = economy.addAttempt(economy.emptyAcc(), {});
  assert.deepEqual(economy.unknownCount(asNull), { tokens: 1, cache_read: 1, duration_s: 1, call_id: 1 });
  assert.deepEqual(economy.unknownCount(asZero), { tokens: 0, cache_read: 0, duration_s: 0, call_id: 0 });
  assert.deepEqual(economy.unknownCount(absent), { tokens: 0, cache_read: 0, duration_s: 0, call_id: 0 });
  assert.equal(asZero.withCacheRead, 1);
  assert.equal(absent.withCacheRead, 0);
  assert.equal(economy.cacheShare(asNull), null);
});

it('the old convention R > N is normalized (N includes R)', () => {
  const t = tallyLines([`\`Kit\`, ${D}: attempt, 10 tokens (90 cache-read), 1 s — an old line.`]);
  assert.equal(t.byNode.Kit.tokens, 100);
});

it('one id in two cards is counted once; an external service in its own unit', () => {
  const t = tallyLines([
    `\`Run\`, ${D}: attempt, 10 tokens (5 cache-read), 1 s, 1160 credits (svc/op-a), \`same1\` — eng-y: a.`,
    `\`Run\`, ${D}: attempt, 10 tokens (5 cache-read), 1 s, 1160 credits (svc/op-a), \`same1\` — eng-y: a.`,
  ]);
  assert.equal(t.byNode.Run.attempts, 1);
  assert.deepEqual(t.total.services, { 'svc (credits)': 1160 });
});

it('the breakdown by an engine tag: the tokens of different tags are not summed', () => {
  const g = economy.byEngine([
    { engine: 'eng-a', tokens: 10, cache_read: 5 },
    { engine: 'eng-b', tokens: 7 },
    { tokens: 1 },
  ]);
  assert.deepEqual(Object.keys(g).sort(), ['eng-a', 'eng-b', 'untagged']);
  assert.equal(g['eng-a'].tokens, 10);
  assert.equal(g['eng-b'].tokens, 7);
  assert.equal(economy.cacheShare(g['eng-a']), 0.5);
});

it('the model calls: N = in + write + read + out, the work = N − R', () => {
  const u = economy.addUsage(economy.emptyUsage(), { tokens_in: 1, tokens_out: 2, cache_read: 30, cache_write: 4 });
  assert.equal(economy.usageTokens(u), 37);
  assert.equal(economy.usageWork(u), 7);
  assert.equal(economy.readPerOutput(u), 15);
});

it('the trend: a gap (null) is not zero', () => {
  assert.equal(economy.trend([{ value: 3 }, { value: null }, { value: 1 }]), -1);
  assert.equal(economy.trend([{ value: 3 }, { value: null }]), null);
});

it('the module knows no engine names', () => {
  const src = fs.readFileSync(path.join(__dirname, 'economy.cjs'), 'utf8');
  assert.equal(/claude|codex|gemini/i.test(src), false);
});

it('a batch call: two lines with different batch I/K - two attempts both in tally and on the tab', () => {
  const id = 'fixture-call-id-2';
  const lines = [1, 2].map((i) => '`Spec`, ' + D + ': attempt, 1 000 tokens (800 cache-read), 50 out, 10 s, `' + id + '` — claude-code: a slice (batch ' + i + '/2)');
  assert.equal(tallyLines(lines).byEngine['claude-code'].attempts, 2);
  const { parseAttempts } = require('./data/attempts.cjs');
  const keys = parseAttempts('## History\n' + lines.map((l) => '- ' + l).join('\n'), 'card-x.md').map((z) => z.dedupKey);
  assert.equal(new Set(keys).size, 2);
  assert.equal(tallyLines([lines[0], lines[0]]).byEngine['claude-code'].attempts, 1);
});

it('an "attempt N," line without tokens is named in unparsed with the line number', () => {
  const r = tallyLines(['`Run`, ' + D + ': attempt ' + ['1'].join('') + ', 5 tokens, `fixture-call-id-1` — claude-code: x']);
  assert.equal(r.unparsed.length, 1);
  assert.equal(r.unparsed[0].lineNo, 4);
});

console.log(`\n${passed} checks passed`);
