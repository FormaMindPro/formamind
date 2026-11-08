#!/usr/bin/env node
'use strict';

/**
 * PreToolUse hook for Antigravity:
 * Intercepts invoke_subagent, verifies that the call is bound to a valid card (card-NNN)
 * per AGENTS.md §6 ("Any reach to a subagent is tied to a card — no exceptions"),
 * and validates that Run roles follow the catalog convention.
 * Outputs { decision: "deny" | "allow", reason?: string } on stdout.
 */

/** Message from the core dictionary by its English key, fixed ru language (the labels the hook has
 * always printed); English fallback when the dictionary is absent. The hook file runs from the
 * installed layout only, where the dictionary sits two levels up at .forma/i18n. */
function msg(code, params, fallback) {
  try {
    return require('../../.forma/i18n/index.cjs').message(code, params, 'ru');
  } catch {
    return fallback;
  }
}

let inputData = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  inputData += chunk;
});

process.stdin.on('end', () => {
  let decision = { decision: 'allow' };

  try {
    if (inputData.trim()) {
      const payload = JSON.parse(inputData);
      const toolCall = payload.toolCall || {};
      const toolName = toolCall.name || '';
      const toolArgs = toolCall.args || {};

      if (toolName === 'invoke_subagent') {
        const prompt = String(toolArgs.Prompt || '');
        const role = String(toolArgs.Role || '');
        const typeName = String(toolArgs.TypeName || '');

        // 1. A card number (card-NNN) must be named in the prompt or the role
        const cardMatch = (prompt + ' ' + role).match(/\b(card-\d{1,4})\b/i);
        if (!cardMatch) {
          decision = {
            decision: 'deny',
            reason: msg('hook.subagent_no_card', {},
              'Blocked invoke_subagent (AGENTS.md §6): every subagent call must be tied to a card. Name the card (for example: "Card: card-NNN" or "card-NNN") in the Prompt parameter.'),
          };
        }

        // 2. A Run role must follow the catalog convention (a warning on stderr)
        if (decision.decision === 'allow' && (typeName.toLowerCase() === 'run' || role.toLowerCase().startsWith('run'))) {
          const knownRunRoles = [
            'run-site-build', 'run-site-php', 'run-image', 'run-image-series',
            'run-text', 'run-mechanical', 'run-script', 'run-python',
            'run-vector', 'run-visual-check', 'run-schema-markup'
          ];
          const isCatalog = knownRunRoles.some(r => role.toLowerCase().includes(r) || typeName.toLowerCase().includes(r));
          if (!isCatalog && !role.toLowerCase().startsWith('run-')) {
            process.stderr.write(msg('hook.subagent_role_uncataloged', { role },
              `[guard-subagent-card warning] Role "${role}" does not follow the catalog .agents/plugins/forma/agents/run/ (expected: run-site-php, run-image, etc.).`) + '\n');
          }
        }
      }
    }
  } catch (err) {
    process.stderr.write(`[guard-subagent-card error] ${err.message}\n`);
  }

  process.stdout.write(JSON.stringify(decision) + '\n');
});
