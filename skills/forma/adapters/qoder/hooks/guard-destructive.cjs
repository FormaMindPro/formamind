#!/usr/bin/env node
'use strict';

// PreToolUse / Bash: block the destructive commands that have no visible way back.
// A relative operand is as destructive as an absolute one, so the guard reads operands, not path prefixes.
// Exit 2 blocks the call and returns stderr to the agent.

const fs = require('fs');

let coreGuard = null;
let loadError = null;
try {
  coreGuard = require('../../../.forma/rules/guard-delete.cjs');
  if (!coreGuard || typeof coreGuard.checkCommand !== 'function') loadError = '.forma/rules/guard-delete.cjs does not export checkCommand';
} catch (error) {
  loadError = error.message;
}

const SPLIT = /\r?\n|;|&&|\|\||\|/;

function segments(command) {
  return String(command || '')
    .split(SPLIT)
    .map((s) => s.trim())
    .filter(Boolean);
}

function unwrap(segment) {
  return segment.replace(/^(?:sudo|command|time|env\s+\S+\s+)/, '').trim();
}

// `rm` that is recursive AND forced on at least one operand; `rm -rf` with no operand removes nothing.
function rmDestructive(segment) {
  const match = segment.match(/^rm\s+([\s\S]+)$/);
  if (!match) return null;
  let recursive = false;
  let force = false;
  let operands = 0;
  for (const token of match[1].split(/\s+/).filter(Boolean)) {
    if (token === '--') continue;
    if (/^-/.test(token)) {
      const flags = token.replace(/^-+/, '');
      if (/[rR]/.test(flags)) recursive = true;
      if (/f/.test(flags)) force = true;
    } else {
      operands += 1;
    }
  }
  return recursive && force && operands ? { name: 'rm -rf on a path' } : null;
}

// PowerShell Remove-Item (and its `ri` alias) with -Recurse: flags are case-insensitive and may arrive in any order.
function removeItemDestructive(segment) {
  const match = segment.match(/^(?:remove-item|ri)\s+([\s\S]+)$/i);
  if (!match) return null;
  let recursive = false;
  let operands = 0;
  for (const token of match[1].split(/\s+/).filter(Boolean)) {
    if (/^-/.test(token)) {
      const flags = token.replace(/^-+/, '').toLowerCase();
      if (flags === 'r' || flags.startsWith('recurse')) recursive = true;
    } else {
      operands += 1;
    }
  }
  return recursive && operands ? { name: 'Remove-Item -Recurse' } : null;
}

function dangerous(segment) {
  const rm = rmDestructive(segment);
  if (rm) return rm;
  if (/^git\s+reset\s+--hard\b/.test(segment)) return { name: 'git reset --hard' };
  if (/^git\s+clean\s+-[a-zA-Z]*f/.test(segment)) return { name: 'git clean -f' };
  if (/^git\s+checkout\s+--\s+/.test(segment)) return { name: 'git checkout --' };
  if (/^git\s+checkout\s+\.\/?\s*$/.test(segment)) return { name: 'git checkout .' };
  if (/^git\s+restore\s+(?:--source\S*\s+)?\S/.test(segment)) return { name: 'git restore' };
  if (/^git\s+branch\b[^\n]*\s-D(?:\s|$)/.test(segment)) return { name: 'git branch -D' };
  if (/^git\s+branch\b[^\n]*--delete\b[^\n]*--force\b/.test(segment) ||
      /^git\s+branch\b[^\n]*--force\b[^\n]*--delete\b/.test(segment)) return { name: 'git branch --delete --force' };
  if (/^git\s+stash\s+drop\b/.test(segment)) return { name: 'git stash drop' };
  if (/^git\s+stash\s+clear\b/.test(segment)) return { name: 'git stash clear' };
  if (/^git\s+push\b[^\n]*\s(?:--force(?!-with-lease)|-f)\b/.test(segment)) return { name: 'git push --force' };
  const removed = removeItemDestructive(segment);
  if (removed) return removed;
  if (/^(?:del|erase|rmdir)\s+\/s\b/i.test(segment)) return { name: 'del /s' };
  if (/^find\b[^\n]*\s-delete(?:\s|$)/.test(segment)) return { name: 'find -delete' };
  if (/^find\b[^\n]*\s-(?:exec|execdir)\s+(?:rm|rmdir)\b/.test(segment)) return { name: 'find -exec rm' };
  const shell = segment.match(/^(?:bash|sh|zsh)\s+-c\s+(.+)$/) ||
    segment.match(/^(?:powershell|pwsh)(?:\.exe)?\s+(?:-c|-command)\s+(.+)$/i);
  return shell ? dangerous(shell[1].replace(/^["']|["']$/g, '')) : null;
}

function classify(command) {
  for (const raw of segments(command)) {
    const hit = dangerous(unwrap(raw));
    if (hit) return hit;
  }
  return null;
}

function selftest() {
  const cases = [
    // absolute and dotted paths
    ['rm -rf ./build', true],
    ['rm -rf /tmp/sled', true],
    // relative paths without ./ or a drive letter
    ['rm -rf node_modules', true],
    ['rm -rf build', true],
    ['rm -rf src', true],
    ['rm -r -f src', true],
    ['rm -fr dist', true],
    // PowerShell Remove-Item, flags in either order
    ['Remove-Item -Recurse -Force .\\src', true],
    ['Remove-Item -Force -Recurse src', true],
    // git history and worktree
    ['git reset --hard HEAD~1', true],
    ['git clean -fd', true],
    ['git checkout -- src/app.js', true],
    ['git checkout .', true],
    ['git restore src/app.js', true],
    ['git branch -D dev', true],
    ['git branch --delete --force dev', true],
    ['git stash drop', true],
    ['git stash clear', true],
    ['git push --force origin main', true],
    ['git push -f origin main', true],
    // find
    ["find . -name '*.log' -delete", true],
    ['find . -name "*.tmp" -exec rm {} +', true],
    // still allowed: safe forms and quoted text
    ['git push --force-with-lease', false],
    ['rm -rf', false],
    ['rm file.txt', false],
    ['rm -f file.txt', false],
    ['git status', false],
    ['git checkout -b feature', false],
    ['git branch -d merged-feature', false],
    ['git stash list', false],
    ["find . -name '*.log'", false],
    ['node .qoder/engine/checks/selftest.cjs', false],
    ['echo "git reset --hard"', false],
    ['printf %s "git reset --hard"', false],
    ['bash -c "git reset --hard"', true],
    ['bash -c "rm -rf node_modules"', true],
    ['powershell -Command "Remove-Item -Recurse -Force src"', true]
  ];
  let failed = 0;
  for (const [command, expected] of cases) {
    const hit = Boolean(classify(command));
    if (hit !== expected) {
      console.error('guard-destructive selftest: ' + command + ' expected ' + expected + ' got ' + hit);
      failed += 1;
    }
  }
  if (failed) process.exit(1);
  console.log('guard-destructive selftest: ok');
}

function block(reason) {
  console.error(reason);
  process.exit(2);
}

function main() {
  if (process.argv.includes('--selftest')) {
    if (loadError) block('guard-destructive selftest: rulebook unavailable: ' + loadError);
    return selftest();
  }
  if (loadError) block('[sled] guard-destructive fail-closed: the rulebook is unavailable: ' + loadError);
  let raw = '';
  try {
    raw = fs.readFileSync(0, 'utf8');
  } catch (error) {
    block('[sled] guard-destructive fail-closed: the hook input is unreadable: ' + error.message);
  }
  if (!String(raw).trim()) block('[sled] guard-destructive fail-closed: empty hook input');
  let input = {};
  try {
    input = JSON.parse(raw || '{}');
  } catch (error) {
    block('[sled] guard-destructive fail-closed: the hook input is not JSON: ' + error.message);
  }
  const toolInput = input.tool_input || input.toolInput || {};
  const command = toolInput.command;
  // The core rulebook answers first: it knows the one-time unlock marker. A lifted action is the only
  // pass that skips the local classifier; everything else still meets it.
  let core;
  try {
    core = coreGuard.checkCommand(command, process.cwd());
  } catch (error) {
    block('[sled] guard-destructive fail-closed: the rulebook did not answer: ' + error.message);
  }
  if (core && core.blocked) {
    block('[sled] destructive action blocked (' + (core.target || 'core guard') + '): ' + (core.reason || 'the protected path rule fired'));
  }
  if (core && core.unblockedByPhrase) process.exit(0);
  const hit = classify(command);
  if (hit) {
    block('[sled] destructive action blocked (' + hit.name + '). Record a return path in History and ask the human before running it.');
  }
  process.exit(0);
}

main();
