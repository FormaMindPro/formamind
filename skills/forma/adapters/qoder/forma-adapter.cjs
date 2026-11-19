'use strict';

/**
 * The Qoder adapter for the Forma core.
 * The core finds it by itself - the `forma-adapter.cjs` file in a root directory whose name starts with a dot;
 * the object's shape and the missing-field substitution - in the header of `.forma/dashboard/lib/engines.cjs`.
 * The engine's facts - `.qoder/engine/qoder-8.md`; the shape fit is checked by `.qoder/tests/test-qoder-adapter.cjs`.
 *
 * What only this engine knows:
 *  - Qoder reads AGENTS.md natively; the native surfaces are `.qoder/settings.json` and `.qoder/commands/`,
 *    the internal holders live under `.qoder/engine/` (law, hooks, checks, witnesses, this §8 file).
 *  - The host registers agent types only through its Desktop settings: a file-based roles directory is a
 *    catalog, not registration. Until Forma roles are registered, the route runs degraded and the main
 *    session carries Intent.
 *  - The host transcript carries request/response hashes and a requestId in `requestTokenAnchor`; it does
 *    not carry token usage. A real step therefore parses to null - the spend line says `unknown`, never 0.
 *  - No live `sendMessage` to a subagent: an execution slip is corrected by a written instruction in a
 *    new call, counted as an attempt.
 *
 * Printed labels come from the core dictionary; this file holds no project state.
 */

const fs = require('fs');
const path = require('path');

function resolveModule(candidates) {
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return candidates[0];
}

const i18n = require(resolveModule([
  path.resolve(__dirname, '../.forma/i18n/index.cjs'),
  path.resolve(__dirname, '../../.forma/i18n/index.cjs'),
  path.resolve(__dirname, '../../core/i18n/index.cjs'),
]));
const msg = (code, params) => i18n.message(code, params, 'ru');

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

/**
 * A transcript step -> spend fields. Only explicit fields are read; absent values stay null.
 * Qoder's own transcript has no usage record, so a real step returns all null - the caller writes
 * `unknown` with a reason, never a zero.
 */
function parseUsage(step) {
  const empty = { tokens_in: null, tokens_out: null, cache_read: null, cache_write: null };
  if (!step || typeof step !== 'object') return empty;
  const u = step.usage || (step.message && step.message.usage) || (step.response && step.response.usage) || step;
  const num = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
  const pick = (keys) => {
    for (const k of keys) {
      const n = num(u[k]);
      if (n != null) return n;
    }
    return null;
  };
  return {
    tokens_in: pick(['tokens_in', 'input_tokens', 'inputTokens', 'prompt_tokens', 'promptTokenCount']),
    tokens_out: pick(['tokens_out', 'output_tokens', 'outputTokens', 'completion_tokens', 'candidatesTokenCount']),
    cache_read: pick(['cache_read', 'cache_read_tokens', 'cacheReadTokens', 'cache_read_input_tokens']),
    cache_write: pick(['cache_write', 'cache_write_tokens', 'cacheWriteTokens', 'cache_creation_input_tokens']),
  };
}

/** The weight of the law and a role per one call step - an estimate by the files, not by the metadata. */
function instructionWeight(root = process.cwd()) {
  const commonFiles = ['AGENTS.md', '.qoder/engine/qoder-8.md'];
  const common = commonFiles.map((f) => weighFile(root, f)).filter(Boolean);
  const commonTokens = common.reduce((s, f) => s + f.tokens, 0);

  const roleFiles = {
    Intent: '.qoder/engine/agents/intent.md',
    Spec: '.qoder/engine/agents/spec.md',
    Kit: '.qoder/engine/agents/kit.md',
    Run: '.qoder/engine/agents/run.md',
    Core: '.qoder/engine/agents/core.md',
  };

  const byNode = {};
  for (const [node, rel] of Object.entries(roleFiles)) {
    const role = weighFile(root, rel);
    if (!role) continue;
    byNode[node] = {
      model: NODE_MODELS[node].model,
      effort: NODE_MODELS[node].effort,
      common: commonTokens,
      role: role.tokens,
      perStep: commonTokens + role.tokens,
      files: [...common.map((f) => f.file), role.file],
    };
  }

  return {
    estimate: true,
    model: 'per-node (deepseek, deepseek-flash, qwen-3.8-flash)',
    note: msg('qad.iw_note'),
    common: { tokens: commonTokens, files: common },
    byNode,
  };
}

/** The roles' catalog with their frontmatter models - the zone's engineering choice, read not invented. */
function readNodes(root) {
  const agentsDir = path.join(root, '.qoder', 'engine', 'agents');
  if (!fs.existsSync(agentsDir)) return [];
  return fs.readdirSync(agentsDir).filter((x) => x.endsWith('.md')).sort().map((f) => {
    const content = fs.readFileSync(path.join(agentsDir, f), 'utf8');
    const nameMatch = /^#\s+(.+)$/m.exec(content);
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
    const field = (k) => (fm ? ((fm[1].match(new RegExp('^' + k + ':\\s*(.+)$', 'm')) || [])[1] || '').trim() : '');
    return {
      name: f.replace(/\.md$/, ''),
      title: nameMatch ? nameMatch[1].trim() : f.replace(/\.md$/, ''),
      file: path.relative(process.cwd(), path.join(agentsDir, f)).replace(/\\/g, '/'),
      model: field('model') || null,
      effort: field('effort') || null,
    };
  });
}

/** The zone's hooks from the host's workspace config (.qoder/settings.json), the Claude tab's shape. */
function readHooks(root) {
  const file = path.join(root, '.qoder', 'settings.json');
  if (!fs.existsSync(file)) return [];
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
  const out = [];
  for (const [event, groups] of Object.entries((cfg.hooks && typeof cfg.hooks === 'object' && cfg.hooks) || {})) {
    for (const g of groups || []) {
      out.push({ event, matcher: g.matcher || '', commands: (g.hooks || []).map((h) => [h.command, ...(h.args || [])].join(' ')) });
    }
  }
  return out;
}

function engineSettings(root = process.cwd()) {
  const skillsDir = path.join(root, '.forma', 'skills');
  return {
    present: fs.existsSync(path.join(root, '.qoder')),
    env: {},
    hooks: readHooks(root),
    nodes: readNodes(root),
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
    title: 'Qoder',
    rolesDir: '.qoder/engine/agents',
    mcpFiles: [],
  });
  cat.plugins = null;
  return cat;
}

const NODE_MODELS = {
  Intent: { model: 'deepseek', effort: 'max' },
  Spec: { model: 'deepseek-flash', effort: 'medium' },
  Kit: { model: 'deepseek-flash', effort: 'max' },
  Run: { model: 'qwen-3.8-flash', effort: 'max' },
  Core: { model: 'deepseek-flash', effort: 'max' },
};

module.exports = {
  engine: 'qoder',
  id: 'qoder',
  spendTag: 'qoder',

  // The engine contract (ENGINE-CONTRACT.md): the sources, the capabilities, the node -> model table, the write zones.
  sources: {
    rolesDir: '.qoder/engine/agents',
    onDemandRolesDir: '.qoder/engine/agents/on-demand',
    runRolesDir: '.qoder/engine/agents/run',
    scriptsDir: '.qoder/engine/scripts',
    skillsDir: '.forma/skills',
    testsDir: '.qoder/tests',
    mcpConfigs: [],
  },
  capabilities: { subagents: false, sendMessage: false, hooks: true, mcp: true },
  nodeModels: NODE_MODELS,
  writeZones: ['.qoder', '.devtool/features'],
  engineRulesFile: '.qoder/engine/qoder-8.md',

  instructionWeight,
  parseUsage,

  engineSettings,
  formaRoles,

  // The "Structure" tree group and the adapter directories' captions.
  structure: {
    key: 'model',
    title: msg('qad.structure_title'),
    note: msg('qad.structure_note'),
    roots: ['.qoder'],
    notes: {
      '.qoder': msg('qad.cap_qoder'),
      '.qoder/settings.json': msg('qad.cap_settings'),
      '.qoder/commands': msg('qad.cap_commands'),
      '.qoder/engine': msg('qad.cap_engine'),
      '.qoder/engine/agents': msg('qad.cap_agents'),
      '.qoder/engine/agents/on-demand': msg('qad.cap_on_demand'),
      '.qoder/engine/hooks': msg('qad.cap_hooks'),
      '.qoder/engine/checks': msg('qad.cap_checks'),
      '.qoder/engine/witnesses': msg('qad.cap_witnesses'),
      '.qoder/engine/scripts': msg('qad.cap_scripts'),
      '.qoder/tests': msg('qad.cap_tests'),
    },
  },
};
