#!/usr/bin/env node
'use strict';

/**
 * guard-destructive.cjs - PreToolUse / Bash: the destructive-command guard of the ZCode zone.
 *
 * The decision is the shared core's (`.forma/rules/guard-delete.cjs`): the protected-path registry
 * (`.forma/rules/protected-paths.json`), the one-time phrase marker and the recursive-mask rules live
 * in exactly one place, and every engine calls them - this file carries no copy of the logic.
 *
 * The host's contract (zcode-8.md, "Host facts"): exit 0 - the call proceeds, exit 2 - the call is
 * denied and stderr comes back to the model as permissionDecisionReason. An unreadable input or a
 * missing core is fail-closed: a guard that cannot read its rulebook does not pass anything.
 *
 * --selftest runs the core's decisions on fixtures and the one-time marker round trip; nothing on
 * disk outside a temporary directory is touched.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MARKER = path.join('.zcode', '.state', '.delete-unlock');
const FALLBACK = 'Blocked by the guard-delete hook: the command looks like deleting or overwriting a protected path.';

function findRoot(start) {
  let dir = path.resolve(start || process.cwd());
  for (;;) {
    if (fs.existsSync(path.join(dir, '.forma', 'rules', 'guard-delete.cjs'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

function loadCore(root) {
  const file = path.join(root, '.forma', 'rules', 'guard-delete.cjs');
  if (!fs.existsSync(file)) return null;
  const core = require(file);
  return core && typeof core.checkCommand === 'function' ? core : null;
}

function message(root, command) {
  try {
    const i18n = require(path.join(root, '.forma', 'i18n', 'index.cjs'));
    const text = i18n.message('hook.delete_blocked', { cmd: command }, i18n.projectLang(root));
    if (text && text !== 'hook.delete_blocked') return text;
  } catch { /* no catalog - the English line below */ }
  return FALLBACK;
}

function deny(text) {
  process.stderr.write(text + '\n');
  process.exit(2);
}

function selftest() {
  const root = findRoot(__dirname);
  const check = (name, ok) => {
    if (ok) return 0;
    process.stderr.write('guard-destructive selftest: ' + name + '\n');
    return 1;
  };
  let failed = 0;
  if (!root) {
    process.stderr.write('guard-destructive selftest: the project root was not found from ' + __dirname + '\n');
    process.exit(1);
  }
  const core = loadCore(root);
  if (!core) deny('guard-destructive selftest: .forma/rules/guard-delete.cjs does not export checkCommand');

  const blocked = ['rm -rf .forma/rules', 'rm -rf .claude', 'mv .zcode/agents elsewhere', 'git clean -fdx'];
  for (const cmd of blocked) failed += check('must block: ' + cmd, core.checkCommand(cmd, root).blocked === true);
  const allowed = ['rm -rf build', 'git status', 'node .zcode/tests/test-zcode-adapter.cjs', 'echo "rm -rf .forma"'];
  for (const cmd of allowed) failed += check('must allow: ' + cmd, core.checkCommand(cmd, root).blocked === false);

  // The one-time marker of this zone: written where the listener writes it, consumed by the core on the
  // first protected hit, and a second hit is blocked again. A temporary root keeps the project untouched.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zcode-guard-'));
  try {
    if (typeof core.unlockDeletion !== 'function') {
      failed += check('the core exports unlockDeletion', false);
    } else {
      const marker = core.unlockDeletion(tmp, MARKER);
      failed += check('the marker lands in the zone', marker === path.join(tmp, MARKER) && fs.existsSync(marker));
      const first = core.checkCommand('rm -rf .claude/x', tmp);
      failed += check('one protected hit passes after the phrase', first.blocked === false && first.unblockedByPhrase === true);
      failed += check('the marker is consumed by that hit', !fs.existsSync(marker));
      failed += check('the next hit is blocked again', core.checkCommand('rm -rf .claude/x', tmp).blocked === true);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  if (failed) process.exit(1);
  console.log('guard-destructive selftest: ok');
}

function main() {
  if (process.argv.includes('--selftest')) return selftest();

  let raw = '';
  try {
    raw = fs.readFileSync(0, 'utf8');
  } catch (error) {
    deny('guard-destructive fail-closed: the hook input is unreadable: ' + error.message);
  }
  if (!String(raw).trim()) deny('guard-destructive fail-closed: empty hook input');

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    deny('guard-destructive fail-closed: the hook input is not JSON: ' + error.message);
  }

  const toolInput = payload.tool_input || payload.toolInput || {};
  const command = typeof toolInput.command === 'string' ? toolInput.command : '';
  if (!command.trim()) process.exit(0); // nothing to judge: not a command

  const start = payload.cwd
    || (Array.isArray(payload.workspacePaths) && payload.workspacePaths[0])
    || process.env.ZCODE_PROJECT_DIR
    || process.cwd();
  const root = findRoot(start);
  if (!root) deny('guard-destructive fail-closed: the project root was not found from ' + start);

  const core = loadCore(root);
  if (!core) deny('guard-destructive fail-closed: .forma/rules/guard-delete.cjs does not export checkCommand');

  let verdict;
  try {
    verdict = core.checkCommand(command, root);
  } catch (error) {
    deny('guard-destructive fail-closed: the rulebook did not answer: ' + error.message);
  }
  if (verdict && verdict.blocked) {
    deny(message(root, command) + (verdict.target ? ' [' + verdict.target + ']' : ''));
  }
  process.exit(0);
}

main();
