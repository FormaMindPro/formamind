#!/usr/bin/env node
'use strict';

/**
 * test-new-card.cjs - the channels isolation gate of new-card.cjs and the capability probes.
 *
 * Checked:
 *  1. A missing probe of a zone that promised channels closes the gate; --force opens it and the
 *     card's History carries the force line.
 *  2. A probe saying the isolation is unavailable closes the gate; its message differs from the
 *     missing-probe message - absence and refusal are told apart.
 *  3. A zone that did not promise channels (no subagents/sendMessage) with no probe does not block.
 *  4. writeProbes writes <zone>/.state/capabilities.json for every adapter zone, keeps foreign
 *     keys of an existing probe, and readProbe gives null for a zone without one.
 *
 * The project under test is a temporary root: new-card reads PROJECT.md, the goals and the adapter
 * zones from --root, while its dictionaries stay in the install the script itself lives in.
 * Code and output here are English-only (the shipped core is a clean zone).
 *
 * Run: node .forma/board/test-new-card.cjs
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..', '..');
const NEW_CARD = path.join(root, '.forma', 'board', 'new-card.cjs');
const { writeProbes, readProbe, PROBE_REL } = require('../dashboard/lib/capability-probe.cjs');

let passed = 0;
const it = (name, fn) => { fn(); passed += 1; console.log('ok  ' + name); };

const PROJECT_MD = [
  '| Kind | Epic |',
  '| --- | --- |',
  '| `channels` | 7. Production channels |',
  '| `protocol` | 3. Project protocol |',
  '',
].join('\n');

const ADAPTER_FULL = "module.exports = { id: 'fakefull', engine: 'fakefull', capabilities: { subagents: true, sendMessage: true, hooks: true, mcp: true } };\n";
const ADAPTER_MINI = "module.exports = { id: 'fakemini', engine: 'fakemini', capabilities: { subagents: false, sendMessage: false, hooks: true, mcp: true } };\n";

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'newcard-gate-'));
  fs.mkdirSync(path.join(dir, 'project', 'config'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'project', 'config', 'PROJECT.md'), PROJECT_MD);
  for (const g of ['goal-channels', 'goal-protocol']) fs.mkdirSync(path.join(dir, 'project', 'goals', g), { recursive: true });
  fs.mkdirSync(path.join(dir, '.fakefull'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.fakefull', 'forma-adapter.cjs'), ADAPTER_FULL);
  fs.mkdirSync(path.join(dir, '.fakemini'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.fakemini', 'forma-adapter.cjs'), ADAPTER_MINI);
  return dir;
}

function probeFile(dir, zone) {
  const file = path.join(dir, zone, PROBE_REL);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return file;
}

function createCard(dir, extra = []) {
  const r = spawnSync(process.execPath, [NEW_CARD, '--root', dir, '--kind', 'channels', '--title', 'gate probe', '--dry', ...extra], { encoding: 'utf8' });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || ''), stderr: r.stderr || '', stdout: r.stdout || '' };
}

const withFx = (fn) => { const dir = fixture(); try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); } };

it('a missing probe of a zone that promised channels closes the gate; --force opens it and is recorded', () => withFx((dir) => {
  const closed = createCard(dir);
  assert.equal(closed.status, 2, 'the gate must stop without --force: ' + closed.out);
  assert.ok(closed.stderr.includes('.fakefull'), 'the closed gate names the zone: ' + closed.stderr);

  const forced = createCard(dir, ['--force']);
  assert.equal(forced.status, 0, '--force must open the gate: ' + forced.out);
  assert.match(forced.stdout, /- `Intent`, \d{4}-\d{2}-\d{2}: --force/, 'the force line is in the card History: ' + forced.stdout);
  assert.ok(forced.stdout.includes('.fakefull'), 'the force line names the zone: ' + forced.stdout);
}));

it('a probe saying the isolation is unavailable closes the gate; its message differs from the missing-probe one', () => withFx((dir) => {
  const missing = createCard(dir);
  fs.writeFileSync(probeFile(dir, '.fakefull'), JSON.stringify({ engine: 'fakefull', isolation: { available: false } }, null, 2));
  const refused = createCard(dir);
  assert.equal(refused.status, 2, 'an unavailable isolation must stop: ' + refused.out);
  assert.notEqual(refused.stderr, missing.stderr, 'absence and refusal are told apart by their messages');

  const forced = createCard(dir, ['--force']);
  assert.equal(forced.status, 0, '--force must open a refused gate: ' + forced.out);
  assert.match(forced.stdout, /- `Intent`, \d{4}-\d{2}-\d{2}: --force/, 'the force line is in the card History: ' + forced.stdout);
}));

it('a zone that did not promise channels does not block, and an available probe passes', () => withFx((dir) => {
  assert.equal(createCard(dir).status, 2, 'the promising zone still closes the gate');

  fs.writeFileSync(probeFile(dir, '.fakefull'), JSON.stringify({ engine: 'fakefull', isolation: { available: true } }, null, 2));
  const open = createCard(dir);
  assert.equal(open.status, 0, 'an available isolation passes: ' + open.out);
  assert.doesNotMatch(open.stdout, /--force/, 'no force line without --force');

  fs.rmSync(path.join(dir, '.fakefull'), { recursive: true, force: true });
  const miniOnly = createCard(dir);
  assert.equal(miniOnly.status, 0, 'a zone without the channels promise and without a probe must not block: ' + miniOnly.out);
}));

it('writeProbes writes every adapter zone and keeps foreign keys; readProbe reads it back', () => withFx((dir) => {
  assert.equal(readProbe(dir, '.fakefull'), null, 'no probe yet');

  const existing = probeFile(dir, '.fakefull');
  fs.writeFileSync(existing, JSON.stringify({ engine: 'fakefull', custom: { kept: true }, isolation: { available: true, guarantee: 'kept' } }, null, 2));
  const written = writeProbes(dir);
  assert.deepEqual(written.map((p) => p.zone).sort(), ['.fakefull', '.fakemini'], 'one probe per adapter zone');

  const full = readProbe(dir, '.fakefull');
  assert.equal(full.engine, 'fakefull');
  assert.equal(full.source, 'adapter');
  assert.deepEqual(full.custom, { kept: true }, 'a foreign key of an existing probe survives');
  assert.equal(full.isolation.promised, true);
  assert.equal(full.isolation.available, true);
  assert.equal(full.isolation.guarantee, 'kept', 'an existing isolation detail survives');

  const mini = readProbe(dir, '.fakemini');
  assert.equal(mini.isolation.promised, false);
  assert.equal(mini.isolation.available, false, 'a zone that did not promise channels cannot claim isolation');
  assert.equal(mini.capabilities.subagents, false);
}));

console.log(`\nAll ${passed} new-card gate checks passed.`);
