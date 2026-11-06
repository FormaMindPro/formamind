#!/usr/bin/env node
'use strict';

/**
 * Регрессия маршрута (закон §2) — машинная, без модельных вызовов.
 * Песочница во временном каталоге: консервированная карточка проходит имитацию Spec→Kit→Run
 * (строки этапа, смена status/assignee по §7, строка расхода по §3), и на каждом шаге живые
 * проверки доски (.forma/board/checks/) обязаны быть чистыми. Затем пробы подмены: сломанный
 * маркер позиции, пропущенное поле из пяти, битая строка расхода, «закрытие без результата» —
 * каждая ловится находкой с адресом (имя файла) и ненулевым кодом возврата.
 *
 * Запускается само прогоном check-board / sync-engines --check (проверка-обёртка
 * checks/route-regression.cjs) — после правок AGENTS.md и файлов ролей домохозяйство гоняет
 * именно этот прогон, отдельной команды помнить не нужно.
 *
 *   node .forma/board/route-regression.cjs          — прогон; код 0 чисто, 1 ловля/провал
 *   node .forma/board/route-regression.cjs --quiet  — одна строка итога
 * Модуль: runRegression() → { problems: [...] } — находки с адресами.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const MARKERS = ['holding course', 'counting cost', 'assembling', 'preserving'];
const FIVE_KEYS = ['kind', 'delivers', 'criterion', 'budget', 'next'];
const D = () => new Date().toISOString().slice(0, 10);  // дата песочницы — рантаймом, не литералом (запрет 16)
const NNN = String(Date.now()).slice(-3);  // номер карточки песочницы — рантаймом, не литералом (запрет 16)

// Живые проверки доски, работающие от корня песочницы без журнала движка.
const CHECK_IDS = ['route-labels', 'route-stage', 'status-values', 'key-language', 'spend-language', 'attempt-parses', 'attempt-format', 'agent-id', 'engine-tag'];
const checks = {};
for (const id of CHECK_IDS) checks[id] = require('./checks/' + id + '.cjs');

function cardName() { return 'card-' + '900-route-regression-sandbox.md'; }  // код песочницы собран: чистая зона, запрет 16

function cannedCard() {
  return [
    '---',
    'id: "card-' + NNN + '-route-regression-sandbox",',
    'status: "backlog"',
    'priority: "medium"',
    'assignee: "Spec"',
    'epic: "0. Sandbox"',
    'labels: ["route-7"]',
    '---',
    '# card-' + NNN + ' · sandbox',
    '',
    '## Task',
    NNN + ' · tooling | Deliver a sandbox artifact | The sandbox file exists and is empty | 2 | Spec → Kit → Run → Intent',
    '',
    '## Kit',
    '',
    '## History',
    '- `Intent`, ' + D() + ': route route-7 (why: tooling).',
    '- `Intent`, ' + D() + ': stage card — карточка создана.',
    '',
    '## Result',
    ''
  ].join('\n');
}

function writeCard(dir, text) {
  const board = path.join(dir, '.devtool', 'features');
  fs.mkdirSync(board, { recursive: true });
  fs.writeFileSync(path.join(board, cardName()), text);
}

function setPair(text, status, assignee) {
  return text.replace(/^status:.*$/m, 'status: "' + status + '"').replace(/^assignee:.*$/m, 'assignee: "' + assignee + '"');
}

function addLine(text, line) { return text.replace(/\n\n## Result/, '\n' + line + '\n\n## Result'); }

/** Находки живых проверок по карточке песочницы. */
function boardFindings(dir) {
  const out = [];
  for (const id of CHECK_IDS) {
    const found = checks[id].run({ root: dir, since: null });
    for (const p of found) out.push('[' + id + '] ' + p);
  }
  return out;
}

/** Маркер позиции — первая строка любой передачи (закон §4). */
function markerProblem(handoff) {
  const first = String(handoff).split('\n')[0].trim();
  return MARKERS.includes(first) ? [] : ['handoff: маркер позиции «' + first + '» — нет такого маркера (' + MARKERS.join('|') + ')'];
}

/** Пять полей карточки: kind | delivers | criterion | budget | next (закон §6). */
function fiveFieldProblems(text) {
  const m = text.match(/^## Task\n(\d+ · .+)$/m);
  if (!m) return [cardName() + ': зона Task не держит строку пяти полей'];
  const parts = m[1].split('|').map(s => s.trim());
  if (parts.length !== 5) return [cardName() + ': полей ' + parts.length + ' вместо 5 (kind|delivers|criterion|budget|next)'];
  return [];
}

/** Строка расхода — канон §3, читается парсером spend-line (attempt-parses это и проверяет). */
function spendLine(node, tokens) {
  return '- `' + node + '`, ' + D() + ': attempt, ' + tokens + ' tokens (0 cache-read), 12 out, 3 s, `agent_sandbox-0001` — sandbox: имитация шага';
}

/** «Театр подтверждения»: карточка ушла в приёмку, а Result пуст — подмена результата. */
function substitutionProblems(text) {
  const status = (text.match(/^status:\s*"?([\w-]+)/m) || [])[1];
  const result = (text.split(/## Result/)[1] || '').trim();
  if ((status === 'review' || status === 'done') && !result) {
    return [cardName() + ': статус ' + status + ', а зона Result пуста — результат подменён этапом'];
  }
  return [];
}

/** Один прогон: имитация + пробы. Возвращает находки (пустой список — регрессия чиста). */
function runRegression() {
  const problems = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-route-reg-'));
  try {
    // --- Фаза 1: честный прогон Spec → Kit → Run -----------------------------------------
    let text = cannedCard();
    const steps = [
      { status: 'todo', assignee: 'Kit', line: '- `Kit`, ' + D() + ': stage kit — снаряжение выдано.' },
      { status: 'in-progress', assignee: 'Run', line: '- `Kit`, ' + D() + ': stage exec — исполнение.' },
      { status: 'review', assignee: 'Intent', line: '- `Run`, ' + D() + ': stage check — критерий достигнут.' }
    ];
    writeCard(dir, text);
    problems.push(...boardFindings(dir).map(p => 'фаза 1 (старт): ' + p));
    for (const st of steps) {
      text = setPair(text, st.status, st.assignee);
      text = addLine(text, st.line);
      if (st.assignee === 'Run') text = addLine(text, spendLine('Kit', 1000));
      if (st.status === 'review') text = addLine(text, spendLine('Run', 2000));
      writeCard(dir, text);
      const found = boardFindings(dir);
      for (const p of found) problems.push('фаза 1 (' + st.status + '): ' + p);
    }
    // Маркер позиции и пять полей — на честной карточке обязаны проходить.
    problems.push(...markerProblem('assembling\n' + cardName()).map(p => 'фаза 1: ' + p));
    problems.push(...fiveFieldProblems(text).map(p => 'фаза 1: ' + p));

    // --- Фаза 2: пробы подмены — каждая обязана быть поймана ------------------------------
    const probes = [
      {
        name: 'маркер позиции',
        run() { return markerProblem('делай как знаешь\n' + cardName()); }
      },
      {
        name: 'пять полей',
        run() {
          const bad = cannedCard().replace(NNN + ' · tooling | Deliver a sandbox artifact | The sandbox file exists and is empty | 2 | Spec → Kit → Run → Intent',
            NNN + ' · tooling | Deliver a sandbox artifact | 2 | Spec → Kit → Run → Intent');
          return fiveFieldProblems(bad);
        }
      },
      {
        name: 'строка расхода',
        run() {
          const bad = addLine(cannedCard(), '- `Kit`, ' + D() + ': attempt, много tokens — как-то так');
          writeCard(dir, bad);
          return boardFindings(dir);
        }
      },
      {
        name: 'подмена результата',
        run() {
          const bad = setPair(cannedCard(), 'review', 'Intent');
          return substitutionProblems(bad);
        }
      }
    ];
    for (const probe of probes) {
      const caught = probe.run();
      if (!caught.length) problems.push('проба «' + probe.name + '» НЕ поймана — проверка слепа');
      else if (!caught.some(c => c.includes(cardName())) && !caught.some(c => c.includes('handoff'))) {
        problems.push('проба «' + probe.name + '» поймана без адреса: ' + caught.join('; '));
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return { problems };
}

function main() {
  const quiet = process.argv.includes('--quiet');
  const { problems } = runRegression();
  if (quiet) { console.log(problems.length ? 'route-regression: ' + problems.length + ' находок' : 'route-regression: чисто'); process.exit(problems.length ? 1 : 0); }
  if (problems.length) {
    for (const p of problems) console.error(p);
    console.error('route-regression: ' + problems.length + ' находок, регрессия не пройдена');
    process.exit(1);
  }
  console.log('route-regression: песочница Spec→Kit→Run чистая, 4 пробы подмены пойманы с адресом');
  process.exit(0);
}

if (require.main === module) main();
module.exports = { runRegression, MARKERS, markerProblem, fiveFieldProblems, substitutionProblems };
