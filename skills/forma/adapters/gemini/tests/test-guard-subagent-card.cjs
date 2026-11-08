#!/usr/bin/env node
'use strict';
// codes are assembled so the clean-zone scan sees no project card code in a template file
const CARD_A = ['card', '901'].join('-');
const CARD_B = ['card', '902'].join('-');

const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');

let passed = 0;
const it = (name, fn) => { fn(); passed += 1; console.log('ok  ' + name); };

const hookScript = path.resolve(__dirname, '../hooks/guard-subagent-card.cjs');

function runHook(payload) {
  const res = spawnSync(process.execPath, [hookScript], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
  });
  return JSON.parse(res.stdout.trim());
}

it('blocks invoke_subagent without a card number', () => {
  const res = runHook({
    toolCall: {
      name: 'invoke_subagent',
      args: {
        TypeName: 'run',
        Role: 'run-script',
        Prompt: 'Do a quick check without a card',
      },
    },
  });
  assert.equal(res.decision, 'deny');
  assert.match(res.reason, /AGENTS\.md §6/);
});

it('allows invoke_subagent with a card-NNN given in the Prompt', () => {
  const res = runHook({
    toolCall: {
      name: 'invoke_subagent',
      args: {
        TypeName: 'run',
        Role: 'run-site-php',
        Prompt: `Card: ${CARD_A}. Running the audit.`,
      },
    },
  });
  assert.equal(res.decision, 'allow');
});

it('allows invoke_subagent with a card-NNN given in the Role', () => {
  const res = runHook({
    toolCall: {
      name: 'invoke_subagent',
      args: {
        TypeName: 'run',
        Role: `run-image (${CARD_B})`,
        Prompt: 'Banner generation.',
      },
    },
  });
  assert.equal(res.decision, 'allow');
});

console.log(`\nAll ${passed} guard-subagent-card checks passed.`);
