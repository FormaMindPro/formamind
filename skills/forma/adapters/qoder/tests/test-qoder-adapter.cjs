#!/usr/bin/env node
'use strict';

/**
 * test-qoder-adapter.cjs - the Qoder adapter's fit test.
 * It checks:
 *  1. The presence and the content of .qoder/engine/qoder-8.md (nine contracts, the qoder: tag, the
 *     degraded mode); the forbidden native surfaces are absent;
 *  2. The adapter's shape: the core finds it by the file name, the engines.cjs contract items - all passed;
 *  3. The honest mode: no registered Forma roles - degraded, not full;
 *  4. The spend parse: a synthetic step reads its field, a Qoder transcript step carries no usage and
 *     parses to null (the line says unknown, never zero); the qoder: tag passes the core's tag wall;
 *  5. The zone's self-test: source and copy agree, the hooks are wired;
 *  6. The clean zone: the adapter and its §8 carry no project traces.
 *
 * Run:
 *   node .qoder/tests/test-qoder-adapter.cjs
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const engines = require(path.join(root, '.forma', 'dashboard', 'lib', 'engines.cjs'));
const { engineTagRe } = require(path.join(root, '.forma', 'dashboard', 'spend-line.cjs'));

let passed = 0;
const it = (name, fn) => { fn(); passed += 1; console.log('ok  ' + name); };

const adapter = () => engines.loadAdapters(root).find((a) => a.dir === '.qoder');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

it('.qoder/engine/qoder-8.md declares the nine contracts, the qoder: tag and the degraded mode', () => {
  const text = read('.qoder/engine/qoder-8.md');
  for (let n = 1; n <= 9; n++) assert.ok(text.includes('Contract ' + n), 'section 8 lacks Contract ' + n);
  assert.ok(text.includes('qoder:'), 'section 8 lacks the qoder: engine tag');
  assert.ok(/\u0434\u0435\u0433\u0440\u0430\u0434\u0438\u0440\u043e\u0432\u0430\u043d/i.test(text), 'section 8 does not name the degraded mode');
  assert.ok(/constructive/.test(text) && /discipline/.test(text), 'section 8 does not separate constructive and discipline');
});

it('the forbidden native surfaces are absent: settings.json and commands/ are the native files', () => {
  for (const rel of ['.qoder/rules', '.qoder/agents', '.qoder/home.md']) {
    assert.ok(!fs.existsSync(path.join(root, rel)), 'forbidden native surface present: ' + rel);
  }
});

it('the adapter passes all the engines.cjs contract items', () => {
  const a = adapter();
  assert.ok(a, 'the .qoder adapter was not found by the core');
  const bad = engines.checkAdapter(a, root).filter((x) => !x.ok);
  assert.deepEqual(bad, [], 'failed items: ' + bad.map((x) => x.item + ' (' + x.detail + ')').join('; '));
});

it('the engine is qoder, its tag is qoder, and the mode is degraded until Forma roles are registered', () => {
  const a = adapter();
  assert.equal(engines.idOf(a), 'qoder');
  assert.equal(a.spendTag, 'qoder');
  assert.equal(engines.modeOf(a), engines.modeOf({ capabilities: { subagents: false } }));
  assert.notEqual(engines.modeOf(a), engines.modeOf({ capabilities: { subagents: true } }));
});

it('parseUsage reads an explicit field and returns null on a Qoder transcript step without usage', () => {
  const a = adapter();
  const flat = a.parseUsage({ tokens_out: 7 });
  assert.equal(flat.tokens_out, 7, 'a synthetic step with output tokens was not read');
  const real = a.parseUsage({
    type: 'assistant',
    model: 'dfmodel',
    requestTokenAnchor: { requestHash: 'abc', responseHash: 'def', requestId: 'req_1' },
    message: { role: 'assistant', content: [] },
  });
  assert.equal(real.tokens_out, null, 'a Qoder step without usage must not invent output tokens');
  assert.equal(real.tokens_in, null, 'a Qoder step without usage must not invent input tokens');
});

it('the qoder: tag passes the core tag wall, a foreign tag does not', () => {
  const re = engineTagRe(root);
  assert.ok(re.test(' — `Run`, YYYY-MM-DD: attempt, 100 tokens (cache-read unknown), 5 s, `id unknown` — qoder: assembly'));
  assert.ok(!re.test(' — `Run`, YYYY-MM-DD: attempt, 100 tokens, 5 s, `id unknown` — bogus-tag: a foreign label'));
});

it('the zone self-test is green when the project ships one', () => {
  const file = path.join(root, '.qoder', 'engine', 'checks', 'selftest.cjs');
  if (!fs.existsSync(file)) return; // a clean install ships the adapter without the project's selftest
  const r = spawnSync(process.execPath, [file], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, 'selftest failed:\n' + (r.stderr || r.stdout));
});

it('the clean zone carries no project traces in the adapter, its section 8 and its tests', () => {
  const patterns = [/\bcard-\d{3}\b/, /\b\d{4}-\d{2}-\d{2}\b/, /github\.com/i];
  const files = [
    '.qoder/forma-adapter.cjs',
    '.qoder/engine/qoder-8.md',
    '.qoder/engine/scripts/gen-roles.cjs',
    '.qoder/tests/test-qoder-adapter.cjs',
  ];
  const traces = [];
  for (const rel of files) {
    const abs = path.join(root, rel);
    assert.ok(fs.existsSync(abs), 'clean-zone file missing: ' + rel);
    const text = fs.readFileSync(abs, 'utf8');
    for (const p of patterns) if (p.test(text)) traces.push(rel + ': ' + p);
  }
  assert.deepEqual(traces, [], 'project traces in the clean zone: ' + traces.join(', '));
});

console.log(`\npassed: ${passed}`);
