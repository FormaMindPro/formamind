'use strict';

/**
 * Генератор зеркала ролей Claude → ZCode (`.claude/agents/` → `.zcode/agents/`).
 *
 * Механика — та же, что у зеркал Gemini (`gen-gemini-roles.cjs`) и MiniMax
 * (`.minimax/scripts/gen-roles.cjs`), с двумя отличиями, обусловленными движком:
 *   • тело роли — копия с перестановкой путей на мои; скиллы движок читает из
 *     общих `.agents/skills/` нативно (как Kimi), поэтому переименования туда нет;
 *   • фронтматтер — мой: модель, усилие и инструменты — инженерный выбор движка,
 *     сверка паритета его не сравнивает (`role-parity.cjs` режет `^---...---\n`).
 *
 * Запуск: node .zcode/scripts/gen-roles.cjs [--check]
 *   --check — ничего не пишет, только сообщает расхождения (роль, где тело разошлось).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, '.claude', 'agents');
const DST = path.join(ROOT, '.zcode', 'agents');

/**
 * Перестановки путей в теле роли: моя зона — `.zcode/`, закон — `AGENTS.md`.
 *
 * Пути пишутся полными (`.agents/skills/`, `.zcode/rules/zcode-8.md`), а не «от папки движка»:
 * сверка паритета движков нормализует именно полные пути (по контракту адаптеров), и только они
 * сходятся с эталоном. Папка ролей — исключение: сверка знает и короткую форму (`agents/…`).
 */

/**
 * Имя встроенного исполнителя Plumb — по малой модели зоны, у каждого движка своё
 * (у Gemini — `plumb-gemini`, свой файл). Источник тела один, поэтому карта переименования:
 * файл зеркала, поле `name:` и упоминания в телах ролей. Проводной тег отката jev
 * (`{"fallback":"haiku"}`) и значение `haiku` настройки `plumb` в PROJECT.md не трогаются —
 * это словарь настройки, а не имя агента.
 */
const EXECUTOR_RENAME = { 'plumb-haiku': 'plumb-glmflash' };

const BODY_TRANSFORMS = [
  [/\bplumb-haiku\b/g, EXECUTOR_RENAME['plumb-haiku']],
  [/\.claude\/agents\/on-demand\//g, 'agents/on-demand/'],
  [/\.claude\/agents\/run\//g, 'agents/run/'],
  [/\.claude\/agents\/(?=[,`\s)]|$)/g, 'agents/'],
  [/\.claude\/skills\//g, '.agents/skills/'],
  [/\.claude\/rules\/claude-8\.md/g, '.zcode/rules/zcode-8.md'],
  [/\bclaude-8\.md\b/g, 'zcode-8.md'],
  [/\bCLAUDE\.md\b/g, 'AGENTS.md'],
];

/** Инструменты: имя клона → имя моего рантайма. Порядок важен: длинные первыми. */
const TOOL_MAP = [
  [/mcp__chrome-devtools__[a-z_]+/g, 'mcp_browser'],
  [/\bKillShell\b/g, 'TaskStop'],
  // MCP-сервер site в ZCode не поднят: движок отказывается стартовать агента с недоступным
  // инструментом целиком. Работать с сайтом роля может через Bash(node .claude/scripts/site.cjs *).
  [/mcp__site__mcp-adapter-[a-z-]+/g, ''],
];

/**
 * Правила движка: те, что меняют СМЫСЛ, а не путь.
 *
 * Чужой тег движка в моей зоне — не опечатка, а ошибка счёта: ядро принимает `claude-code:`,
 * и попытка ZCode, написанная по чужому шаблону, уехала бы в счёт Клода молча.
 * Правило одно: тег в зоне — мой.
 */
const FILE_RULES = {
  'on-demand/route-choice.md': [[/claude-code:/g, 'zcode:']],
  'on-demand/spend-line.md': [[/claude-code:/g, 'zcode:']],
};

/**
 * Зоны записи: куда роль кладёт новый файл. Эти места принадлежат движку, поэтому у моей
 * зоны — свои пути. Чтение общих скриптов (`.claude/scripts/*`) остаётся: это зависимость,
 * названная в §8, а не владение.
 */
const WRITE_PATH_RULES = [
  [/project\/extensions\/claude\//g, 'project/extensions/zcode/'],
  [/\.claude\/settings\.local\.json/g, '.zcode/settings.local.json'],
  [/puts it in `\.claude\/scripts\/`/g, 'puts it in `.zcode/scripts/`'],
  [/never to `\.claude\/scripts\/`/g, 'never to `.zcode/scripts/`'],
];

/** Моя модель: рантайм один, различие «узел / усилие» выражено уровнем размышления. */
const MY_MODEL = 'glm-5.3-flash';

/** Усилие по умолчанию и для Run: уровни хоста — low | high | max (среднего нет). */
const MY_EFFORT = 'high';
const RUN_EFFORT = 'low';

function splitFrontmatter(text) {
  const m = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  if (!m) return { fm: null, body: text };
  return { fm: m[0], body: text.slice(m[0].length) };
}

function parseFrontmatter(fm) {
  const out = {};
  if (!fm) return out;
  for (const line of fm.split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i === -1) continue;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim();
    if (k && !k.startsWith('#')) out[k] = v;
  }
  return out;
}

function mapTools(value) {
  if (!value) return value;
  let out = value;
  for (const [re, to] of TOOL_MAP) out = out.replace(re, to);
  // Разные инструменты клона после переименования схлопнулись в одно имя — дубли вычищаем, порядок держим.
  const seen = new Set();
  out = out.split(/,\s*/).filter((t) => {
    if (!t || seen.has(t)) return false;
    seen.add(t);
    return true;
  }).join(', ');
  return out;
}

function myFrontmatter(srcFm, rel) {
  const f = parseFrontmatter(srcFm);
  const isRun = rel === 'run.md' || rel.startsWith('run/');
  const lines = ['---'];
  if (f.name) lines.push(`name: ${EXECUTOR_RENAME[f.name] || f.name}`);
  if (f.description) lines.push(`description: ${f.description}`);
  lines.push(`model: ${MY_MODEL}`);
  if (f.tier) lines.push(`tier: ${f.tier}`);
  lines.push(`effort: ${isRun ? RUN_EFFORT : MY_EFFORT}`);
  if (f.tools) lines.push(`tools: ${mapTools(f.tools)}`);
  if (f.uses) lines.push(`uses: ${f.uses}`);
  lines.push('---');
  return lines.join('\n') + '\n';
}

function transformBody(body, rel) {
  let out = body.replace(/\r\n/g, '\n');
  for (const [re, to] of BODY_TRANSFORMS) out = out.replace(re, to);
  for (const [re, to] of TOOL_MAP) out = out.replace(re, to);
  for (const [re, to] of WRITE_PATH_RULES) out = out.replace(re, to);
  const rules = FILE_RULES[rel.replace(/\\/g, '/')] || [];
  for (const [re, to] of rules) out = out.replace(re, to);
  return out;
}

function listRoleFiles(dir, base = '') {
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listRoleFiles(path.join(dir, e.name), rel));
    else if (e.isFile() && e.name.endsWith('.md')) out.push(rel);
  }
  return out;
}

function generate() {
  const files = listRoleFiles(SRC);
  const written = [];
  const drift = [];
  for (const rel of files) {
    const src = fs.readFileSync(path.join(SRC, ...rel.split('/')), 'utf8');
    const { fm, body } = splitFrontmatter(src);
    const text = myFrontmatter(fm || '', rel) + transformBody(body, rel);
    const stem = rel.replace(/\.md$/, '');
    const dstRel = EXECUTOR_RENAME[stem] ? `${EXECUTOR_RENAME[stem]}.md` : rel;
    const dst = path.join(DST, ...dstRel.split('/'));
    if (fs.existsSync(dst) && fs.readFileSync(dst, 'utf8') === text) continue;
    drift.push(rel);
    if (!process.argv.includes('--check')) {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.writeFileSync(dst, text);
      written.push(rel);
    }
  }
  return { files, written, drift };
}

const { files, written, drift } = generate();
if (process.argv.includes('--check')) {
  if (drift.length) {
    console.error('дрейф зеркала ролей ZCode: ' + drift.join(', '));
    console.error('пересборка: node .zcode/scripts/gen-roles.cjs');
    process.exit(1);
  }
  console.log(`зеркало ролей ZCode синхронно: ${files.length} ролей`);
} else {
  console.log(`зеркало ролей ZCode: источник ${files.length}, записано ${written.length}${written.length ? ': ' + written.join(', ') : ' (уже синхронно)'}`);
}
