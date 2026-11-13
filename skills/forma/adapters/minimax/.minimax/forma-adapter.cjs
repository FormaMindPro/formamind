'use strict';

/**
 * The MiniMax Code adapter for the Forma core: what only this engine knows.
 * The core finds it by itself - the `forma-adapter.cjs` file in a root directory whose name starts with a dot;
 * the object's shape and the missing-field substitution - in the header of `.forma/dashboard/lib/engines.cjs`.
 * The shape fit is checked by `.minimax/tests/test-minimax-adapter.cjs`.
 *
 * The contracts' mechanics - `.forma/manual/ru/03-protocol/ENGINE-CONTRACT.md`;
 * what this engine carries constructively and what it holds by discipline - my section 8
 * `.minimax/rules/minimax-8.md`.
 *
 * Printed labels come from the core dictionary: English key in code, ru value as data.
 * The ru data values (the project and the user level labels) are the MCP level labels - held
 * as-is, the escape pass holds them as unicode sequences in the source.
 */

const fs = require('fs');
const path = require('path');
const economy = require('./scripts/economy.cjs');
const toolUsage = require('./scripts/tool-usage.cjs');
const { readMdCatalog } = require('../.forma/dashboard/lib/forma-roles.cjs');

const ROOT = path.resolve(__dirname, '..');
const i18n = require([path.resolve(__dirname, '../.forma/i18n/index.cjs'), path.resolve(__dirname, '../../../../core/i18n/index.cjs')].find((p) => fs.existsSync(p)));
const msg = (code, params) => i18n.message(code, params, 'ru');

/** My engine's MCP configs: the project ones travel with the repository, the user one - with the human. */
function mcpConfigs(root) {
  return [
    { rel: '.minimax/mcp_config.json', file: path.join(root, '.minimax', 'mcp_config.json'), level: '\u043f\u0440\u043e\u0435\u043a\u0442' },
    { rel: '~/.minimax/mcp.json', file: path.join(process.env.HOME || process.env.USERPROFILE || '', '.minimax', 'mcp.json'), level: '\u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044c' },
  ];
}

/** The MCP servers' names without values (prohibition 15: from the configs - only the names). */
function readMcpNames(root) {
  const out = { project: [], user: [], userProject: [] };
  for (const c of mcpConfigs(root)) {
    let data;
    try {
      if (!fs.existsSync(c.file)) continue;
      data = JSON.parse(fs.readFileSync(c.file, 'utf8'));
    } catch {
      continue;
    }
    const servers = (data && data.mcpServers) || {};
    for (const name of Object.keys(servers)) {
      if (c.level === '\u043f\u0440\u043e\u0435\u043a\u0442') out.project.push(name);
      else out.user.push(name);
    }
  }
  return out;
}

/** My settings: `.minimax/settings.json` (if they ever appear) - the source of the hooks and the environment. */
function readSettings(root) {
  const file = path.join(root, '.minimax', 'settings.json');
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** The "Engine" tab: my settings, roles, MCP, skills, the check. */
function engineSettings(root) {
  const st = readSettings(root);
  const agentsDir = path.join(root, '.minimax', 'agents');
  const skillsDir = path.join(root, '.minimax', 'skills');
  const nodes = fs.existsSync(agentsDir)
    ? fs.readdirSync(agentsDir, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => e.name)
    : [];
  const skills = fs.existsSync(skillsDir)
    ? fs.readdirSync(skillsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()
    : [];
  return {
    present: !!st,
    env: st && st.env ? Object.keys(st.env) : [],
    hooks: st && st.hooks ? Object.keys(st.hooks) : [],
    nodes,
    skills,
    mcp: readMcpNames(root),
    check: { ran: false, reason: msg('mmad.check_reason') },
    plugins: { ran: false, list: [], reason: msg('mmad.plugins_reason') },
  };
}

/** The roles slice for the "Forma" tab: the nodes and the Run directory from my zone. */
function formaRoles(root) {
  const cat = readMdCatalog(root, {
    title: 'MiniMax Code',
    rolesDir: '.minimax/agents',
    mcpFiles: mcpConfigs(root),
  });
  cat.plugins = null;
  return cat;
}

module.exports = {
  engine: 'minimax-code',
  id: 'minimax',
  // The spend label - the one the engine writes into the History lines and its own log (`minimax:`); `engine` stays the name for `check`.
  spendTag: 'minimax',

  // The engine contract (ENGINE-CONTRACT.md): the sources, the capabilities, the node -> model table, the write zones.
  sources: {
    rolesDir: '.minimax/agents',
    onDemandRolesDir: '.minimax/agents/on-demand',
    runRolesDir: '.minimax/agents/run',
    scriptsDir: '.minimax/scripts',
    skillsDir: '.minimax/skills',
    testsDir: '.minimax/tests',
    packageManifest: 'miniapps/minimax-engine/.minimax-plugin/plugin.json',
    mcpConfigs: ['.minimax/mcp_config.json'],
  },
  capabilities: { subagents: true, sendMessage: true, hooks: true, mcp: true },
  nodeModels: {
    Intent: { model: 'minimax-m3.1-flash', effort: 'medium' },
    Spec: { model: 'minimax-m3.1-flash', effort: 'medium' },
    Kit: { model: 'minimax-m3.1-flash', effort: 'medium' },
    Run: { model: 'minimax-m3.1-flash', effort: 'medium' },
    Core: { model: 'minimax-m3.1-flash', effort: 'medium' },
  },
  // The engine's write zones: its own folder, the plugin package's folder (written by my own scripts
  // `gen-plugin-agents.cjs` and `install-plugin.cjs`) and the board's cards.
  writeZones: ['.minimax', 'miniapps/minimax-engine', '.devtool/features'],

  // The instruction weight per call step and the number of the steps by the cache-read.
  instructionWeight: economy.instructionWeight,
  stepsFromCacheRead: economy.stepsFromCacheRead,

  // The tool log: the parse of the ones declared in the roles and written by the hook.
  toolUsage: {
    source: '.minimax/scripts/tool-usage.cjs',
    readDeclared: toolUsage.readDeclared,
    readLog: toolUsage.readLog,
    baseName: toolUsage.baseName,
  },

  // The call spend: the transcripts directory and the parse of one step.
  parseUsage: economy.parseUsage,
  transcriptsDir: economy.transcriptsDir,

  // The roles files, section 8 and the skills; the check scripts and the done cards' graph.
  rolesDir: '.minimax/agents',
  onDemandRolesDir: '.minimax/agents/on-demand',
  engineRulesFile: '.minimax/rules/minimax-8.md',
  skillsDir: '.minimax/skills',
  // The skills the template supplies (the core's interview): by them the "Project" tab tells the core from a project.
  templateSkills: ['acceptance-market', 'acceptance-vector', 'forma-grill-with-ui', 'grilling', 'kinship', 'project-setup', 'vdisk-setup'],
  syncScript: '.minimax/scripts/gen-roles.cjs',

  // The dialogue spend: the script writes .forma/dashboard/.cache/session-current.json.
  usageRefresh: [],

  mcpConfigs,
  engineSettings,
  formaRoles,

  // The "Structure" tree group and the adapter directories' captions.
  //
  // This is the only place where the engine DECLARES its sources to the core. By the convention
  // of `structure.cjs` the adapters' groups stand between "Engine" and "Project", and the core reads them
  // through `engines.loadAdapters` - that is, by the same path it finds the zone itself.
  //
  // The graphs (`build-kit-graphs.cjs`) today read `.claude` directly and do not reach these declarations:
  // the core must move the builder onto `engines.collect` (a card on the board). Until
  // then, the declaration here is a source, not a ready assembly: the engine declares, the core
  // assembles, and the three engines do not conflict because the sources do not intersect.
  structure: {
    key: 'model',
    title: msg('mmad.structure_title'),
    note: msg('mmad.structure_note'),
    roots: ['.minimax'],
    notes: {
      '.minimax': msg('mmad.cap_zcode'),
      '.minimax/agents': msg('mmad.cap_agents'),
      '.minimax/agents/on-demand': msg('mmad.cap_on_demand'),
      '.minimax/agents/run': msg('mmad.cap_run'),
      '.minimax/rules': msg('mmad.cap_rules'),
      '.minimax/scripts': msg('mmad.cap_scripts'),
      '.minimax/skills': msg('mmad.cap_skills'),
      '.minimax/.ledger': msg('mmad.cap_ledger'),
      '.minimax/.state': msg('mmad.cap_state'),
      '.minimax/.transcripts': msg('mmad.cap_transcripts'),
      '.minimax/tests': msg('mmad.cap_tests'),
    },
    // What the engine gives the graphs builder: a list of paths, not a ready graph. Empty - no sources.
    sources: {
      rolesDir: '.minimax/agents',
      onDemandRolesDir: '.minimax/agents/on-demand',
      runRolesDir: '.minimax/agents/run',
      scriptsDir: '.minimax/scripts',
      skillsDir: '.minimax/skills',
      testsDir: '.minimax/tests',
      rulesFile: '.minimax/rules/minimax-8.md',
      packageManifest: 'miniapps/minimax-engine/.minimax-plugin/plugin.json',
      adapter: '.minimax/forma-adapter.cjs',
      mcpConfig: '.minimax/mcp_config.json',
    },
  },
};
