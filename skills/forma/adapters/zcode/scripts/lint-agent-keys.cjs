#!/usr/bin/env node
'use strict';

/**
 * lint-agent-keys.cjs — линт ключей frontmatter файлов агентов зоны: закрытый список, опечатка — ошибка.
 *
 *   node .zcode/scripts/lint-agent-keys.cjs [каталог]
 *
 * Каталог по умолчанию — агенты этой зоны, рекурсивно (корень, run/, on-demand/). Ключи frontmatter
 * сверяются с закрытым списком, сверенным с реальными файлами зоны: name, description, model, effort,
 * tier, uses, tools. Неизвестный (в том числе опечатанный) ключ — ошибка с адресом файла и именем
 * ключа, выход 1, не молчание. Файл без блока frontmatter — тоже ошибка: молча пропустить его значит
 * оставить ту же дыру на fail-open. Чистый набор — выход 0.
 *
 * Выход: 0 — нарушений нет (печатаётся число просмотренных файлов); 1 — по строке на каждое нарушение;
 * 2 — каталог не найден.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

/** Закрытый список ключей. Расширяется только правкой этой константы — вместе со сверкой
 *  по реальным файлам зоны; добавление «на всякий случай» списком не становится. */
const KEYS = ['name', 'description', 'model', 'effort', 'tier', 'uses', 'tools'];
const ALLOWED = new Set(KEYS);

const KEY_LINE_RE = /^([A-Za-z][A-Za-z0-9_-]*):/;
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

/** Все .md каталога, рекурсивно, в стабильном порядке: [{ file, rel }]. */
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

/** Ошибки одного файла: каждая называет адрес и имя ключа. */
function lintText(rel, text) {
  const m = FRONTMATTER_RE.exec(text);
  if (!m) return [`${rel}: нет блока frontmatter — ключи не проверить, молчаливый пропуск недопустим`];
  const bad = [];
  for (const line of m[1].split(/\r?\n/)) {
    const km = KEY_LINE_RE.exec(line);
    if (km && !ALLOWED.has(km[1])) bad.push(`${rel}: неизвестный ключ «${km[1]}» — вне закрытого списка (${KEYS.join(', ')})`);
  }
  return bad;
}

const dir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, '.zcode', 'agents');
if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
  console.error(`lint-agent-keys: каталог не найден: ${dir}`);
  process.exit(2);
}
const files = listMd(dir);
const problems = files.flatMap(({ file, rel }) => lintText(rel, fs.readFileSync(file, 'utf8')));
for (const p of problems) console.error(p);
if (problems.length) process.exit(1);
console.log(`lint-agent-keys: ${files.length} файлов, ключи в норме (закрытый список: ${KEYS.join(', ')})`);
