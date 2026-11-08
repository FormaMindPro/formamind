'use strict';

/**
 * The MiniMax engine economy: the transcript parsing, the instruction weight, the transcript directory.
 *
 * Three functions the core asks the adapter for (the shape - `.forma/dashboard/lib/engines.cjs`):
 *   parseUsage(step)      -> { tokens_in, tokens_out, cache_read, cache_write }
 *   transcriptsDir(root)  -> the project's transcript directory | null
 *   instructionWeight()   -> how many tokens of the law and the role are loaded into a node on EVERY step
 *
 * My engine's transcripts are written by the plugin's hook into `.minimax/.transcripts/` - one
 * JSONL line per step. The step format is tolerant: both the common fields
 * (`tokens_in`/`tokens_out`/`cache_read`) and the Claude form (`usage.input_tokens`) are accepted.
 * The unknown stays `null`, not zero: §3 forbids writing zero as a number.
 */

const fs = require('fs');
const path = require('path');
// Data labels come from the core dictionary: English key in code, ru value as data.
const i18n = require('../../.forma/i18n/index.cjs');
const msg = (code, params) => i18n.message(code, params, 'ru');

const ROOT = path.resolve(__dirname, '..', '..');
const TRANSCRIPTS = path.join(ROOT, '.minimax', '.transcripts');

// Bytes per token: Cyrillic in UTF-8 is two bytes per letter and splits more often than Latin.
const BYTES_PER_TOKEN_LATIN = 4.1;
const BYTES_PER_TOKEN_CYRILLIC = 2.2;

function estimateTokens(text) {
  // The Cyrillic block U+0400..U+04FF, as \u escapes: the source stays ASCII, the class matches the same characters.
  const cyrillicChars = (text.match(/[\u0400-\u04ff]/g) || []).length;
  const cyrillicBytes = cyrillicChars * 2;
  const totalBytes = Buffer.byteLength(text, 'utf8');
  const latinBytes = Math.max(0, totalBytes - cyrillicBytes);
  return Math.round(latinBytes / BYTES_PER_TOKEN_LATIN + cyrillicBytes / BYTES_PER_TOKEN_CYRILLIC);
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** A transcript step -> the step's spend. Any unknown field - null, not 0. */
function parseUsage(step) {
  if (!step || typeof step !== 'object') return null;
  const u = step.usage || step;
  const tokensIn = num(u.tokens_in ?? u.input_tokens ?? u.prompt_tokens);
  const tokensOut = num(u.tokens_out ?? u.output_tokens ?? u.completion_tokens);
  const cacheRead = num(u.cache_read ?? u.cache_read_input_tokens ?? u.cache_read_tokens);
  const cacheWrite = num(u.cache_write ?? u.cache_creation_input_tokens ?? u.cache_write_tokens);
  if (tokensIn === null && tokensOut === null && cacheRead === null && cacheWrite === null) return null;
  return { tokens_in: tokensIn, tokens_out: tokensOut, cache_read: cacheRead, cache_write: cacheWrite };
}

/** The project's transcript directory. No directory - no transcripts (null), not an empty directory. */
function transcriptsDir(root = ROOT) {
  const dir = path.join(root, '.minimax', '.transcripts');
  return fs.existsSync(dir) ? dir : null;
}

// The common part of my context: the law (read natively) + my §8.
const COMMON = ['AGENTS.md', '.minimax/rules/minimax-8.md'];

// The role file per node. On-demand roles are not here: they are loaded on demand.
const ROLE_FILE = {
  Intent: '.minimax/agents/intent.md',
  Spec: '.minimax/agents/spec.md',
  Kit: '.minimax/agents/kit.md',
  Run: '.minimax/agents/run.md',
  Core: '.minimax/agents/core.md',
};

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
    // The note travels into the dashboard's data - its ru wording is dictionary data, as before.
    note: msg('spend.minimax-economy.weight_note'),
    common: { tokens: commonTokens, files: common },
    byNode,
  };
}

/** The agent steps of a call by its cache-read. An upper estimate - see the caveat above. */
function stepsFromCacheRead(cacheRead, perStep) {
  if (!cacheRead || !perStep) return null;
  return Number((cacheRead / perStep).toFixed(1));
}

module.exports = { parseUsage, transcriptsDir, instructionWeight, stepsFromCacheRead, estimateTokens, TRANSCRIPTS };
