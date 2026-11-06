'use strict';

// Среда: Kimi Code. Тест соответствия адаптера контракту экономии гоняет adapter-conformance сам (находит его
// по testsDir адаптера); эта проверка — строение зоны kimi, как codex.cjs для Codex: §8 опирается на AGENTS.md
// и не держит своей копии §1–7, нативные агенты шести ролей и хуки на месте. Находки — сведения (ctx.info),
// не нарушения; проверка ничего не возвращает как нарушение.

const fs = require('fs');
const path = require('path');
const { isDormant } = require('./support/dormant.cjs');
const roots = require('./support/engine-roots.cjs');

const ENGINE_ID = 'kimi';
const AGENT_NAMES = ['intent', 'spec', 'kit', 'run', 'core', 'extractor'];
const HOOK_FILES = ['kimi-ledger.cjs', 'kimi-session-start.cjs'];

/** Пути проверки — из адаптера kimi; адаптера нет, но папка есть — по соглашению. null — среда не подключена. */
function ctxOf(root) {
  const mine = roots.find(root, ENGINE_ID);
  const dir = mine ? mine.dir : '.' + ENGINE_ID;
  if (!fs.existsSync(path.join(root, dir))) return null;
  return {
    id: ENGINE_ID,
    name: 'Kimi Code',
    dir,
    eight: (mine && mine.adapter.engineRulesFile) || `${dir}/rules/kimi-8.md`,
    agentsCode: `${dir}/agents-code`,
    hooks: `${dir}/hooks`,
    skillsDir: (mine && mine.adapter.sources && mine.adapter.sources.skillsDir) || '.agents/skills',
  };
}

/** §8 не подменяет закон и опирается на AGENTS.md — тот же контракт, что у codex.cjs. */
function eightProblems(root, c) {
  const abs = path.join(root, c.eight);
  if (!fs.existsSync(abs)) return [`${c.eight}: нет §8 этой среды — роли ссылаются в пустоту`];
  const eight = fs.readFileSync(abs, 'utf8');
  const problems = (eight.match(/^#{1,3}\s*(§?\s*)?[1-7][.\s·]/gm) || [])
    .map((m) => `${c.eight}: похоже на собственную копию раздела закона («${m.trim()}») — §1–7 живут только в AGENTS.md`);
  if (!/AGENTS\.md/.test(eight)) {
    problems.push(`${c.eight}: не ссылается на AGENTS.md — §8 обязан опираться на общий закон, а не стоять сам по себе`);
  }
  return problems;
}

/** Нативно обнаруживаемые агенты шести ролей — то, что extra_agent_dirs подаёт движку (синхронность — тест адаптера). */
function agentsCodeProblems(root, c) {
  return AGENT_NAMES
    .filter((name) => !fs.existsSync(path.join(root, c.agentsCode, `${name}.md`)))
    .map((name) => `${c.agentsCode}/${name}.md: нет нативного агента роли`);
}

function hooksProblems(root, c) {
  return HOOK_FILES
    .filter((f) => !fs.existsSync(path.join(root, c.hooks, f)))
    .map((f) => `${c.hooks}/${f}: нет файла хука`);
}

function run({ root, info }) {
  // Среды нет — проверять нечего: Kimi Code может не использоваться, это норма.
  const c = ctxOf(root);
  if (!c) return [];
  // Спящий режим (`.forma/engines.json`): среда на месте, но не сверяется.
  if (isDormant(root, c.id)) { if (info) info.push(`    · ${c.name}: спящий режим — не сверяется (реестр .forma/engines.json)`); return []; }
  const notes = [...eightProblems(root, c), ...agentsCodeProblems(root, c), ...hooksProblems(root, c)];
  if (!fs.existsSync(path.join(root, c.skillsDir))) notes.push(`${c.skillsDir}: нет общего каталога умений (Kimi Code открывает его нативно)`);
  if (info) info.push(...notes.map((l) => `    · ${c.name} (сведение, не нарушение): ` + l));
  return [];
}

module.exports = { id: ENGINE_ID, since: null, run };
