#!/usr/bin/env node
'use strict';

/**
 * The instruction weight - how many tokens of the law and the role are loaded into a node on EVERY step of a call.
 *
 * Why. §3 orders writing the cache-read (R) of every visit. R accumulates over the agent's steps:
 * the law enters the input not once per visit, but anew on every internal step.
 * So R by itself does not answer "how much went to the instruction" -
 * it answers only together with the weight of one step. This script gives the second number.
 *
 *   R / the weight of one step ≈ the number of the agent's steps
 *   the weight of one step × the steps = the whole instruction of the visit
 *
 * The HONEST CAVEAT that must not be lost along the way: this is an ESTIMATE, not a measurement.
 * There is no tokenizer here; the count goes by the "bytes per token" heuristic, and it differs
 * for Latin and Cyrillic. Plus the real input also carries the engine's system prompt
 * and the tool descriptions - we do not write those, and from here they are not visible.
 * So the real step weight is MORE than the counted one, and the number of steps is an UPPER estimate.
 *
 * Usage:
 *   node instruction-weight.cjs            -> JSON per node
 *   node instruction-weight.cjs --human    -> a table for reading by eye
 *
 * Printed labels come from the core dictionary: English key in code, ru value as data.
 */

const fs = require('fs');
const path = require('path');
const i18n = require('../../.forma/i18n/index.cjs');
const msg = (code, params) => i18n.message(code, params, 'ru');

const ROOT = path.resolve(__dirname, '..', '..');

// The common part - loaded to all five whole, without exemptions.
const COMMON = ['AGENTS.md', '.claude/rules/claude-8.md'];

// A role file per node. The on-demand roles (.claude/agents/on-demand/) are NOT included here
// on purpose: they load on demand, not on every visit, and attributing them
// to the constant weight would overstate the instruction of all nodes at once.
const ROLE_FILE = {
  Intent: '.claude/agents/intent.md',
  Spec: '.claude/agents/spec.md',
  Kit: '.claude/agents/kit.md',
  Run: '.claude/agents/run.md',
  Core: '.claude/agents/core.md',
};

// Bytes per token. Cyrillic in UTF-8 takes two bytes per letter and is split
// into pieces more often than Latin - hence its notably lower coefficient.
const BYTES_PER_TOKEN_LATIN = 4.1;
const BYTES_PER_TOKEN_CYRILLIC = 2.2;

function estimateTokens(text) {
  // Cyrillic LETTERS, not bytes: the length in bytes is counted separately below.
  const cyrillicChars = (text.match(/[\u0400-\u04FF]/g) || []).length;
  const cyrillicBytes = cyrillicChars * 2;
  const totalBytes = Buffer.byteLength(text, 'utf8');
  const latinBytes = Math.max(0, totalBytes - cyrillicBytes);
  return Math.round(latinBytes / BYTES_PER_TOKEN_LATIN + cyrillicBytes / BYTES_PER_TOKEN_CYRILLIC);
}

function weighFile(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return null;
  const text = fs.readFileSync(abs, 'utf8');
  return { file: rel, bytes: Buffer.byteLength(text, 'utf8'), tokens: estimateTokens(text) };
}

function instructionWeight() {
  const common = COMMON.map(weighFile).filter(Boolean);
  const commonTokens = common.reduce((s, f) => s + f.tokens, 0);

  const byNode = {};
  for (const [node, rel] of Object.entries(ROLE_FILE)) {
    const role = weighFile(rel);
    if (!role) continue;
    byNode[node] = {
      common: commonTokens,
      role: role.tokens,
      perStep: commonTokens + role.tokens,
      files: [...common.map((f) => f.file), role.file],
    };
  }

  return {
    estimate: true,
    note: msg('iw.note'),
    common: { tokens: commonTokens, files: common },
    byNode: byNode,
  };
}

/** The number of the agent's steps by the visit's cache-read. An upper estimate - see the caveat above. */
function stepsFromCacheRead(cacheRead, perStep) {
  if (!cacheRead || !perStep) return null;
  return Number((cacheRead / perStep).toFixed(1));
}

function main() {
  const result = instructionWeight();
  if (!process.argv.includes('--human')) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }
  console.log(msg('iw.human_header') + '\n');
  console.log(msg('iw.common_line', { tokens: result.common.tokens }));
  for (const f of result.common.files) console.log('  ' + f.file + ' — ' + f.tokens);
  console.log('');
  for (const [node, v] of Object.entries(result.byNode)) {
    console.log(
      node.padEnd(8) + msg('iw.per_step', { perStep: String(v.perStep).padStart(7), common: v.common, role: v.role })
    );
  }
  console.log('\n' + result.note);
}

if (require.main === module) main();

module.exports = { instructionWeight, stepsFromCacheRead, estimateTokens };
