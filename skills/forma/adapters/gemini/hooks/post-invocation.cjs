#!/usr/bin/env node
'use strict';

/**
 * PostInvocation hook for Antigravity:
 * Reads transcript.jsonl, identifies tool calls / subagent invocations,
 * and records raw entries into .agents/.ledger/calls.jsonl.
 */

const fs = require('fs');
const path = require('path');

let inputData = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  inputData += chunk;
});

process.stdin.on('end', () => {
  let root = process.cwd();

  try {
    if (inputData.trim()) {
      const payload = JSON.parse(inputData);
      if (payload.workspacePaths && payload.workspacePaths.length > 0) {
        root = payload.workspacePaths[0];
      }

      const ledgerDir = path.join(root, '.agents', '.ledger');
      fs.mkdirSync(ledgerDir, { recursive: true });
      const ledgerFile = path.join(ledgerDir, 'calls.jsonl');

      // With a transcriptPath given, scan the new steps
      if (payload.transcriptPath && fs.existsSync(payload.transcriptPath)) {
        recordFromTranscript(payload.transcriptPath, ledgerFile, payload.conversationId);
      }
    }
  } catch (err) {
    process.stderr.write(`[post-invocation error] ${err.message}\n`);
  }

  // PostInvocation output contract
  process.stdout.write(JSON.stringify({ injectSteps: [] }) + '\n');
});

function recordFromTranscript(transcriptPath, ledgerFile, conversationId) {
  const content = fs.readFileSync(transcriptPath, 'utf8');
  const lines = content.trim().split('\n').filter(Boolean);

  // Read the already recorded steps
  const seenKeys = new Set();
  if (fs.existsSync(ledgerFile)) {
    const existing = fs.readFileSync(ledgerFile, 'utf8').trim().split('\n').filter(Boolean);
    for (const line of existing) {
      try {
        const obj = JSON.parse(line);
        seenKeys.add(`${obj.conversationId || ''}:${obj.step_index}`);
      } catch {}
    }
  }

  const newRecords = [];

  for (let i = 0; i < lines.length; i++) {
    try {
      const step = JSON.parse(lines[i]);

      // Of interest: invoke_subagent calls, or model answers carrying token metrics
      let hasSubagent = false;
      let subagentCall = null;

      if (step.tool_calls && Array.isArray(step.tool_calls)) {
        for (const tc of step.tool_calls) {
          if (tc.name === 'invoke_subagent') {
            hasSubagent = true;
            subagentCall = tc;
            break;
          }
        }
      }

      if (hasSubagent) {
        let subConvId = null;
        for (let j = i + 1; j < Math.min(lines.length, i + 5); j++) {
          try {
            const nextStep = JSON.parse(lines[j]);
            if (nextStep.content && typeof nextStep.content === 'string') {
              const m = nextStep.content.match(/"conversationId":\s*"([a-f0-9-]+)"/);
              if (m) { subConvId = m[1]; break; }
            }
          } catch {}
        }
        if (!subConvId) continue; // no successfully spawned subagent - no record

        const key = `${subConvId}:${step.step_index}`;
        if (seenKeys.has(key)) continue;

        const record = {
          timestamp: step.created_at || new Date().toISOString(),
          conversationId: subConvId,
          step_index: step.step_index,
          type: step.type,
          engine: 'gemini',
          input_tokens: step.input_tokens ?? null,
          cache_read_tokens: step.cache_read_tokens ?? null,
          output_tokens: step.output_tokens ?? null,
          subagentCall: subagentCall ? {
            name: subagentCall.args?.TypeName || subagentCall.args?.Role,
            role: subagentCall.args?.Role,
            promptSnippet: (subagentCall.args?.Prompt || '').slice(0, 200),
          } : null,
        };

        newRecords.push(JSON.stringify(record));
        seenKeys.add(key);
      }
    } catch {}
  }

  if (newRecords.length > 0) {
    fs.appendFileSync(ledgerFile, newRecords.join('\n') + '\n', 'utf8');
  }
}

module.exports = { recordFromTranscript };
