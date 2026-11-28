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
 *    cache_read_input_tokens`; a dynamic-workflow actor's transcript is `model-io-sess_dwf-<run>-actor_<N>_<M>.jsonl`
 *    by the `dwfrun-*` run id (findSubagent/workflowActor)
 *  - skillsDir `.forma/skills/` - ZCode opens them natively as the project's skills (the engine-neutral core canon)
 *  - nodeModels: the GLM family (Z.AI), the thinking levels low/high/max (no middle one)
 *  - the role models in instructionWeight/readNodes: resolved by the same sources as the zone's role
 *    generator - the project's model registry (the "role x engine" binding) and PROJECT.md's node defaults -
 *    never a constant; an unreadable source is a loud refusal naming the file
 *  - the Forma nodes are registered as the host's agent types from `.zcode/agents/`; a fresh
 *    environment without registration runs degraded under the [STAGE] labels (`.zcode/rules/zcode-8.md`, Contract 2)
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

function bareModelId(address) {
  return String(address).split('/').pop().toLowerCase();
}

/** The node defaults table of PROJECT.md: rows "| Node | `Model`, effort X | ... |" under the marker line. */
function parseNodeDefaults(projectText) {
  const lines = projectText.split(/\r?\n/);
  const marker = lines.findIndex((l) => l.includes('k:routes.node_defaults'));
  if (marker === -1) throw new Error('forma-adapter: PROJECT.md has no k:routes.node_defaults marker');
  let i = marker + 1;
  while (i < lines.length && !/^\|/.test(lines[i])) i++;
  const defaults = {};
  for (; i < lines.length && /^\|/.test(lines[i]); i++) {
    const m = lines[i].match(/^\|\s*(Intent|Spec|Kit|Run|Core)\s*\|/);
    if (!m) continue;
    const model = (lines[i].split('|')[2] || '').match(/`([^`]+)`/);
    if (model) defaults[m[1].toLowerCase()] = bareModelId(model[1]);
  }
  return defaults;
}

/**
 * A role's model - by the same sources as the zone's role generator, never a constant:
 *   1. the registry binding "role x engine zcode" (project/config/models.json, the first candidate);
 *   2. a node role without a binding - the node's default from PROJECT.md ("Node defaults",
 *      found by the k:routes.node_defaults marker);
 *   3. a role outside the five nodes - the zcode engine row's default_model of the same registry.
 * The value is the bare id (the last path segment of the address, lower case).
 * An unreadable registry or PROJECT.md is a loud refusal naming the file: no memorized value.
 */
function resolveModels(root = process.cwd()) {
  const registryPath = path.join(root, 'project', 'config', 'models.json');
  let registry;
  try {
    registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  } catch (e) {
    throw new Error('forma-adapter: the model registry is unreadable: ' + registryPath);
  }
  if (!Array.isArray(registry.engines)) throw new Error('forma-adapter: the model registry carries no engines list: ' + registryPath);
  const engine = registry.engines.find((e) => e.id === 'zcode');
  if (!engine || !engine.default_model) {
    throw new Error('forma-adapter: the registry has no zcode engine row with default_model: ' + registryPath);
  }
  const engineDefault = bareModelId(engine.default_model);
  if (registry.bindings != null && !Array.isArray(registry.bindings)) {
    throw new Error('forma-adapter: the registry bindings are not a list: ' + registryPath);
  }
  const bound = {};
  for (const b of registry.bindings || []) {
    const role = b && typeof b.role === 'string' ? b.role.toLowerCase() : null;
    if (!role || b.engine !== 'zcode' || !Array.isArray(b.candidates) || !b.candidates[0] || bound[role]) continue;
    bound[role] = bareModelId(b.candidates[0]);
  }
  const projectPath = path.join(root, 'project', 'config', 'PROJECT.md');
  let nodeDefault;
  try {
    nodeDefault = parseNodeDefaults(fs.readFileSync(projectPath, 'utf8'));
  } catch (e) {
    throw new Error('forma-adapter: PROJECT.md is unreadable or has no node defaults marker: ' + projectPath);
  }
  return { modelOf: (node) => (node && (bound[node] || nodeDefault[node])) || engineDefault };
}

function instructionWeight(root = process.cwd()) {
  const { modelOf } = resolveModels(root);
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
      model: modelOf(node.toLowerCase()),
      common: commonTokens,
      role: role.tokens,
      perStep: commonTokens + role.tokens,
      files: [...common.map((f) => f.file), role.file],
    };
  }

  return {
    estimate: true,
    model: modelOf(null),
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
// A dynamic-workflow actor is a different shape: one file per actor per visit,
// `model-io-sess_dwf-<run>-actor_<N>_<M>.jsonl`, where `<run>` is the `dwfrun-*` id a workflow run returns.
// A bare run id is accepted only while one file matches; several actors (or several visits of one actor) -
// the candidates are printed and the answer is null: the caller names the actor, the locator never picks silently.
 */
function workflowActor(dir, raw) {
  const m = /^(dwfrun-[A-Za-z0-9-]+?)(?:-actor_(\d+)(?:_(\d+))?)?$/.exec(String(raw || ''));
  if (!m) return null;
  const runId = m[1];
  const actor = m[2] || null;
  const visit = m[3] || null;
  let files;
  try { files = fs.readdirSync(dir); } catch { return null; }
  const prefix = 'model-io-sess_dwf-' + runId + '-actor_';
  const hits = [];
  for (const f of files) {
    if (!f.startsWith(prefix) || !f.endsWith('.jsonl')) continue;
    const mm = /^(\d+)_(\d+)$/.exec(f.slice(prefix.length, -'.jsonl'.length));
    if (!mm) continue;
    if (actor != null && Number(mm[1]) !== Number(actor)) continue;
    if (visit != null && Number(mm[2]) !== Number(visit)) continue;
    const file = path.join(dir, f);
    let st;
    try { st = fs.statSync(file); } catch { continue; }
    if (st.isFile()) hits.push({ file, mtimeMs: st.mtimeMs, sessionId: null });
  }
  if (hits.length === 1) return hits[0];
  if (!hits.length) return null;
  const names = hits.map((h) => path.basename(h.file)).sort();
  process.stderr.write('[workflow actor] ' + raw + ' matches ' + names.length + ' transcripts; name one: ' + names.join(', ') + '\n');
  return null;
}

function findSubagent(agentId, root = process.cwd()) {
  const dir = transcriptsDir(root);
  const raw = String(agentId || '');
  if (!dir || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  if (/^dwfrun-/.test(raw)) return workflowActor(dir, raw);
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

/** The five node roles whose model the node's default may decide (the other roles - the engine default). */
const NODE_ROLE_FILES = ['intent', 'spec', 'kit', 'run', 'core'];

function readNodes(agentsDir, root = process.cwd()) {
  if (!fs.existsSync(agentsDir)) return [];
  const { modelOf } = resolveModels(root);
  return fs.readdirSync(agentsDir).filter((x) => x.endsWith('.md')).sort().map((f) => {
    const content = fs.readFileSync(path.join(agentsDir, f), 'utf8');
    const nameMatch = /^#\s+(.+)$/m.exec(content);
    const base = f.replace(/\.md$/, '');
    return {
      name: base,
      title: nameMatch ? nameMatch[1].trim() : base,
      file: path.relative(process.cwd(), path.join(agentsDir, f)).replace(/\\/g, '/'),
      model: modelOf(NODE_ROLE_FILES.includes(base) ? base : null),
    };
  });
}

/** The zone's hooks from the host's workspace config (.zcode/config.json), the Claude tab's shape:
 *  `{ event, matcher, commands }`. The start gate (§3), the deletion guard and the phrase listener
 *  (Contract 6) live here. A project hook fires only after the human granted it persistent trust:
 *  the state is read by `.zcode/scripts/hooks-trust.cjs`, the host facts are in zcode-8.md. */
function readHooks(root) {
  const file = path.join(root, '.zcode', 'config.json');
  if (!fs.existsSync(file)) return [];
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
  const out = [];
  for (const [event, groups] of Object.entries((cfg.hooks && cfg.hooks.events) || {})) {
    for (const g of groups || []) {
      out.push({ event, matcher: g.matcher || '', commands: (g.hooks || []).map((h) => [h.command, ...(h.args || [])].join(' ')) });
    }
  }
  return out;
}

function engineSettings(root = process.cwd()) {
  const agentsDir = path.join(root, '.zcode');
  const skillsDir = path.join(root, '.forma', 'skills');
  return {
    present: fs.existsSync(agentsDir),
    env: {},
    hooks: readHooks(root),
    nodes: readNodes(path.join(agentsDir, 'agents'), root),
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

  // The provider's cost report: the script prints JSON (the official allowance, the prices and the
  // per-model spend estimate); the core runs it only when this adapter is present, and the block is
  // built only when the report says it is available.
  cost: { script: '.zcode/scripts/go-cost.cjs', label: 'OpenCode Go', currency: 'USD', ttlMs: 300000 },

  // The engine contract (ENGINE-CONTRACT.md): the sources, the capabilities, the node -> model table, the write zones.
  sources: {
    rolesDir: '.zcode/agents',
    onDemandRolesDir: '.zcode/agents/on-demand',
    runRolesDir: '.zcode/agents/run',
    scriptsDir: '.zcode/scripts',
    skillsDir: '.forma/skills',
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
  skillsDir: '.forma/skills',

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
