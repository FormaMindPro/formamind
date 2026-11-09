// Minimal fixture damage for every check of both registries (the engine sync and the board).
// One case: { name, registry, id, apply(m), expect, combine?, args? }
//   registry - 'board' (board/check-board.cjs) or 'sync' (.claude/scripts/sync-engines.cjs --check);
//   id       - the id of the check that must catch the damage (equals its file's name);
//   apply(m) - the damage through a mutator (see mutate.cjs), rolled back as a whole;
//   expect   - a RegExp over the check's findings; expectInfo - over its info lines (checks with no findings);
//   combine  - false when the case is incompatible with the others in the shared run (included by default);
//   args     - sync-engines arguments for the text output (--check by default).
// The spend line dates - 2031: later than the since-day of any rule in the fixture (checks.json - 2030-01-01).
//
// The expected finding texts are the checks' ru runtime output: looked up from the core dictionary by the
// English key (fixed ru), not pinned as copies. The Russian strings apply() writes into the fixture (card
// text, probe files) are data - byte-identical from ASCII source through unicode escapes.

const CARD_1 = '.devtool/features/card-001-nastroit-sborku-primera.md';
const CARD_2 = '.devtool/features/card-002-vopros-po-primeru.md';
const CARD_3 = '.devtool/features/done/card-003-zakrytaya-osnastka.md';
const ID = '`a1b2c3d4e5f60718`';

// ru dictionary data of the core: regex sources from the ru templates (the checks print fixed ru).
const RU = require('../../skills/forma/core/i18n/messages/ru.json');
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ruSrc = (code, parts = {}) => String(RU[code]).split(/\{(\w+)\}/)
  .map((s, i) => (i % 2) ? (parts[s] || '[\\s\\S]*?') : escRe(s)).join('');
const ruRe = (code, parts) => new RegExp(ruSrc(code, parts));
// Russian data written into the fixture by apply (ASCII source, byte-identical values).
const DATA = {
  foreign: '\u0427\u0443\u0436\u043e\u0439',
  orphan: '\u0441\u0438\u0440\u043e\u0442\u0430',
  ruSpend: '\u0437\u0430\u0445\u043e\u0434, 100 \u0442\u043e\u043a\u0435\u043d\u043e\u0432 (10 \u043a\u044d\u0448-\u0447\u0442\u0435\u043d\u0438\u0435)',
  ruSec: '\u0441',
  probe: '\u043f\u0440\u043e\u0431\u0430.',
  noEngineTag: '\u0431\u0435\u0437 \u043c\u0435\u0442\u043a\u0438 \u0434\u0432\u0438\u0436\u043a\u0430.',
  manyTokens: '\u043c\u043d\u043e\u0433\u043e \u0442\u043e\u043a\u0435\u043d\u043e\u0432.',
  brokenOnPurpose: '\u0441\u043b\u043e\u043c\u0430\u043d \u043d\u0430\u0440\u043e\u0447\u043d\u043e',
  stub: '\u0437\u0430\u0433\u043b\u0443\u0448\u043a\u0430',
  copyEdit: '\u043f\u0440\u0430\u0432\u043a\u0430 \u0432 \u043a\u043e\u043f\u0438\u0438',
  see: '\u0441\u043c.',
  otherRole: '\u0434\u0440\u0443\u0433\u0430\u044f \u0440\u043e\u043b\u044c',
  runsIn: '\u0417\u0430\u043f\u0443\u0441\u043a\u0430\u0435\u0442\u0441\u044f \u0432',
  // Finding texts whose producers are outside the board checks (the engine-sync side, still holding the
  // strings literally): regex fragments from the same bytes.
  coreMissing: '\u044f\u0434\u0440\u043e: \u043d\u0435\u0442',
  engineBound: '\u043f\u0440\u0438\u0432\u044f\u0437\u0430\u043d \u043a \u0434\u0432\u0438\u0436\u043a\u0443 \u2014 \u00ab',
  testFailed: '\u0442\u0435\u0441\u0442 \u043d\u0435 \u043f\u0440\u043e\u0448\u0451\u043b \\(\u043a\u043e\u0434 ',
  noRuCopy: '\u043d\u0435\u0442 \u0440\u0443\u0441\u0441\u043a\u043e\u0439 \u043a\u043e\u043f\u0438\u0438 \u0432 ',
  noSubagent: '\u043d\u0435\u0442 \u043e\u043f\u0440\u0435\u0434\u0435\u043b\u0435\u043d\u0438\u044f \u0441\u0443\u0431\u0430\u0433\u0435\u043d\u0442\u0430'
};

// Append a line to the end of the card's "Result" history zone.
const history = (line) => (text) => text.replace('\n\n## Result', `\n${line}\n\n## Result`);

const CASES = [
  // --- the board (the core) ---
  { name: 'epics', registry: 'board', id: 'epics',
    apply: (m) => m.edit(CARD_2, (t) => t.replace(/^epic:.*$/m, `epic: "99. ${DATA.foreign}"`)),
    expect: ruRe('board.epics.epic_unknown', { name: 'card-002-vopros-po-primeru\\.md', epic: '99\\. ' + DATA.foreign }) },
  { name: 'route-labels', registry: 'board', id: 'route-labels',
    apply: (m) => m.edit(CARD_1, (t) => t.replace('"route-4"]', '"route-4", "route-9"]')),
    expect: ruRe('board.route-labels.no_route', { l: 'route-9' }) },
  { name: 'route-stage', registry: 'board', id: 'route-stage',
    apply: (m) => m.edit(CARD_1, (t) => t.replace(/^- `Intent`, 2031-01-01: route route-4.*\n/m, '')),
    expect: ruRe('board.route-stage.no_reason', { f: 'card-001-nastroit-sborku-primera\\.md' }) },
  { name: 'route-executor', registry: 'board', id: 'route-executor',
    apply: (m) => m.edit(CARD_1, (t) => t.replace('"route-4"]', '"route-7"]')),
    expect: ruRe('board.route-executor.no_attempt', { f: 'card-001-nastroit-sborku-primera\\.md', route: 'route-7' }) },
  { name: 'status-values', registry: 'board', id: 'status-values',
    apply: (m) => m.edit(CARD_1, (t) => t.replace(/^status:.*$/m, 'status: "in_progress"')),
    expect: ruRe('board.status-values.not_allowed', { status: 'in_progress', values: 'backlog\\/todo\\/in-progress\\/review\\/done' }) },
  { name: 'card-materials', registry: 'board', id: 'card-materials',
    apply: (m) => m.write('project/cards/card-099/note.md', DATA.orphan + '\n'),
    expect: ruRe('board.card-materials.no_card', { entry: 'card-099' }) },
  { name: 'spend-language', registry: 'board', id: 'spend-language',
    apply: (m) => m.edit(CARD_1, history(`- \`Kit\`, 2031-01-05: ${DATA.ruSpend}, 5 ${DATA.ruSec}, ${ID} — claude-code: ${DATA.probe}`)),
    expect: ruRe('board.spend-language.header', { n: '1' }) },
  { name: 'core-closing', registry: 'board', id: 'core-closing',
    apply: (m) => m.edit(CARD_3, (t) => t.replace('assignee: null', 'assignee: "Core"')),
    expect: null, expectInfo: ruRe('board.core-closing.queue', { n: '1' }) },
  { name: 'attempt-parses', registry: 'board', id: 'attempt-parses',
    apply: (m) => m.edit(CARD_1, history('- `Kit`, 2031-01-05: attempt, ' + DATA.manyTokens)),
    expect: ruRe('board.attempt-parses.header', { n: '1' }) },
  { name: 'attempt-format', registry: 'board', id: 'attempt-format',
    apply: (m) => m.edit(CARD_1, history(`- \`Kit\`, 2031-01-05: attempt, 12000 tokens, 40 s, ${ID} — claude-code: ${DATA.probe}`)),
    expect: new RegExp(ruSrc('board.attempt-format.header', { n: '1' }) + '[\\s\\S]*' +
      'card-001-nastroit-sborku-primera\\.md: Kit 2031-01-05 — ' + ruSrc('board.attempt-format.lacks', { lacks: ruSrc('board.attempt-format.lack_cache') })) },
  { name: 'agent-id', registry: 'board', id: 'agent-id',
    apply: (m) => m.edit(CARD_1, history('- `Kit`, 2031-01-05: attempt, 12000 tokens (3000 cache-read), 40 s — claude-code: ' + DATA.probe)),
    expect: ruRe('board.agent-id.header', { n: '1' }) },
  { name: 'engine-tag', registry: 'board', id: 'engine-tag',
    apply: (m) => m.edit(CARD_1, history(`- \`Kit\`, 2031-01-05: attempt, 12000 tokens (3000 cache-read), 40 s, ${ID} — ${DATA.probe.replace(/\.$/, '')} ${DATA.noEngineTag}`)),
    expect: ruRe('board.engine-tag.untagged', { n: '1' }) },
  { name: 'engine-tag-zero', registry: 'board', id: 'engine-tag',
    apply: (m) => m.edit(CARD_1, history('- `Intent`, 2031-01-05: attempt, 0 tokens, 0 s — claude-code: ' + DATA.probe)),
    expect: ruRe('board.engine-tag.zero', { n: '1' }) },

  // --- the engine sync: the core ---
  { name: 'manual-languages', registry: 'sync', id: 'manual-languages',
    apply: (m) => m.remove('.forma/manual/ru/03-protocol/SCHEME.md'),
    expect: new RegExp('\\.forma\\/manual\\/en\\/03-protocol\\/SCHEME\\.md: ' + DATA.noRuCopy + '\\.forma\\/manual\\/ru\\/') },
  { name: 'core-integrity-missing', registry: 'sync', id: 'core-integrity', combine: false,
    apply: (m) => m.remove('.forma/board/DATA-MODEL.md'),
    expect: new RegExp(DATA.coreMissing + ' \\.forma\\/board\\/DATA-MODEL\\.md') },
  { name: 'core-integrity-engine-bound', registry: 'sync', id: 'core-integrity',
    apply: (m) => m.edit('.forma/board/DATA-MODEL.md', (t) => t + '\n' + DATA.runsIn + ' Claude Code.\n'),
    expect: new RegExp('\u044f\u0434\u0440\u043e: \\.forma\\/board\\/DATA-MODEL\\.md ' + DATA.engineBound + 'Claude Code\u00bb') },
  { name: 'core-integrity-economy-test', registry: 'sync', id: 'core-integrity',
    apply: (m) => m.write('.forma/dashboard/economy.test.cjs', `console.error('${DATA.brokenOnPurpose}'); process.exit(1);\n`),
    expect: new RegExp('\u044f\u0434\u0440\u043e: \\.forma\\/dashboard\\/economy\\.test\\.cjs: ' + DATA.testFailed + '1\\) ' + '\u2014 ' + DATA.brokenOnPurpose) },

  // --- the engine sync: the Claude adapter ---
  { name: 'root-rules-section', registry: 'sync', id: 'root-rules',
    apply: (m) => m.edit('AGENTS.md', (t) => t.replace('## 3.', '## Z.')),
    expect: ruRe('root-rules.law_no_section', { section: '## 3\\.' }) },
  { name: 'root-rules-claude-md', registry: 'sync', id: 'root-rules',
    apply: (m) => m.write('CLAUDE.md', '@AGENTS.md\n'),
    expect: ruRe('root-rules.claude_md_abolished') },
  { name: 'engine-impersonal', registry: 'sync', id: 'engine-impersonal',
    apply: (m) => m.write('.forma/dashboard/probe.cjs', '// ' + DATA.see + ' card-007\n'),
    expect: ruRe('clean-zone.project_trace', { rel: '\\.forma\\/dashboard\\/probe\\.cjs', line: '1', found: 'card-007' }) },
  { name: 'claude-delivery-copy', registry: 'sync', id: 'claude-delivery',
    apply: (m) => m.edit('.claude/skills/grilling/SKILL.md', (t) => t + '\n' + DATA.copyEdit + '\n'),
    expect: ruRe('claude-delivery.drift', { skill: 'grilling' }) },
  { name: 'claude-delivery-hook', registry: 'sync', id: 'claude-delivery',
    apply: (m) => m.edit('.claude/hooks/check-card.sh', (t) => t.split('node .forma/board/check-board.cjs').join('node .forma/board/other.cjs')),
    expect: ruRe('claude-delivery.no_board_check') },
  { name: 'adapter-conformance', registry: 'sync', id: 'adapter-conformance',
    apply: (m) => m.write('.claude/scripts/claude-economy.test.cjs', `console.error('${DATA.brokenOnPurpose}'); process.exit(1);\n`),
    expect: new RegExp('\u0430\u0434\u0430\u043f\u0442\u0435\u0440 Claude Code: \\.claude\\/scripts\\/claude-economy\\.test\\.cjs: ' + DATA.testFailed + '1\\) \u2014 ' + DATA.brokenOnPurpose) },
  // Codex woke up (the dormant registry is empty): the sync reads its environment.
  { name: 'codex', registry: 'sync', id: 'codex',
    apply: (m) => { m.write('.forma/engines.json', '{ "dormant": [] }\n'); m.write('.codex/README.md', DATA.stub + '\n'); },
    expect: null, expectInfo: new RegExp('Codex \\(\u0441\u0432\u0435\u0434\u0435\u043d\u0438\u0435, \u043d\u0435 \u043d\u0430\u0440\u0443\u0448\u0435\u043d\u0438\u0435\\): \\.codex\\/agents\\/intent\\.toml: ' + DATA.noSubagent) },
  // Codex asleep (the .forma/engines.json registry): the environment is in place, not synced.
  { name: 'codex-dormant', registry: 'sync', id: 'codex',
    apply: (m) => m.write('.codex/README.md', DATA.stub + '\n'),
    expect: null, expectInfo: ruRe('codex.dormant', { name: 'Codex' }) },
  // Role parity is not a registry check (an info line): the damage shows in the table and in --diff.
  { name: 'role-parity', registry: 'sync', id: null, args: ['--check', '--diff'],
    apply: (m) => m.write('.agents/plugins/forma/agents/core.md', '# ' + DATA.otherRole + '\n'),
    expect: null },
];

module.exports = { CASES, CHECKS_JSON: { 'route-labels': '2030-01-01', 'route-stage': '2030-01-01', 'route-executor': '2030-01-01', 'attempt-format': '2030-01-01',
  'spend-english': '2030-01-01', 'agent-id': '2030-01-01', 'engine-tag': '2030-01-01', 'goal-label': '2030-01-01' } };
