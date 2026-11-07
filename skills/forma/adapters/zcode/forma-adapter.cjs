'use strict';

/**
 * Адаптер ZCode для ядра «Формы».
 * Ядро находит его само — файл `forma-adapter.cjs` в каталоге корня, чьё имя начинается с точки;
 * форма объекта и замена отсутствующего поля — в шапке `.forma/dashboard/lib/engines.cjs`.
 * Факты движка — `.zcode/rules/zcode-8.md`; соответствие форме проверяет `.zcode/tests/test-zcode-adapter.cjs`.
 *
 * Что знает только этот движок:
 *  - transcriptsDir/parseUsage: стенограммы модель-IO пишет сам хост — ~/.zcode/cli/rollout,
 *    `model-io-sess_<id>.jsonl`, шаг несёт `usage: { inputTokens, outputTokens, totalTokens,
 *    cacheReadTokens, cacheWriteTokens }` или провайдерские `input_tokens/output_tokens/
 *    cache_read_input_tokens`
 *  - skillsDir `.agents/skills/` — ZCode нативно открывает их как проектные умения
 *  - nodeModels: семейство GLM (Z.AI), уровни размышления low/high/max (среднего нет)
 *  - узлы Формы не зарегистрированы типами агента хоста — маршрут идёт деградированным,
 *    стадии в одном контексте под метками [STAGE] (`.zcode/rules/zcode-8.md`, Contract 2)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

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
  const cyrillicChars = (text.match(/[Ѐ-ӿ]/g) || []).length;
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
    note: 'Оценка по эвристике «байт на токен» для семейства GLM.',
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
 * Шаг стенограммы модель-IO ZCode: usage в шаге плоско или под `usage`.
 * Поля хоста: inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens;
 * провайдерские: input_tokens, output_tokens, cache_read_input_tokens; принимаем и родовые имена.
 * Поля хоста — ВКЛЮЧАЮЩИЕ: inputTokens несёт весь ввод, cacheReadTokens и cacheWriteTokens внутри
 * него (факт rollout: inputTokens + outputTokens = totalTokens), поэтому «прочий ввод» =
 * inputTokens минус кэш. Провайдерские имена — исключающие, как у Claude: ввод без кэша.
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
    // Канонический tokens_in — ввод БЕЗ кэша (N = in + write + read + out сходится в totalTokens);
    // кэш идёт отдельными полями. Чего источник не дал — null, не 0.
    tokens_in: inputOther,
    tokens_out: pick(['output', 'tokens_out', 'output_tokens', 'outputTokens', 'candidatesTokenCount', 'completion_tokens']),
    cache_read: cacheRead,
    cache_write: cacheCreation,
  };
}

/**
 * Стенограмма захода субагента по id: хост кладёт её в rollout рядом с сессиями — плоский файл
 * `model-io-sess_subagent_agent_<id>.jsonl` (id хоста может приходить с префиксом `agent_` — принимаются обе формы).
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
 * Шаг стенограммы ZCode (type model_io): usage в `response.usage` (поля хоста), requestId и время на шаге.
 * Шаг без расхода — `null`.
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
 * Журналы ОСНОВНОЙ сессии: плоские файлы `model-io-sess_<id>.jsonl` в rollout, по записи на файл
 * `{ id, file }` (id — имя файла без .jsonl). Субагентские (`sess_subagent_*`) и запись без сессии
 * (`model-io-no-session.jsonl`) сюда не входят: расход субагентов пишет вызывающий по `<usage>`,
 * второй счёт дал бы двойной. Каталога нет — пустой список: журналов нет, это не ноль.
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
 * Одна запись журнала основной сессии ZCode → нормализованный шаг
 * `{ ts, key, usage, toolCalls, human, model }`:
 *   ts — время (completedAt, иначе startedAt); key — requestId (попытки повтора одного вызова
 *   сходятся); usage — `response.usage` (разбор — parseUsage), без расхода — null;
 *   toolCalls — вызовы инструментов ответа; model — modelId.
 *   human — РЕПЛИКА ЧЕЛОВЕКА в этом журнале не записана (файл несёт только вызовы модели):
 *   границей хода служит новый `turnId` — хост открывает его на сообщение человека (ответ на
 *   AskUserQuestion ход не открывает; компакт и первая запись файла — свои границы).
 *   `prev` — предыдущая строка журнала (нужна для сравнения turnId).
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
    hooks: [], // проектного пакета хуков у ZCode нет — расхождение, см. zcode-8.md (Contract 6)
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

  // Контракт движка (ENGINE-CONTRACT.md): источники, возможности, таблица узел -> модель, зоны записи.
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

  // Группа дерева «Структура» и подписи каталогов адаптера.
  structure: {
    key: 'model',
    title: 'Модель · ZCode',
    note: 'адаптер движка ZCode — §8',
    roots: ['.zcode'],
    notes: {
      '.zcode': 'всё, что знает только ZCode',
      '.zcode/agents': 'роли узлов: Intent, Spec, Kit, Run, Core (зеркало из .claude/agents)',
      '.zcode/agents/on-demand': 'роли, подгружаемые по случаю',
      '.zcode/rules': '§8 — архитектура движка в ZCode',
      '.zcode/scripts': 'скрипты адаптера: генератор зеркала ролей',
      '.zcode/tests': 'тест соответствия контракту',
      '.zcode/.state': 'проба возможностей: доказуемые факты хоста',
    },
  },
};
