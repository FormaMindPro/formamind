#!/usr/bin/env node
'use strict';

/**
 * test-zcode-adapter.cjs - the ZCode adapter's fit test.
 * It checks:
 *  1. The presence and the content of .zcode/rules/zcode-8.md (nine contracts, the zcode: tag, the degradation divergence);
 *  2. The adapter's shape: the core finds it by the file name, the engines.cjs contract items - all passed;
 *  3. The zone's roles parity with the canonical roles - by a regeneration (gen-roles --check);
 *  4. The spend line parse: a synthetic step and the host's real usage shape; the zcode: tag - in the core's tag wall;
 *  5. The core's tabs read the adapter: formaRoles and engineSettings give the zone's data;
 *  6. The zone's cleanliness (prohibition 16): the zone's texts carry no project traces (.state - a probe with timestamps,
 *     tests - instruments with samples: outside the scan, named here, not hidden);
 *  7. The zone's agents' frontmatter keys - a closed list (scripts/lint-agent-keys.cjs):
 *     a typoed or unknown key - an error with the file's address and the key's name, not silence.
 *
 * The ru literals below are pins on ru output (the mirrors', the linter's) or the host's filenames (data) -
 * held as-is, the escape pass turns them into \u sequences.
 *
 * Run:
 *   node .zcode/tests/test-zcode-adapter.cjs
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const engines = require('../../.forma/dashboard/lib/engines.cjs');
const { engineTagRe } = require('../../.forma/dashboard/spend-line.cjs');

let passed = 0;
const it = (name, fn) => { fn(); passed += 1; console.log('ok  ' + name); };

const adapter = () => engines.loadAdapters(root).find((a) => a.dir === '.zcode');

// 1. The engine's section 8
it('.zcode/rules/zcode-8.md declares the nine contracts and the engine tag', () => {
  const text = fs.readFileSync(path.join(root, '.zcode', 'rules', 'zcode-8.md'), 'utf8');
  for (const c of ['Contract 1', 'Contract 2', 'Contract 3', 'Contract 4', 'Contract 5', 'Contract 6', 'Contract 7', 'Contract 8', 'Contract 9']) {
    assert.ok(text.includes(c), `section 8 lacks ${c}`);
  }
  assert.ok(text.includes('zcode:'), 'section 8 lacks the zcode: engine tag');
  assert.ok(/\u0434\u0435\u0433\u0440\u0430\u0434\u0438\u0440\u043e\u0432\u0430\u043d/i.test(text), 'section 8 does not name the route\u0027s degraded mode'); // the ru word pinned (data)
  assert.ok(text.includes('[STAGE:'), 'section 8 does not name the stage labels');
});

// 2. The adapter's shape: all the core contract items
it('the adapter passes all the engines.cjs contract items', () => {
  const a = adapter();
  assert.ok(a, 'the .zcode adapter was not found by the core');
  const items = engines.checkAdapter(a, root);
  const bad = items.filter((x) => !x.ok);
  assert.deepEqual(bad, [], 'failed items: ' + bad.map((x) => `${x.item} (${x.detail})`).join('; '));
});

it('the engine mode is full (ru data value), the id and the tag - zcode', () => {
  const a = adapter();
  assert.equal(engines.idOf(a), 'zcode');
  assert.equal(engines.modeOf(a), '\u043f\u043e\u043b\u043d\u044b\u0439'); // the board-core lib's ru value pinned
  assert.equal(a.spendTag, 'zcode');
});

// 3. The roles parity - by a regeneration
it('the roles mirror is in sync with .claude/agents (gen-roles --check)', () => {
  const r = spawnSync(process.execPath, [path.join(root, '.zcode', 'scripts', 'gen-roles.cjs'), '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, 'the mirror has drifted: ' + (r.stderr || r.stdout));
});

// 4. The spend parse
it('parseUsage reads a synthetic step and the host\u0027s real usage shape', () => {
  const a = adapter();
  const flat = a.parseUsage({ tokens_out: 7 });
  assert.equal(flat.tokens_out, 7);
  const host = a.parseUsage({ usage: { inputTokens: 110827, outputTokens: 784, totalTokens: 111611, cacheReadTokens: 106944, cacheWriteTokens: 0 } });
  assert.equal(host.tokens_out, 784);
  assert.equal(host.cache_read, 106944);
  assert.equal(host.cache_write, 0);
  // The host's fields are inclusive: inputTokens carries the whole input, the cache inside it
  // (a rollout fact: inputTokens + outputTokens = totalTokens) - the other input = inputTokens minus the cache,
  // and N = the sum of in+write+read+out adds up in totalTokens, not counting the cache twice.
  assert.equal(host.tokens_in, 110827 - 106944 - 0);
  assert.equal(host.tokens_in + host.cache_write + host.cache_read + host.tokens_out, 111611);
  const provider = a.parseUsage({ usage: { input_tokens: 3806, output_tokens: 2004, cache_read_input_tokens: 110784 } });
  assert.equal(provider.tokens_out, 2004);
  assert.equal(provider.cache_read, 110784);
});

// 5. The main session's log: the layout and the normalized step - through the adapter
it('mainSessions lists the main sessions, without the subagent ones and the record without a session', () => {
  const a = adapter();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rollout-'));
  const dir = path.join(home, 'cli', 'rollout');
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ['model-io-sess_aa11.jsonl', 'model-io-sess_bb22.jsonl',
    'model-io-sess_subagent_agent_cc33.jsonl', 'model-io-no-session.jsonl', '\u0447\u0443\u0436\u043e\u0439-\u0444\u0430\u0439\u043b.txt']) { // the last is a foreign filename fixture (data)
    fs.writeFileSync(path.join(dir, f), '{}\n');
  }
  const outerHome = process.env.ZCODE_HOME;
  process.env.ZCODE_HOME = home;
  try {
    const list = a.mainSessions(root);
    assert.deepEqual(list.map((s) => s.id).sort(), ['model-io-sess_aa11', 'model-io-sess_bb22']);
    for (const s of list) assert.ok(fs.existsSync(s.file), 'the record\u0027s file exists');
  } finally {
    if (outerHome === undefined) delete process.env.ZCODE_HOME; else process.env.ZCODE_HOME = outerHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

it('mainStepOf: the requestId key, the response\u0027s toolCalls, a human replica - a new turnId', () => {
  const a = adapter();
  const usage = { inputTokens: 1000, outputTokens: 100, totalTokens: 1100, cacheReadTokens: 800, cacheWriteTokens: 50 };
  const first = a.mainStepOf({
    completedAt: '2026-01-01T10:00:00.000Z', requestId: 'r1', turnId: 'turn_a', model: { modelId: 'GLM-5.3' },
    response: { toolCalls: [{ id: 'c1', name: 'Edit', input: { file_path: 'x' } }], usage },
  }, null);
  assert.equal(first.key, 'r1');
  assert.equal(first.ts, '2026-01-01T10:00:00.000Z');
  assert.equal(first.model, 'GLM-5.3');
  assert.equal(first.toolCalls.length, 1);
  assert.equal(first.toolCalls[0].name, 'Edit');
  assert.equal(first.usage, usage);
  assert.equal(first.human, true, 'the file\u0027s first record - a turn boundary');
  const sameTurn = a.mainStepOf({ completedAt: '2026-01-01T10:00:05.000Z', requestId: 'r2', turnId: 'turn_a', response: { toolCalls: [], usage: {} } }, { turnId: 'turn_a' });
  assert.equal(sameTurn.human, false, 'an answer to AskUserQuestion does not open a turn');
  assert.equal(sameTurn.usage, null, 'a usage without spend - null');
  assert.equal(sameTurn.key, 'r2');
  const newTurn = a.mainStepOf({ completedAt: '2026-01-01T10:01:00.000Z', requestId: 'r3', turnId: 'turn_b', response: { usage } }, { turnId: 'turn_a' });
  assert.equal(newTurn.human, true, 'a new turnId - a human replica');
  const noTime = a.mainStepOf({ requestId: 'r4' }, null);
  assert.equal(noTime, null, 'a record without time - not a record');
});

it('the zcode: tag passes the core\u0027s tag wall, a foreign tag does not', () => {
  const re = engineTagRe(root);
  assert.ok(re.test(' — `Run`, YYYY-MM-DD: attempt, 121761 tokens (cache-read unknown), 575 s, `id unknown` — zcode: adapter assembly'));
  assert.ok(!re.test(' — `Run`, YYYY-MM-DD: attempt, 100 tokens, 5 s, `id unknown` — bogus-tag: a foreign label'));
});

it('transcriptsDir points at the host\u0027s rollout', () => {
  const base = process.env.ZCODE_HOME || path.join(os.homedir(), '.zcode');
  const dir = adapter().transcriptsDir(root);
  // The directory is written by the host itself; the adapter does not own it: on a machine without the host (CI, an install ahead)
  // it is absent and the adapter answers null - that is not a red; a red is the directory there and the adapter silent.
  if (!dir) {
    assert.ok(!fs.existsSync(path.join(base, 'cli', 'rollout')), 'the rollout directory is there but the adapter did not find it');
    return;
  }
  assert.ok(/rollout/.test(dir), 'the host\u0027s rollout directory was expected');
  assert.ok(fs.existsSync(dir), 'the transcripts directory was not found');
});

// 5b. The core's tabs read the adapter
it('formaRoles and engineSettings give the zone\u0027s data', () => {
  const a = adapter();
  const roles = a.formaRoles(root);
  assert.ok(roles.title === 'ZCode', 'the Forma tab\u0027s title');
  const four = ['intent', 'spec', 'kit', 'core'];
  for (const n of four) assert.ok(roles.nodes.some((x) => (x.file || '').includes(n)), `the Forma tab lacks the role ${n}`);
  assert.ok((roles.runRoles || []).some((x) => (x.file || '').includes('run')), 'the Forma tab lacks the Run directory');
  const settings = a.engineSettings(root);
  assert.equal(settings.present, true);
  assert.ok(settings.nodes.length >= 5, 'fewer than five nodes on the Engine tab');
  assert.ok(settings.skills.includes('grilling'), 'the core canon .forma/skills skills are not read');
});

// 6. The zone\u0027s cleanliness (prohibition 16)
it('the zone\u0027s texts carry no project traces', () => {
  const scanDirs = ['.zcode/agents', '.zcode/rules', '.zcode/scripts'];
  const scanRoots = ['.zcode/forma-adapter.cjs'];
  const traces = [];
  const patterns = [/\bcard-\d{3}\b/, /\b\d{4}-\d{2}-\d{2}\b/, /github\.com/i];
  const scan = (abs, rel) => {
    if (!fs.existsSync(abs)) return;
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      for (const e of fs.readdirSync(abs)) scan(path.join(abs, e), `${rel}/${e}`);
      return;
    }
    if (!/\.(md|cjs)$/.test(rel)) return;
    const text = fs.readFileSync(abs, 'utf8');
    for (const p of patterns) if (p.test(text)) traces.push(`${rel}: ${p}`);
  };
  for (const d of scanDirs) scan(path.join(root, d), d);
  for (const f of scanRoots) scan(path.join(root, f), f);
  assert.deepEqual(traces, [], 'project traces in the clean zone: ' + traces.join(', '));
});

// 7. The zone's agents' frontmatter keys - a closed list, a typo is not silent
it('lint-agent-keys: all the zone\u0027s agents pass by the closed key list', () => {
  const r = spawnSync(process.execPath, [path.join(root, '.zcode', 'scripts', 'lint-agent-keys.cjs')], { encoding: 'utf8' });
  assert.equal(r.status, 0, 'the key lint\u0027s violations:\n' + (r.stderr || r.stdout));
});

it('lint-agent-keys: a typoed key - an error with the address and the key\u0027s name; a clean set - exit 0', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentkeys-'));
  try {
    const probe = path.join(dir, 'agent-probe.md');
    fs.writeFileSync(probe, '---\nname: probe\nefort: high\n---\n\n# probe\n');
    const rBad = spawnSync(process.execPath, [path.join(root, '.zcode', 'scripts', 'lint-agent-keys.cjs'), dir], { encoding: 'utf8' });
    assert.notEqual(rBad.status, 0, 'the typo passed silently');
    assert.ok((rBad.stderr || '').includes('agent-probe.md'), 'an error without the file\u0027s address: ' + rBad.stderr);
    assert.ok((rBad.stderr || '').includes('efort'), 'an error without the key\u0027s name: ' + rBad.stderr);
    fs.writeFileSync(probe, '---\nname: probe\ndescription: probe\nmodel: m\neffort: high\ntier: light\nuses: a\ntools: Read\n---\n\n# probe\n');
    const rOk = spawnSync(process.execPath, [path.join(root, '.zcode', 'scripts', 'lint-agent-keys.cjs'), dir], { encoding: 'utf8' });
    assert.equal(rOk.status, 0, 'the clean set did not pass: ' + (rOk.stderr || rOk.stdout));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

console.log(`\npassed: ${passed}`);
