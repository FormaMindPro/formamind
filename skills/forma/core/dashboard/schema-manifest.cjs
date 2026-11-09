// The engine schema's manifest: blocks, link types, "file -> block" rules. Data only, no disk traversal.
// The block and link-type keys are English (the RU/EN captions live separately). A file belongs to exactly
// one block: the rules go in order, the first match wins. A file with no rule lands in the "unparsed" one.
// Links and composition are not drawn here - schema.cjs assembles them from the real files.
'use strict';

const LINK_TYPES = [
  { key: 'reads', ru: '\u0447\u0438\u0442\u0430\u0435\u0442', en: 'reads' },
  { key: 'writes', ru: '\u043f\u0438\u0448\u0435\u0442', en: 'writes' },
  { key: 'calls', ru: '\u0432\u044b\u0437\u044b\u0432\u0430\u0435\u0442', en: 'calls' },
  { key: 'registers', ru: '\u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0438\u0440\u0443\u0435\u0442', en: 'registers' },
  { key: 'spawns', ru: '\u043f\u043e\u0440\u043e\u0436\u0434\u0430\u0435\u0442', en: 'spawns' },
];

const BLOCKS = [
  { key: 'rules', ru: '\u041f\u0440\u0430\u0432\u0438\u043b\u0430', en: 'Rules',
    descRu: '\u0417\u0430\u043a\u043e\u043d, \u0440\u0430\u0437\u0434\u0435\u043b \u0434\u0432\u0438\u0436\u043a\u0430, \u043f\u0440\u043e\u0444\u0438\u043b\u044c \u043f\u0440\u043e\u0435\u043a\u0442\u0430 \u0438 \u043f\u043e\u0440\u043e\u0433\u0438', descEn: 'The law, the engine section, the project profile and thresholds' },
  { key: 'nodes', ru: '\u0423\u0437\u043b\u044b \u0438 \u043c\u0430\u0440\u0448\u0440\u0443\u0442', en: 'Nodes and route',
    descRu: '\u0420\u043e\u043b\u0438 Intent, Spec, Kit, Run, Core, \u043f\u0440\u043e\u0444\u0438\u043b\u0438 Run, Plumb', descEn: 'Roles Intent, Spec, Kit, Run, Core, Run profiles, Plumb' },
  { key: 'board', ru: '\u0414\u043e\u0441\u043a\u0430', en: 'Board',
    descRu: '\u041a\u0430\u0440\u0442\u043e\u0447\u043a\u0438, \u043f\u0435\u0440\u0435\u0445\u043e\u0434\u044b, \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0438 \u0434\u043e\u0441\u043a\u0438', descEn: 'Cards, moves, board checks' },
  { key: 'economy', ru: '\u042d\u043a\u043e\u043d\u043e\u043c\u0438\u043a\u0430', en: 'Economy',
    descRu: '\u0416\u0443\u0440\u043d\u0430\u043b \u0432\u044b\u0437\u043e\u0432\u043e\u0432, \u0441\u0442\u0440\u043e\u043a\u0438 \u0440\u0430\u0441\u0445\u043e\u0434\u0430, \u0443\u0447\u0451\u0442 \u0438\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442\u043e\u0432', descEn: 'Call ledger, spend lines, tool log' },
  { key: 'checks', ru: '\u0421\u043a\u0440\u0438\u043f\u0442\u044b \u0438 \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0438', en: 'Scripts and checks',
    descRu: 'sync-engines, checks/, \u0432\u0435\u0441 \u0438\u043d\u0441\u0442\u0440\u0443\u043a\u0446\u0438\u0439', descEn: 'sync-engines, checks/, instruction weight' },
  { key: 'hooks', ru: '\u0425\u0443\u043a\u0438 \u0438 \u0440\u0430\u0437\u0440\u0435\u0448\u0435\u043d\u0438\u044f', en: 'Hooks and permissions',
    descRu: 'settings.json, \u0445\u0443\u043a\u0438, \u0443\u0440\u043e\u0432\u043d\u0438 \u0434\u043e\u0441\u0442\u0443\u043f\u0430, \u0437\u0430\u0449\u0438\u0442\u0430 \u043e\u0442 \u0443\u0434\u0430\u043b\u0435\u043d\u0438\u044f', descEn: 'settings.json, hooks, access levels, delete-guard' },
  { key: 'knowledge', ru: '\u0417\u043d\u0430\u043d\u0438\u044f \u0438 \u0433\u0440\u0430\u0444\u044b', en: 'Knowledge and graphs',
    descRu: '\u0423\u043c\u0435\u043d\u0438\u044f, \u0440\u0443\u043a\u043e\u0432\u043e\u0434\u0441\u0442\u0432\u043e, \u0433\u0440\u0430\u0444\u044b, \u0440\u0435\u0441\u0443\u0440\u0441\u044b', descEn: 'Skills, manual, graphs, resources' },
  { key: 'dashboard', ru: '\u0414\u0430\u0448\u0431\u043e\u0440\u0434', en: 'Dashboard',
    descRu: '\u0421\u0431\u043e\u0440 \u0434\u0430\u043d\u043d\u044b\u0445, \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0430, \u043b\u043e\u043a\u0430\u043b\u0438', descEn: 'Data collection, page, locales' },
  { key: 'protocol', ru: '\u041f\u0440\u043e\u0442\u043e\u043a\u043e\u043b \u0438 \u0440\u0435\u043b\u0438\u0437', en: 'Protocol and release',
    descRu: '\u041a\u043b\u043e\u043d \u043f\u0440\u043e\u0442\u043e\u043a\u043e\u043b\u0430, \u043f\u0435\u0440\u0435\u043d\u043e\u0441, \u0430\u0434\u0430\u043f\u0442\u0435\u0440\u044b \u0434\u0432\u0438\u0436\u043a\u043e\u0432, \u0440\u0430\u0441\u0448\u0438\u0440\u0435\u043d\u0438\u044f, \u043b\u043e\u043a\u0430\u043b\u0438\u0437\u0430\u0446\u0438\u044f, \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0430 \u0443\u0441\u0442\u0430\u043d\u043e\u0432\u043a\u0438',
    descEn: 'Protocol clone, transfer, engine adapters, extensions, localization, install verification' },
  { key: 'outputs', ru: '\u0412\u044b\u0445\u043e\u0434\u044b', en: 'Outputs',
    descRu: '\u0427\u0442\u043e \u0434\u0432\u0438\u0436\u043e\u043a \u043f\u0440\u043e\u0438\u0437\u0432\u043e\u0434\u0438\u0442: \u0436\u0443\u0440\u043d\u0430\u043b, \u0436\u0438\u0432\u044b\u0435 \u0437\u0430\u043f\u0438\u0441\u0438, \u0438\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442\u044b \u043f\u0440\u043e\u0434\u0443\u043a\u0442\u0430', descEn: 'What the engine produces: journal, living records, product tools' },
];

// The order matters: private rules on top, general ones below. glob: ** - any depth, * - within a name.
const RULES = [
  // rules
  { block: 'rules', glob: 'AGENTS.md', does: 'Law, sections 1-7' },
  { block: 'rules', glob: '.claude/rules/**' },
  { block: 'rules', glob: '.agents/rules/**' },
  { block: 'rules', glob: '.codex/CODEX-8.md' },
  { block: 'rules', glob: 'project/config/**' },
  { block: 'rules', glob: '.forma/templates/**' },
  // hooks and permissions (before the general rules over .claude/scripts and .forma/rules)
  { block: 'hooks', glob: '.claude/settings.json', does: 'Claude Code settings: permissions and hook registration' },
  { block: 'hooks', glob: '.claude/hooks/**' },
  { block: 'hooks', glob: '.claude/permission-levels.json' },
  { block: 'hooks', glob: '.claude/scripts/permissions-level*' },
  { block: 'hooks', glob: '.forma/rules/**' },
  { block: 'hooks', glob: '.agents/hooks/**' },
  { block: 'hooks', glob: '.agents/hooks.json' },
  { block: 'hooks', glob: '.codex/hooks/**' },
  { block: 'hooks', glob: '.codex/hooks.json' },
  { block: 'hooks', glob: '.mcp.json' },
  // nodes and the route
  { block: 'nodes', glob: '.claude/agents/**' },
  { block: 'nodes', glob: '.forma/plumb/**' },
  { block: 'nodes', glob: '.claude/scripts/plumb-*' },
  { block: 'nodes', glob: '.claude/scripts/external-model-bridge*' },
  { block: 'nodes', glob: '.codex/agents/**' },
  { block: 'nodes', glob: '.codex/roles/**' },
  // board
  { block: 'board', glob: '.forma/board/**' },
  { block: 'board', glob: '.claude/scripts/card-assets-sweep*' },
  { block: 'board', glob: '.claude/scripts/cycle-status*' },
  // economy
  { block: 'economy', glob: '.claude/scripts/claude-economy*' },
  { block: 'economy', glob: '.claude/scripts/session-economy*' },
  { block: 'economy', glob: '.claude/scripts/card-session-spend*' },
  { block: 'economy', glob: '.claude/scripts/ledger-recorder*' },
  { block: 'economy', glob: '.claude/scripts/tool-usage*' },
  { block: 'economy', glob: '.forma/dashboard/economy*' },
  { block: 'economy', glob: '.forma/dashboard/tally.cjs' },
  { block: 'economy', glob: '.forma/dashboard/spend-line.cjs' },
  { block: 'economy', glob: '.forma/dashboard/tool-usage.log' },
  // checks
  { block: 'checks', glob: '.claude/scripts/sync-engines*' },
  { block: 'checks', glob: '.claude/scripts/checks/**' },
  { block: 'checks', glob: '.claude/scripts/instruction-weight*' },
  { block: 'checks', glob: '.claude/scripts/test-ledger-parity*' },
  { block: 'checks', glob: '.forma/living/checks.json' },
  { block: 'checks', glob: '.forma/dashboard/checks/**' },
  // knowledge and graphs
  { block: 'knowledge', glob: '.claude/scripts/build-kit-graphs*' },
  { block: 'knowledge', glob: '.claude/scripts/build-engine-graph*' },
  { block: 'knowledge', glob: '.claude/scripts/build-graph-html*' },
  { block: 'knowledge', glob: '.claude/scripts/build-tendons*' },
  { block: 'knowledge', glob: '.claude/scripts/graph-query*' },
  { block: 'knowledge', glob: '.claude/scripts/auto-graphs*' },
  { block: 'knowledge', glob: '.claude/scripts/resources*' },
  { block: 'knowledge', glob: '.claude/scripts/build-core-html-payload*' },
  { block: 'knowledge', glob: '.claude/skills/graph-build/**' },
  { block: 'knowledge', glob: '.claude/skills/graphify/**' },
  { block: 'knowledge', glob: '.claude/skills/human-register/**' },
  { block: 'knowledge', glob: '.claude/skills/skill-authoring/**' },
  { block: 'knowledge', glob: '.claude/skills/grilling/**' },
  { block: 'knowledge', glob: '.claude/skills/forma-grill-with-ui/**' },
  { block: 'knowledge', glob: '.claude/skills/project-knowledge/**' },
  { block: 'knowledge', glob: '.claude/skills/engine-switch/**' },
  { block: 'knowledge', glob: '.forma/skills/**' },
  { block: 'knowledge', glob: '.forma/manual/**' },
  { block: 'knowledge', glob: '.forma/dashboard/graphify*' },
  // dashboard
  { block: 'dashboard', glob: '.forma/dashboard/**' },
  { block: 'dashboard', glob: '.claude/scripts/dashboard-view*' },
  // protocol and release
  { block: 'protocol', glob: '.forma/protocol/**' },
  { block: 'protocol', glob: '.forma/verify/**' },
  { block: 'protocol', glob: '.forma/i18n/**' },
  { block: 'protocol', glob: '.forma/extensions/**' },
  { block: 'protocol', glob: '.forma/engines.json' },
  { block: 'protocol', glob: '.forma/extensions-state.json' },
  { block: 'protocol', glob: '.forma/install-manifest.json' },
  { block: 'protocol', glob: '.claude/forma-adapter.cjs' },
  { block: 'protocol', glob: '.claude/verify-profile.cjs' },
  { block: 'protocol', glob: '.claude/project-layer.txt' },
  { block: 'protocol', glob: '.claude/scripts/engine-switch*' },
  { block: 'protocol', glob: '.claude/scripts/forma-adapter*' },
  { block: 'protocol', glob: '.agents/forma-adapter.cjs' },
  { block: 'protocol', glob: '.agents/verify-profile.cjs' },
  { block: 'protocol', glob: '.agents/mcp_config.json' },
  { block: 'protocol', glob: '.agents/scripts/**' },
  { block: 'protocol', glob: '.agents/tests/**' },
  { block: 'protocol', glob: '.codex/forma-adapter.cjs' },
  { block: 'protocol', glob: '.codex/scripts/**' },
  { block: 'protocol', glob: '.codex/tests/**' },
  { block: 'protocol', glob: '.codex/*.md' },
  { block: 'protocol', glob: '.codex/config.toml' },
  { block: 'protocol', glob: '.codex/generated-skill-mirror.json' },
  // outputs
  { block: 'outputs', glob: '.forma/living/**' },
  { block: 'outputs', glob: 'project/ops/**' },
  { block: 'outputs', glob: '.claude/skills/**', does: 'Product skill of the project' },
  { block: 'outputs', glob: '.claude/scripts/**', does: 'Product-work script of the project (site, translation, pages, images)' },
];

// The traversal roots: what counts as the schema's files. Directories not listed here (.devtool, project/cards,
// the graphs) are the engine's outputs, not its composition; where links to them lead - in AREAS.
const ROOTS = [
  'AGENTS.md', '.mcp.json',
  '.claude/agents', '.claude/rules', '.claude/scripts', '.claude/hooks', '.claude/skills',
  '.claude/settings.json', '.claude/permission-levels.json', '.claude/forma-adapter.cjs', '.claude/verify-profile.cjs', '.claude/project-layer.txt',
  '.agents/rules', '.agents/hooks', '.agents/hooks.json', '.agents/forma-adapter.cjs', '.agents/verify-profile.cjs', '.agents/mcp_config.json', '.agents/scripts', '.agents/tests',
  '.codex',
  '.forma/board', '.forma/dashboard', '.forma/plumb', '.forma/manual', '.forma/i18n', '.forma/extensions', '.forma/rules',
  '.forma/verify', '.forma/skills', '.forma/templates', '.forma/living', '.forma/engines.json', '.forma/extensions-state.json',
  '.forma/install-manifest.json',
  '.forma/protocol',
  'project/config', 'project/ops',
];

// Not schema files: the service and the heavy (in the protocol clone - only the scripts and the root, the rest by one line in areas).
const SKIP_DIRS = ['node_modules', '.git', '.cache', '__pycache__', 'graphs', 'temp', '.ledger', 'agents-plugin'];
const SKIP_GLOBS = [
  '.forma/protocol/skills/**', '.forma/protocol/templates/**', '.forma/protocol/test/**', '.forma/protocol/docs/**',
  '.forma/protocol/assets/**', '.forma/protocol/.github/**',
  '.claude/skills/*/references/**', '.claude/skills/*/assets/**', '.claude/skills/*/scripts/**',
  '.forma/dashboard/*.log', '.forma/living/dictionary/**', '.forma/living/migrations/**',
  '.agents/plugins/**', '.agents/skills/**',
];

// Where a link leads when the target is not a schema file but a directory/file outside the composition: prefix -> block.
const AREAS = [
  { prefix: '.devtool/features', block: 'board' },
  { prefix: '.devtool', block: 'board' },
  { prefix: '.claude/.ledger', block: 'economy' },
  { prefix: '.agents/.ledger', block: 'economy' },
  { prefix: '.forma/living/graphs', block: 'knowledge' },
  { prefix: 'project/cards', block: 'outputs' },
  { prefix: 'project/goals', block: 'outputs' },
  { prefix: 'project/experience', block: 'knowledge' },
  { prefix: 'project/VARS', block: 'rules' },
  { prefix: 'project/brief', block: 'outputs' },
  { prefix: '.env', block: 'rules' },
];

// Entrypoints invoked not by a file but by the engine itself or the human: who invokes - from this entry, not from a link.
const ENTRYPOINTS = [
  { glob: 'AGENTS.md', ru: '\u0427\u0438\u0442\u0430\u0435\u0442 \u0434\u0432\u0438\u0436\u043e\u043a \u043f\u0440\u0438 \u0441\u0442\u0430\u0440\u0442\u0435', en: 'Read natively by the engine at start' },
  { glob: '.claude/rules/**', ru: '\u0427\u0438\u0442\u0430\u0435\u0442 Claude Code \u043f\u0440\u0438 \u0441\u0442\u0430\u0440\u0442\u0435', en: 'Read by Claude Code at start' },
  { glob: '.claude/agents/*.md', ru: '\u0410\u0433\u0435\u043d\u0442: \u0432\u044b\u0437\u044b\u0432\u0430\u0435\u0442 \u0433\u043b\u0430\u0432\u043d\u0430\u044f \u0441\u0435\u0441\u0441\u0438\u044f \u0447\u0435\u0440\u0435\u0437 Agent', en: 'Agent: invoked by the main session via Agent' },
  { glob: '.claude/agents/run/*.md', ru: '\u041f\u0440\u043e\u0444\u0438\u043b\u044c Run: \u0432\u044b\u0431\u0438\u0440\u0430\u0435\u0442 Kit', en: 'Run profile: picked by Kit' },
  { glob: '.claude/agents/on-demand/*.md', ru: '\u0427\u0438\u0442\u0430\u0435\u0442 \u0443\u0437\u0435\u043b \u043f\u043e \u0441\u043e\u0431\u044b\u0442\u0438\u044e', en: 'Read by a node at the event' },
  { glob: '.claude/skills/*/SKILL.md', ru: '\u0423\u043c\u0435\u043d\u0438\u0435: \u0432\u044b\u0437\u044b\u0432\u0430\u0435\u0442 \u0443\u0437\u0435\u043b \u0438\u043b\u0438 \u0447\u0435\u043b\u043e\u0432\u0435\u043a', en: 'Skill: invoked by a node or the human' },
  { glob: '**/*.test.cjs', ru: 'node --test', en: 'node --test' },
  { glob: '**/test-*.cjs', ru: '\u0417\u0430\u043f\u0443\u0441\u043a\u0430\u0435\u0442 \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0430 \u0438\u043b\u0438 node --test', en: 'Run by a check or node --test' },
  { glob: '.forma/dashboard/web/**', ru: '\u0421\u0442\u0440\u0430\u043d\u0438\u0446\u0430 \u0434\u0430\u0448\u0431\u043e\u0440\u0434\u0430 \u0432 \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0435', en: 'Dashboard page in the browser' },
  { glob: '.forma/dashboard/index.html', ru: '\u0421\u0442\u0440\u0430\u043d\u0438\u0446\u0430 \u0434\u0430\u0448\u0431\u043e\u0440\u0434\u0430 \u0432 \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0435', en: 'Dashboard page in the browser' },
  { glob: '.forma/manual/**', ru: '\u0427\u0438\u0442\u0430\u0435\u0442 \u0447\u0435\u043b\u043e\u0432\u0435\u043a', en: 'Read by the human' },
];

module.exports = { LINK_TYPES, BLOCKS, RULES, ROOTS, SKIP_DIRS, SKIP_GLOBS, AREAS, ENTRYPOINTS };
