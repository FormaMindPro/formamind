#!/usr/bin/env node
'use strict';

// UserPromptSubmit: the human's code phrase (a Cyrillic literal, held as \u escapes below; named in
// AGENTS.md §2) sets the one-time marker .forma/.delete-unlock that guard-destructive consumes on the
// first protected deletion. Only the human's prompt reaches here, never the agent's text.
// Without the rulebook the hook cannot lift anything: the guard stays closed, so it warns and passes.

const fs = require('fs');

let coreGuard = null;
let loadError = null;
try {
  coreGuard = require('../../../.forma/rules/guard-delete.cjs');
  if (!coreGuard || typeof coreGuard.unlockDeletion !== 'function') loadError = '.forma/rules/guard-delete.cjs does not export unlockDeletion';
} catch (error) {
  loadError = error.message;
}

// No Cyrillic or Latin letter may stand right before the verb: the look-alike does not fire.
const PHRASE = /(^|[^\u0410-\u044f\u0401\u0451A-Za-z])[\u041e\u043e]\u0442\u043a\u043b\u044e\u0447\u0438 \u0441\u0435\u043d\u0441\u043e\u0440\u0438\u043a\u0443/;

const matchesPhrase = (text) => PHRASE.test(String(text || ''));

function selftest() {
  const cases = [
    ['the phrase alone', '\u041e\u0442\u043a\u043b\u044e\u0447\u0438 \u0441\u0435\u043d\u0441\u043e\u0440\u0438\u043a\u0443', true],
    ['the phrase after punctuation', 'ok. \u041e\u0442\u043a\u043b\u044e\u0447\u0438 \u0441\u0435\u043d\u0441\u043e\u0440\u0438\u043a\u0443', true],
    ['the verb with a Cyrillic letter before it', '\u043d\u0435\u043e\u0442\u043a\u043b\u044e\u0447\u0438 \u0441\u0435\u043d\u0441\u043e\u0440\u0438\u043a\u0443', false],
    ['the noun alone', '\u043e\u0442\u043a\u043b\u044e\u0447\u0438 \u0441\u0435\u043d\u0441\u043e\u0440\u0438\u043a', false],
    ['the English words', 'disable sensory', false]
  ];
  let failed = 0;
  for (const [name, text, expected] of cases) {
    if (matchesPhrase(text) !== expected) {
      console.error('unlock-delete selftest: ' + name + ' expected ' + expected);
      failed += 1;
    }
  }
  if (failed) process.exit(1);
  console.log('unlock-delete selftest: ok');
}

function main() {
  if (process.argv.includes('--selftest')) return selftest();
  let raw = '';
  try {
    raw = fs.readFileSync(0, 'utf8');
  } catch {
    return;
  }
  if (!String(raw).trim()) return;
  let input = {};
  try {
    input = JSON.parse(raw);
  } catch {
    return;
  }
  if (loadError) {
    process.stderr.write('[sled] unlock-delete: the rulebook is unavailable, nothing was lifted: ' + loadError + '\n');
    return;
  }
  const text = [input.prompt, input.userPrompt].filter((value) => typeof value === 'string').join('\n');
  if (matchesPhrase(text)) coreGuard.unlockDeletion(process.cwd());
}

if (require.main === module) main();
module.exports = { matchesPhrase };
