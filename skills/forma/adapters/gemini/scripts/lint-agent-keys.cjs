#!/usr/bin/env node
'use strict';

/**
 * lint-agent-keys.cjs — линт ключей frontmatter файлов агентов зоны Gemini (.agents):
 * закрытый список по факту зоны, опечатка — ошибка с адресом и именем ключа (exit 1).
 *
 *   node .agents/scripts/lint-agent-keys.cjs [каталог]
 *
 * Каталог по умолчанию — агенты зоны Gemini (.agents/plugins/forma/agents, рекурсивно).
 * Ключи frontmatter сверяются с закрытым списком, сверенным по реальным файлам зоны:
 * name, description, model, effort, tier, uses, tools, skills, omitClaudeMd.
 * Неизвестный (опечатанный) ключ — ошибка с адресом файла и именем ключа, выход 1, не молчание.
 * Файл агента без блока frontmatter — ошибка (fail-closed, молчаливый пропуск недопустим).
 * Файлы слоя on-demand (инструкции по требованию без фронтматтера) пропускаются.
 * Чистый набор — выход 0.
 *
 * Выход:
 *   0 — нарушений нет (число проверенных файлов);
 *   1 — найдены ошибки (по строке на каждое нарушение);
 *   2 — каталог не найден.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

/** Закрытый список ключей зоны Gemini, зафиксированный по факту зоны. */
const KEYS = [
  'name',
  'description',
  'model',
  'effort',
  'tier',
  'uses',
  'tools',
  'skills',
  'omitClaudeMd',
];
const ALLOWED = new Set(KEYS);

const KEY_LINE_RE = /^([A-Za-z][A-Za-z0-9_-]*):/;
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;
const ON_DEMAND_RE = /(?:^|[\\/])on-demand(?:[\\/]|$)/;

/** Все .md файлы каталога, рекурсивно, в стабильном порядке: [{ file, rel }]. */
function listMd(dir, base = '') {
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listMd(path.join(dir, e.name), rel));
    else if (e.isFile() && e.name.endsWith('.md')) out.push({ file: path.join(dir, e.name), rel });
  }
  return out;
}

/** Ошибки одного файла: адрес и имя ключа. */
function lintText(rel, text) {
  const m = FRONTMATTER_RE.exec(text);
  if (!m) {
    if (ON_DEMAND_RE.test(rel)) return [];
    return [`${rel}: нет блока frontmatter — ключи не проверить, молчаливый пропуск недопустим`];
  }
  const bad = [];
  for (const line of m[1].split(/\r?\n/)) {
    const km = KEY_LINE_RE.exec(line);
    if (km && !ALLOWED.has(km[1])) {
      bad.push(`${rel}: неизвестный ключ «${km[1]}» — вне закрытого списка (${KEYS.join(', ')})`);
    }
  }
  return bad;
}

function lintDir(targetDir) {
  const files = listMd(targetDir);
  const problems = files.flatMap(({ file, rel }) => lintText(rel, fs.readFileSync(file, 'utf8')));
  return { files, problems };
}

module.exports = { KEYS, ALLOWED, listMd, lintText, lintDir };

if (require.main === module) {
  const dir = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(ROOT, '.agents', 'plugins', 'forma', 'agents');

  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    console.error(`lint-agent-keys: каталог не найден: ${dir}`);
    process.exit(2);
  }

  const { files, problems } = lintDir(dir);
  for (const p of problems) console.error(p);
  if (problems.length) process.exit(1);

  console.log(`lint-agent-keys: ${files.length} файлов, ключи в норме (закрытый список: ${KEYS.join(', ')})`);
}
