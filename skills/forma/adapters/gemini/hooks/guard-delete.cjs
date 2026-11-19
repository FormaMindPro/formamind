#!/usr/bin/env node
'use strict';

/**
 * PreToolUse hook for Antigravity:
 * Reads JSON payload on stdin, checks toolCall against .forma/rules/guard-delete.cjs,
 * and outputs { decision: "deny" | "allow", reason?: string } on stdout.
 *
 * The guard is fail-closed: without the rulebook module, or with input it cannot read,
 * the hook denies and names the address instead of allowing the call.
 */

const fs = require('fs');

let runGuard = null;
let loadError = null;
try {
  const mod = require('../../.forma/rules/guard-delete.cjs');
  if (mod && typeof mod.runGuard === 'function') runGuard = mod.runGuard;
  else loadError = '.forma/rules/guard-delete.cjs does not export runGuard';
} catch (error) {
  loadError = error.message;
}

const deny = (reason) => ({ decision: 'deny', reason });
const failClosed = (reason) => deny('guard-delete fail-closed: ' + reason);

let inputData = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  inputData += chunk;
});

process.stdin.on('end', () => {
  let root = process.cwd();
  let decision = loadError ? failClosed('the rulebook is unavailable: ' + loadError) : { decision: 'allow' };

  try {
    if (loadError) throw new Error(loadError);
    if (!inputData.trim()) throw new Error('empty hook input');
    const payload = JSON.parse(inputData);
    if (payload.workspacePaths && payload.workspacePaths.length > 0) {
      root = payload.workspacePaths[0];
    }
    const toolCall = payload.toolCall || {};
    const toolName = toolCall.name || '';
    const toolArgs = toolCall.args || {};
    decision = runGuard({ toolName, args: toolArgs, root });
    if (!decision || typeof decision.decision !== 'string') throw new Error('the rulebook returned no decision');
  } catch (err) {
    decision = failClosed(err.message);
    process.stderr.write(`[guard-delete error] ${err.message}\n`);
  }

  process.stdout.write(JSON.stringify(decision) + '\n');
});
