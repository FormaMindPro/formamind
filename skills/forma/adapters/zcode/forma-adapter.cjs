'use strict';

/**
 * The ZCode adapter for the Forma core.
 * The core finds it by itself - the `forma-adapter.cjs` file in a root directory whose name starts with a dot;
 * the object's shape and the missing-field substitution - in the header of `.forma/dashboard/lib/engines.cjs`.
 * The engine's facts - `.zcode/rules/zcode-8.md`; the shape fit is checked by `.zcode/tests/test-zcode-adapter.cjs`.
 *
 * What only this engine knows:
 *  - transcriptsDir/parseUsage: the model-IO transcripts are written by the host itself - ~/.zcode/cli/rollout,
 *    `model-io-sess_<id>.jsonl`, the step carries `usage: { inputTokens, outputTokens, totalTokens,
 *    cacheReadTokens, cacheWriteTokens }` or the provider ones `input_tokens/output_tokens/
 *    cache_read_input_tokens`
 *  - skillsDir `.agents/skills/` - ZCode opens them natively as the project's skills
 *  - nodeModels: the GLM family (Z.AI), the thinking levels low/high/max (no middle one)
 *  - the Forma nodes are not registered as the host's agent types - the route goes degraded,
 *    the stages in one context under the [STAGE] labels (`.zcode/rules/zcode-8.md`, Contract 2)
 *
 * Printed labels come from the core dictionary: English key in code, ru value as data.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const i18n = require([
  path.resolve(__dirname, '../.forma/i18n/index.cjs'),
  path.resolve(__dirname, '../../.forma/i18n/index.cjs'),
  path.resolve(__dirname, '../../core/i18n/index.cjs'),
].find((p) => fs.existsSync(p)));
const msg = (code, params) => i18n.message(code, params, 'ru');

function resolveModule(candidates) {
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return candidates[0];
}

function getFormaRolesModule() {
  return require(resolveModule([
    path.resolve(__dirname, '../.forma/dashboard/lib/forma-roles.cjs'),
    path.resolve(__dirname, '../../.forma/dashboard/lib/forma-roles.cjs'),
    path.resolve(process.cwd(), '.forma/dashboard/lib/forma-roles.cjs'),
  ]));
}

const BYTES_PER_TOKEN_LATIN = 4.1;
const BYTES_PER_TOKEN_CYRILLIC = 2.2;

function estimateTokens(text) {
  const cyrillicChars = (text.match(/[\u0400-\u04ff]/g) || []).length;
  const cyrillicBytes = cyrillicChars * 2;
  const latinBytes = Math.max(0, Buffer.byteLength(text, 'utf8') - cyrillicBytes);
  return Math.round(latinBytes / BYTES_PER_TOKEN_LATIN + cyrillicBytes / BYTES_PER_TOKEN_CYRILLIC);
}

function weighFile(root, rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return null;
  const text = fs.readFileSync(abs, 'utf8');
  return { file: rel, bytes: Buffer.byteLength(text, 'utf8'), tokens: estimateTokens(text) };
}

function instructionWeight(root = process.cwd()) {
  const MODEL = 'glm-5.3-flash';
  const commonFiles = ['AGENTS.md', '.zcode/rules/zcode-8.md'];
  const common = commonFiles.map((f) => weighFile(root, f)).filter(Boolean);
  const commonTokens = common.reduce((s, f) => s + f.tokens, 0);

  const roleFiles = {
    Intent: '.zcode/agents/intent.md',
    Spec: '.zcode/agents/spec.md',
    Kit: '.zcode/agents/kit.md',
    Run: '.zcode/agents/run.md',
    Core: '.zcode/agents/core.md',
  };

  const byNode = {};
  for (const [node, rel] of Object.entries(roleFiles)) {
    const role = weighFile(root, rel);
    if (!role) continue;
    byNode[node] = {
      model: MODEL,
      common: commonTokens,
      role: role.tokens,
      perStep: commonTokens + role.tokens,
      files: [...common.map((f) => f.file), role.file],
    };
  }

  return {
    estimate: true,
    model: MODEL,
    note: msg('zad.iw_note'),
    common: { tokens: commonTokens, files: common },
    byNode,
  };
}

function stepsFromCacheRead(cacheRead, perStep) {
  if (!cacheRead || !perStep) return null;
  return Number((cacheRead / perStep).toFixed(1));
}

function transcriptsDir(root = process.cwd()) {
  const localDir = path.join(root, '.zcode', 'transcripts');
  if (fs.existsSync(localDir)) return localDir;

  const base = process.env.ZCODE_HOME || path.join(os.homedir(), '.zcode');
  const rollout = path.join(base, 'cli', 'rollout');
  return fs.existsSync(rollout) ? rollout : null;
}

/**
 * A ZCode model-IO transcript step: the usage in the step flat or under `usage`.
 * The host's fields: inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens;
 * the provider ones: input_tokens, output_tokens, cache_read_input_tokens; the generic names are accepted too.
 * The host's fields are INCLUSIVE: inputTokens carries the whole input, with cacheReadTokens and cacheWriteTokens inside
 * it (a rollout fact: inputTokens + outputTokens = totalTokens), so "the other input" =
 * inputTokens minus the cache. The provider names are exclusive, like Claude's: the input without the cache.
 */
function parseUsage(step) {
  if (!step) return { tokens_in: null, tokens_out: null, cache_read: null, cache_write: null };
  const u = (step.message && step.message.usage) || step.usage || step;
  const num = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
  const pick = (keys) => {
    for (const k of keys) {
      const n = u ? num(u[k]) : null;
      if (n != null) return n;
    }
    return null;
  };
  const cacheRead = pick(['inputCacheRead', 'cache_read', 'cache_read_tokens', 'cacheReadTokens', 'cachedContentTokenCount', 'cache_read_input_tokens']);
  const cacheCreation = pick(['inputCacheCreation', 'cache_write', 'cache_write_tokens', 'cacheWriteTokens', 'cache_creation_input_tokens', 'cache_creation']);
  const hostInput = num(u && u.inputTokens);
  const inputOther = hostInput != null
    ? hostInput - (cacheRead || 0) - (cacheCreation || 0)
    : pick(['inputOther', 'tokens_in', 'input_tokens', 'promptTokenCount', 'prompt_token_count']);
  return {
    // The canonical tokens_in - the input WITHOUT the cache (N = in + write + read + out adds up in totalTokens);
    // the cache goes in separate fields. What the source did not give - null, not 0.
    tokens_in: inputOther,
    tokens_out: pick(['output', 'tokens_out', 'output_tokens', 'outputTokens', 'candidatesTokenCount', 'completion_tokens']),
    cache_read: cacheRead,
    cache_write: cacheCreation,
  };
}

/**
// A subagent's visit transcript by id: the host puts it into rollout next to the sessions - a flat file
// `model-io-sess_subagent_agent_<id>.jsonl` (the host's id may come with the `agent_` prefix - both forms are accepted).
 */
function findSubagent(agentId, root = process.cwd()) {
  const dir = transcriptsDir(root);
  const raw = String(agentId || '');
  if (!dir || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  const bare = raw.replace(/^agent_/, '');
  const names = bare === raw
    ? [`model-io-sess_subagent_agent_${bare}.jsonl`]
    : [`model-io-sess_subagent_agent_${bare}.jsonl`, `model-io-sess_subagent_${raw}.jsonl`];
  for (const name of names) {
    const file = path.join(dir, name);
    let st;
    try { st = fs.statSync(file); } catch { continue; }
    if (st.isFile()) return { file, mtimeMs: st.mtimeMs, sessionId: null };
  }
  return null;
}

/**
 * A ZCode transcript step (type model_io): the usage in `response.usage` (the host's fields), requestId and the time on the step.
 * A step without spend - `null`.
 */
function stepOf(line) {
  const u = line && line.response && line.response.usage;
  if (!u || typeof u !== 'object') return null;
  const usage = ['inputTokens', 'cacheReadTokens', 'outputTokens', 'cacheWriteTokens']
    .some((k) => Number.isFinite(Number(u[k]))) ? u : null;
  if (!usage) return null;
  return {
    usage,
    requestId: line.requestId || null,
    model: (line.model && line.model.modelId) || null,
    timestamp: line.completedAt || line.startedAt || null,
  };
}

/**
 * The MAIN session's logs: flat files `model-io-sess_<id>.jsonl` in rollout, one record per file
 * `{ id, file }` (id - the file's name without .jsonl). The subagent ones (`sess_subagent_*`) and the record without a session
 * (`model-io-no-session.jsonl`) do not enter here: the subagents' spend is written by the caller by `<usage>`,
 * a second count would double it. No directory - an empty list: no logs, which is not zero.
 */
function mainSessions(root = process.cwd()) {
  const dir = transcriptsDir(root);
  if (!dir) return [];
  let files = [];
  try { files = fs.readdirSync(dir); } catch { return []; }
  return files
    .filter((f) => /^model-io-sess_(?!subagent_)[A-Za-z0-9_-]+\.jsonl$/.test(f))
    .map((f) => ({ id: f.slice(0, -6), file: path.join(dir, f) }));
}

/**
 * One record of the ZCode main session's log -> a normalized step
 * `{ ts, key, usage, toolCalls, human, model }`:
 *   ts - the time (completedAt, else startedAt); key - requestId (the retry attempts of one call
 *   add up); usage - `response.usage` (the parse - parseUsage), without spend - null;
 *   toolCalls - the response's tool calls; model - modelId.
 *   human - the HUMAN'S REPLICA is not written in this log (the file carries only the model calls):
 *   the boundary of a turn is a new `turnId` - the host opens it on a human message (an answer to
 *   AskUserQuestion does not open a turn; the compact and the file's first record are boundaries of their own).
 *   `prev` - the log's previous line (needed for the turnId comparison).
 */
function mainStepOf(line, prev) {
  if (!line || !(line.completedAt || line.startedAt)) return null;
  const response = line.response || {};
  const u = response.usage && typeof response.usage === 'object' ? response.usage : null;
  const usage = u && ['inputTokens', 'cacheReadTokens', 'outputTokens', 'cacheWriteTokens']
    .some((k) => Number.isFinite(Number(u[k]))) ? u : null;
  return {
    ts: line.completedAt || line.startedAt,
    key: line.requestId || null,
    usage,
    toolCalls: Array.isArray(response.toolCalls) ? response.toolCalls : [],
    human: typeof line.turnId === 'string' && line.turnId !== (prev && prev.turnId || null),
    model: (line.model && line.model.modelId) || null,
  };
}

function readNodes(agentsDir) {
  if (!fs.existsSync(agentsDir)) return [];
  return fs.readdirSync(agentsDir).filter((x) => x.endsWith('.md')).sort().map((f) => {
    const content = fs.readFileSync(path.join(agentsDir, f), 'utf8');
    const nameMatch = /^#\s+(.+)$/m.exec(content);
    return {
      name: f.replace(/\.md$/, ''),
      title: nameMatch ? nameMatch[1].trim() : f.replace(/\.md$/, ''),
      file: path.relative(process.cwd(), path.join(agentsDir, f)).replace(/\\/g, '/'),
      model: 'glm-5.3-flash',
    };
  });
}

function engineSettings(root = process.cwd()) {
  const agentsDir = path.join(root, '.zcode');
  const skillsDir = path.join(root, '.agents', 'skills');
  return {
    present: fs.existsSync(agentsDir),
    env: {},
    hooks: [], // ZCode has no project hook package - a divergence, see zcode-8.md (Contract 6)
    nodes: readNodes(path.join(agentsDir, 'agents')),
    skills: fs.existsSync(skillsDir)
      ? fs.readdirSync(skillsDir).filter((f) => fs.statSync(path.join(skillsDir, f)).isDirectory()).sort()
      : [],
    mcp: { project: [], user: [], userProject: [] },
    check: { ran: true, ok: true },
  };
}

function formaRoles(root = process.cwd()) {
  const { readMdCatalog } = getFormaRolesModule();
  const cat = readMdCatalog(root, {
    title: 'ZCode',
    rolesDir: '.zcode/agents',
    mcpFiles: [],
  });
  cat.plugins = null;
  return cat;
}

module.exports = {
  engine: 'zcode',
  id: 'zcode',
  spendTag: 'zcode',

  // The engine contract (ENGINE-CONTRACT.md): the sources, the capabilities, the node -> model table, the write zones.
  sources: {
    rolesDir: '.zcode/agents',
    onDemandRolesDir: '.zcode/agents/on-demand',
    runRolesDir: '.zcode/agents/run',
    scriptsDir: '.zcode/scripts',
    skillsDir: '.agents/skills',
    testsDir: '.zcode/tests',
    mcpConfigs: [],
  },
  capabilities: { subagents: true, sendMessage: true, hooks: true, mcp: true },
  nodeModels: {
    Intent: { model: 'glm-5.3-flash', effort: 'high' },
    Spec: { model: 'glm-5.3-flash', effort: 'high' },
    Kit: { model: 'glm-5.3-flash', effort: 'high' },
    Run: { model: 'glm-5.3-flash', effort: 'low' },
    Core: { model: 'glm-5.3-flash', effort: 'high' },
  },
  writeZones: ['.zcode', '.devtool/features'],
  rolesDir: '.zcode/agents',
  onDemandRolesDir: '.zcode/agents/on-demand',
  engineRulesFile: '.zcode/rules/zcode-8.md',
  skillsDir: '.agents/skills',

  instructionWeight,
  stepsFromCacheRead,
  transcriptsDir,
  parseUsage,
  findSubagent,
  stepOf,
  mainSessions,
  mainStepOf,

  engineSettings,
  formaRoles,

  // The "Structure" tree group and the adapter directories' captions.
  structure: {
    key: 'model',
    title: msg('zad.structure_title'),
    note: msg('zad.structure_note'),
    roots: ['.zcode'],
    notes: {
      '.zcode': msg('zad.cap_zcode'),
      '.zcode/agents': msg('zad.cap_agents'),
      '.zcode/agents/on-demand': msg('zad.cap_on_demand'),
      '.zcode/rules': msg('zad.cap_rules'),
      '.zcode/scripts': msg('zad.cap_scripts'),
      '.zcode/tests': msg('zad.cap_tests'),
      '.zcode/.state': msg('zad.cap_state'),
    },
  },
};
