#!/usr/bin/env node
'use strict';

/**
 * unlock-delete.cjs - UserPromptSubmit: the listener of the human's code phrase in the ZCode zone.
 *
 * Only the human's prompt reaches this event, never the model's text. On the phrase (a Cyrillic
 * literal, held here as \u escapes; named in AGENTS.md section 2) the hook writes the one-time
 * marker `.zcode/.state/.delete-unlock` through the shared core (`.forma/rules/guard-delete.cjs`),
 * and the core's guard consumes it on the first protected deletion - the permission never lingers.
 *
 * Fail-open by design: without the core nothing is lifted, the hook says so on stderr and exits 0.
 * The marker stays inside the zone it belongs to (never .claude/hooks/, another engine's folder).
 *
 * --selftest checks the phrase matcher alone; it writes no marker.
 */

const fs = require('node:fs');
const path = require('node:path');

const MARKER = path.join('.zcode', '.state', '.delete-unlock');

// No Cyrillic or Latin letter may stand right before the verb: the look-alike does not fire.
const PHRASE = /(^|[^\u0410-\u044f\u0401\u0451A-Za-z])[\u041e\u043e]\u0442\u043a\u043b\u044e\u0447\u0438 \u0441\u0435\u043d\u0441\u043e\u0440\u0438\u043a\u0443/;

const matchesPhrase = (text) => PHRASE.test(String(text || ''));

function findRoot(start) {
  let dir = path.resolve(start || process.cwd());
  for (;;) {
    if (fs.existsSync(path.join(dir, '.forma', 'rules', 'guard-delete.cjs'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

function selftest() {
  const cases = [
    ['the phrase alone', '\u041e\u0442\u043a\u043b\u044e\u0447\u0438 \u0441\u0435\u043d\u0441\u043e\u0440\u0438\u043a\u0443', true],
    ['the phrase after punctuation', 'ok. \u041e\u0442\u043a\u043b\u044e\u0447\u0438 \u0441\u0435\u043d\u0441\u043e\u0440\u0438\u043a\u0443', true],
    ['the phrase inside a sentence', '\u041f\u043e\u0436\u0430\u043b\u0443\u0439\u0441\u0442\u0430: \u041e\u0442\u043a\u043b\u044e\u0447\u0438 \u0441\u0435\u043d\u0441\u043e\u0440\u0438\u043a\u0443 \u0438 \u0443\u0434\u0430\u043b\u0438', true],
    ['the verb with a Cyrillic letter before it', '\u043d\u0435\u043e\u0442\u043a\u043b\u044e\u0447\u0438 \u0441\u0435\u043d\u0441\u043e\u0440\u0438\u043a\u0443', false],
    ['the noun alone', '\u043e\u0442\u043a\u043b\u044e\u0447\u0438 \u0441\u0435\u043d\u0441\u043e\u0440\u0438\u043a', false],
    ['the English words', 'disable sensory', false]
  ];
  let failed = 0;
  for (const [name, text, expected] of cases) {
    if (matchesPhrase(text) !== expected) {
      process.stderr.write('unlock-delete selftest: ' + name + ' expected ' + expected + '\n');
      failed += 1;
    }
  }
  if (failed) process.exit(1);
  console.log('unlock-delete selftest: ok');
}

function main() {
  if (process.argv.includes('--selftest')) return selftest();

  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch {
    return;
  }
  const text = [payload.prompt, payload.userPrompt].filter((v) => typeof v === 'string').join('\n');
  if (!text || !matchesPhrase(text)) return;

  const start = payload.cwd
    || (Array.isArray(payload.workspacePaths) && payload.workspacePaths[0])
    || process.env.ZCODE_PROJECT_DIR
    || process.cwd();
  const root = findRoot(start);
  if (!root) return;

  try {
    const core = require(path.join(root, '.forma', 'rules', 'guard-delete.cjs'));
    if (typeof core.unlockDeletion !== 'function') throw new Error('unlockDeletion is not exported');
    core.unlockDeletion(root, MARKER);
  } catch (error) {
    process.stderr.write('unlock-delete: the rulebook is unavailable, nothing was lifted: ' + error.message + '\n');
  }
}

main();
