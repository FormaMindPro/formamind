'use strict';

// Регрессия маршрута (AGENTS.md §2) как проверка доски: гоняет песочницу .forma/board/route-regression.cjs
// (имитация Spec→Kit→Run + пробы подмены) в общем прогоне check-board / sync-engines --check.
// Тем самым правки AGENTS.md и файлов ролей не остаются без машинной проверки маршрута —
// домохозяйство гоняет этот прогон после каждой такой правки.

const { runTestFile } = require('../../dashboard/lib/checks.cjs');

const SCRIPT = '.forma/board/route-regression.cjs';

function run({ root }) {
  const failure = runTestFile(root, SCRIPT);
  return failure ? [failure + ' (регрессия маршрута: песочница Spec→Kit→Run + пробы подмены)'] : [];
}

module.exports = { id: 'route-regression', since: null, run };
