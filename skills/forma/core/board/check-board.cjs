#!/usr/bin/env node
// Проверка доски .devtool/features/ — часть ядра, одна для всех движков (AGENTS.md §6–7).
// Эпики и цели, метки маршрута и этапы, материалы карточек, строки расхода (§3), закрытие Core.
// Сами проверки — реестр `.forma/board/checks/`: одна проверка — один файл, порядок — в `.forma/board/checks/index.cjs`.
//
//   node .forma/board/check-board.cjs [<card-id>]   — все нарушения доски; с <card-id> — только строки этой карточки.
//   Выход: 0 — нарушений нет, 1 — есть (печатаются по строке, с префиксом «— »).
// Модуль: require('./check-board.cjs').checkBoard(root) → [строки нарушений]. Движок вызывает его
// из своей сверки (sync-engines) и из своего хука записи карточки.

const path = require('path');
const { runChecks } = require('../dashboard/lib/checks.cjs');
const CHECKS = require('./checks/index.cjs');

const ROOT = path.resolve(__dirname, '..', '..');

/** Нарушения доски проекта `root` (по умолчанию — проект, в котором лежит скрипт), в порядке реестра.
 *  `info` — необязательный массив для сведений проверок (не нарушения: «журнал не покрывает», очередь Core). */
function checkBoard(root, info) {
  return runChecks(CHECKS, { root: root ? path.resolve(root) : ROOT, ...(Array.isArray(info) ? { info } : {}) });
}

module.exports = { checkBoard, CHECKS };

if (require.main === module) {
  const id = process.argv[2];
  const info = [];
  const problems = checkBoard(undefined, info).filter((p) => !id || p.includes(id));
  for (const n of info.filter((n) => !id || n.includes(id))) console.log('    · ' + n);
  for (const p of problems) console.log('    — ' + p);
  process.exit(problems.length ? 1 : 0);
}
