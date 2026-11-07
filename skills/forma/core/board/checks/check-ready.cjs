'use strict';

// Судья готовности карточки (гейты критерия, досье фактов, записанные исключения) как проверка доски:
// гоняет самопроверку .forma/board/check-ready-sandbox.cjs — честный прогон карточки песочницы плюс
// пробы подмены: сломанный гейт не даёт зелёного (код 1), исключение в History, назвавшее гейт,
// пропускает его с явной пометкой (код 0), исключение без адреса — fail-closed, ошибки исполнения — код 2.
// Тем самым конвенция «гейт + вердикт» держится машинно — общий прогон check-board / sync-engines --check.

const { runTestFile } = require('../../dashboard/lib/checks.cjs');

const SCRIPT = '.forma/board/check-ready-sandbox.cjs';

function run({ root }) {
  const failure = runTestFile(root, SCRIPT);
  return failure ? [failure + ' (check-ready: самопроверка судьи готовности — песочница + пробы подмены)'] : [];
}

module.exports = { id: 'check-ready', since: null, run };
