'use strict';

/**
 * The Claude Code adapter for the Forma core: what only this engine knows.
 * The core finds it by itself - the `forma-adapter.cjs` file in the root directory whose name starts
 * with a dot; the object shape and the missing-field replacement - in the header of
 * `.forma/dashboard/lib/engines.cjs`.
 * The conformance to the shape is checked by `.claude/scripts/forma-adapter.test.cjs`.
 * Dashboard labels come from the core dictionary: English key in code, ru value as data.
 */

const instruction = require('./scripts/instruction-weight.cjs');
const toolUsage = require('./scripts/tool-usage.cjs');
const { claudeUsage, mainSessions, mainStepOf } = require('./scripts/claude-economy.cjs');
const view = require('./scripts/dashboard-view.cjs');
const { readMdCatalog } = require('../.forma/dashboard/lib/forma-roles.cjs');
const i18n = require('../.forma/i18n/index.cjs');
const msg = (code, params) => i18n.message(code, params, 'ru');

/** The roles slice for the "Forma" tab: the nodes and the Run catalog from .claude/agents, the plugins - engine data. */
function formaRoles(root) {
  const cat = readMdCatalog(root, {
    title: 'Claude Code',
    rolesDir: '.claude/agents',
    mcpFiles: view.mcpConfigs(root),
  });
  const p = view.engineSettings(root).plugins;
  cat.plugins = !p || !p.ran
    ? { ran: false, project: [], user: [], reason: (p && p.reason) || null }
    : { ran: true, project: p.list.filter((x) => x.scope === 'project'), user: p.list.filter((x) => x.scope !== 'project') };
  return cat;
}

module.exports = {
  engine: 'claude-code',
  id: 'claude',
  spendTag: 'claude-code',

  // The engine contract (ENGINE-CONTRACT.md): the sources, the capabilities, the node -> model table, the write zones.
  sources: {
    rolesDir: '.claude/agents',
    onDemandRolesDir: '.claude/agents/on-demand',
    runRolesDir: '.claude/agents/run',
    scriptsDir: '.claude/scripts',
    skillsDir: '.claude/skills',
    mcpConfigs: ['.mcp.json', '.claude/.mcp.json'],
  },
  capabilities: { subagents: true, sendMessage: true, hooks: true, mcp: true },
  nodeModels: {
    Intent: { model: 'claude-sonnet-5-5', effort: 'medium' },
    Spec: { model: 'claude-sonnet-5-5', effort: 'medium' },
    Kit: { model: 'claude-sonnet-5-5', effort: 'medium' },
    Run: { model: 'claude-haiku-5-5', effort: 'medium' },
    Core: { model: 'claude-sonnet-5-5', effort: 'medium' },
  },
  writeZones: ['.claude', '.devtool/features'],

  // The instruction weight per call step and the step count by cache read.
  instructionWeight: instruction.instructionWeight,
  stepsFromCacheRead: instruction.stepsFromCacheRead,

  // The tool log: parsing of what the roles declare and the hook records.
  toolUsage: {
    source: '.claude/scripts/tool-usage.cjs',
    readDeclared: toolUsage.readDeclared,
    readLog: toolUsage.readLog,
    baseName: toolUsage.baseName,
  },

  // The call spend: the transcript catalog and the parsing of one `message.usage` step;
  // the main-session log - the layout (~/.claude/projects/<slug>) and the normalized record step.
  parseUsage: claudeUsage,
  transcriptsDir: view.transcriptsDir,
  mainSessions,
  mainStepOf,

  // The role files, §8 and skills; the reconciliation scripts and the graph of done cards.
  rolesDir: '.claude/agents',
  onDemandRolesDir: '.claude/agents/on-demand',
  engineRulesFile: '.claude/rules/claude-8.md',
  skillsDir: '.claude/skills',
  // The skills the template delivers (the Claude adapter + the core interview): by them the "Project" tab tells the core from a project.
  // The list rides with the adapter - an installed project has no .forma/protocol/ clone; the check against the template - forma-adapter.test.cjs.
  templateSkills: ['engine-switch', 'excalidraw-diagrams', 'forma-grill-with-ui', 'graph-build', 'graphify', 'grilling', 'human-register', 'law-shrink', 'project-knowledge', 'skill-authoring'],
  syncScript: '.claude/scripts/sync-engines.cjs',

  // The conversation spend: the script writes .forma/dashboard/.cache/session-current.json.
  usageRefresh: [
    { script: '.claude/scripts/session-economy.cjs', args: ['--session', 'current'], cache: 'session-current.json' },
  ],

  mcpConfigs: view.mcpConfigs,
  engineSettings: view.engineSettings,
  formaRoles,

  // The "Structure" tree group and the adapter directory labels.
  structure: {
    key: 'model',
    title: msg('adapter.claude.st.title'),
    note: msg('adapter.claude.st.note'),
    roots: ['.claude'],
    notes: {
      '.claude': msg('adapter.claude.node.root'),
      '.claude/agents': msg('adapter.claude.node.agents'),
      '.claude/agents/on-demand': msg('adapter.claude.node.on_demand'),
      '.claude/rules': msg('adapter.claude.node.rules'),
      '.claude/hooks': msg('adapter.claude.node.hooks'),
      '.claude/scripts': msg('adapter.claude.node.scripts'),
      '.claude/skills': msg('adapter.claude.node.skills'),
      '.claude/settings.json': msg('adapter.claude.node.settings'),
      '.forma/skills': msg('adapter.claude.node.forma_skills'),
    },
  },
};
