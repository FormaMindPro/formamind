#!/usr/bin/env node
'use strict';

/**
 * test-spend-hooks.cjs - the spend wiring of the Claude zone (claude-8.md, "Automatic recording").
 * The claim to prove: the SubagentStop hook runs the ledger recorder and the SessionEnd hook runs the
 * session spend writer, and every command named there points at an existing file. Writing is not
 * exercised here; the hook itself is checked by ledger-recorder.test.cjs and card-session-spend.test.cjs.
 *
 * Run: node .claude/scripts/test-spend-hooks.cjs
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const settings = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8'));
const hooks = settings.hooks || {};

function commandsOf(event) {
  const groups = hooks[event];
  assert.ok(Array.isArray(groups) && groups.length, `settings.json has no ${event} hooks`);
  return groups.flatMap((g) => (g.hooks || []).map((h) => h.command || ''));
}

function scriptOf(command) {
  const tokens = command.trim().split(/\s+/);
  const nodeAt = tokens.findIndex((t) => /(^|[\\/])node(\.exe)?$/.test(t));
  assert.ok(nodeAt !== -1, `not a node command: ${command}`);
  return tokens[nodeAt + 1];
}

let passed = 0;
const it = (name, fn) => { fn(); passed += 1; console.log('ok  ' + name); };

it('the SubagentStop hook runs the ledger recorder', () => {
  const commands = commandsOf('SubagentStop');
  const hit = commands.find((c) => c.includes('ledger-recorder.cjs'));
  assert.ok(hit, 'SubagentStop does not run ledger-recorder.cjs');
  const rel = scriptOf(hit);
  assert.ok(fs.existsSync(path.join(root, rel)), `missing script: ${rel}`);
});

it('the SessionEnd hook runs the session spend writer in --auto mode', () => {
  const commands = commandsOf('SessionEnd');
  const hit = commands.find((c) => c.includes('card-session-spend.cjs'));
  assert.ok(hit, 'SessionEnd does not run card-session-spend.cjs');
  assert.ok(/--auto\b/.test(hit), 'the SessionEnd command lacks --auto');
  const rel = scriptOf(hit);
  assert.ok(fs.existsSync(path.join(root, rel)), `missing script: ${rel}`);
});

it('every node command of the spend hooks points at an existing file', () => {
  for (const event of ['SubagentStop', 'SessionEnd']) {
    for (const command of commandsOf(event)) {
      if (!/\bnode\b/.test(command)) continue;
      const rel = scriptOf(command);
      assert.ok(fs.existsSync(path.join(root, rel)), `${event}: missing script ${rel}`);
    }
  }
});

console.log(`\n${passed} spend-hook checks passed`);
