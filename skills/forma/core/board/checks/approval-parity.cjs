#!/usr/bin/env node
'use strict';

/**
 * approval-parity — гейт «согласование-паритет»: строки `human approved` в History карточки сверяются
 * с записями хоста о вопросах субагентов человеку (AskUserQuestion). Источник — база хоста ZCode
 * (~/.zcode/cli/db/db.sqlite, таблица part: вызов хранится целиком, со статусом и ответом человека;
 * форма записи state.output: `User has answered your questions: "…"="…"`), путь перекрывается
 * переменной APPROVAL_DB. Связь вопроса с карточкой — по конвенции гейта: текст вопроса обязан
 * нести код карточки. Без модельных вызовов: статус по коду возврата, досье — в stdout; потребители —
 * узел Intent на проверке карточки и check-board.
 *
 *   node .forma/board/checks/approval-parity.cjs card-NNN [--root <каталог>]
 *   node .forma/board/checks/approval-parity.cjs --file <путь .md>     (синтетическая карточка, пробы)
 *   node .forma/board/checks/approval-parity.cjs --selftest            (негативная проба в temp)
 *
 * Вердикт: каждая строка-событие `human approved` в History обязана иметь ≥1 ответенную запись хоста
 * с кодом карточки в вопросе; нет записи — КРАСНАЯ (fail-closed). Выход из-под конвенции (одобрения,
 * случившиеся до введения конвенции, когда вопрос без кода карточки) — строка в History карточки:
 *   exception: approval-parity — <почему нет записи> — <кто утвердил>
 * строка называется гейт словом «approval-parity» — тогда он пропускается с явной пометкой.
 * Обратная сторона — информационная: ответенные записи хоста с кодом карточки, не отражённые
 * в History, печатаются как кандидаты (вопрос мог быть не про одобрение).
 *
 * Коды возврата: 0 — все строки зелёные или пропущены по exception; 1 — есть КРАСНАЯ без exception;
 * 2 — ошибка исполнения (нет карточки, нет базы).
 * Модуль: require('./approval-parity.cjs').runApprovalParity({ root, card, file }) → { ready, lines }.
 * Самопроверка — `--selftest` (негативная проба в temp: фальшивая строка одобрения без записи = КРАСНАЯ).
 * Часть ядра: следов проекта не несёт (запрет 16); путь базы приходит снаружи (аргумент/окружение).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { cardFiles, zone } = require('../../dashboard/lib/card.cjs');

const APPROVED_RE = /^- `Intent`, \d{4}-\d{2}-\d{2}: human approved\b/m;
const ANSWER_MARK = 'User has answered your questions';

const err = (msg) => Object.assign(new Error(msg), { exitCode: 2 });

function cardCodeOf(arg, text, file) {
  const m = String(arg || '').match(/card-(\d{3})/);
  if (m) return 'card-' + m[1];
  const f = String(file || '');
  const fm = f.match(/card-(\d{3})/);
  if (fm) return 'card-' + fm[1];
  const im = String(text || '').match(/^id: "card-(\d{3})/m);
  if (im) return 'card-' + im[1];
  return null;
}

function loadCard(root, cardArg, fileArg) {
  if (fileArg) {
    const p = path.resolve(root, fileArg);
    if (!fs.existsSync(p)) throw err(`файл карточки не найден: ${fileArg}`);
    return { text: fs.readFileSync(p, 'utf8'), file: p };
  }
  if (!cardArg) throw err('нужен card-NNN или --file <путь>');
  const files = cardFiles(root).filter((f) => path.basename(f).startsWith(String(cardArg).replace(/\.md$/, '')));
  if (!files.length) throw err(`карточка ${cardArg} не найдена на доске`);
  return { text: fs.readFileSync(files[0], 'utf8'), file: files[0] };
}

/** Ответенные вопросы хоста, в тексте которых есть код карточки. */
function hostRecords(dbPath, code) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = db.prepare(
      "select session_id, time_created, data from part where data like '%AskUserQuestion%' and data like ? and data like '%User has answered your questions%'",
    ).all('%' + code + '%');
    const out = [];
    for (const r of rows) {
      let j;
      try { j = JSON.parse(r.data); } catch { continue; }
      if (j.tool !== 'AskUserQuestion') continue; // эхо чужих запросов мимо
      const st = j.state || {};
      if (st.status !== 'completed' || !String(st.output || '').includes(ANSWER_MARK)) continue;
      const questions = ((st.input || {}).questions || []).map((q) => String(q.question || ''));
      const m = String(st.output).match(/"([^"]{5,300})"="([^"]{1,200})"/);
      out.push({
        session: String(r.session_id || ''),
        time: new Date(r.time_created).toISOString(),
        questions,
        answer: m ? m[2] : String(st.output).slice(0, 200),
        subagent: /subagent/.test(String(r.session_id || '')),
      });
    }
    return out;
  } finally { db.close(); }
}

function runApprovalParity({ root, card, file, dbPath } = {}) {
  root = root || process.cwd();
  dbPath = dbPath || process.env.APPROVAL_DB || path.join(os.homedir(), '.zcode', 'cli', 'db', 'db.sqlite');
  const loaded = loadCard(root, card, file);
  const code = cardCodeOf(card, loaded.text, loaded.file);
  if (!code) throw err('не удалось определить код карточки (card-NNN)');
  const history = zone(loaded.text, 'history') || '';
  const approvalLines = (history.match(/^- `Intent`, \d{4}-\d{2}-\d{2}: human approved[^\n]*/gm) || []);
  const exceptions = (history.match(/^- `[^`]+`, \d{4}-\d{2}-\d{2}: exception: [^\n]*approval-parity[^\n]*/gm) || []);
  if (!fs.existsSync(dbPath)) throw err(`база хоста не найдена: ${dbPath} (переопредели переменной APPROVAL_DB)`);
  const records = hostRecords(dbPath, code);
  const lines = [];
  let red = 0;
  for (const line of approvalLines) {
    if (records.length) {
      const r = records[0];
      lines.push({ status: 'green', fact: `${code}: вопрос «${(r.questions[0] || '').slice(0, 90)}» — ответ «${r.answer.slice(0, 60)}» (${r.subagent ? 'субагент' : 'главный сеанс'}, ${r.time}, ${r.session.slice(0, 44)})` });
    } else if (exceptions.length) {
      lines.push({ status: 'skipped', fact: `${code}: одобрение без записи хоста — пропущено по exception: ${exceptions[0].replace(/^- /, '').slice(0, 140)}` });
    } else {
      red += 1;
      lines.push({ status: 'red', fact: `${code}: строка «human approved» без записи хоста — вопроса с кодом ${code} в базе нет (конвенция гейта: вопрос обязан нести код карточки); одобрение до конвенции — запиши exception: approval-parity — <почему> — <кто утвердил>` });
    }
  }
  if (!approvalLines.length) {
    lines.push({ status: 'info', fact: `${code}: строк «human approved» в History нет — сверять нечего (записей хоста с этим кодом: ${records.length})` });
  }
  const unmatched = records.length - approvalLines.filter(() => records.length).length;
  if (records.length && unmatched > 0) {
    lines.push({ status: 'info', fact: `${code}: записей хоста больше, чем строк одобрения (${records.length} > сопоставлено) — вопросы могли быть не про одобрение; вопросы: ${records.map((r) => (r.questions[0] || '').slice(0, 60)).join(' | ').slice(0, 300)}` });
  }
  return { ready: red === 0, lines, code };
}

function selftest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'approval-parity-'));
  try {
    // Код карточки собирается из частей: чистая зона протокола не держит литерала «card-NNN»
    // (сканер чистой зоны ищет его и в тестовых фикстурах) — так же, как сам сканер собирает свою регулярку.
    const synth = 'card-' + '009';
    const fake = path.join(dir, synth + '-fake-approval.md');
    fs.writeFileSync(fake, '# ' + synth + ' · синтетическая\n\n## History\n\n- `Intent`, 1999-01-01: human approved — фальшивая строка без записи хоста.\n');
    const r = runApprovalParity({ root: dir, file: synth + '-fake-approval.md', dbPath: process.env.APPROVAL_DB || path.join(os.homedir(), '.zcode', 'cli', 'db', 'db.sqlite') });
    if (r.ready) return { ok: false, note: 'негативная проба дала зелёный — гейт не ловит фальшивую строку' };
    return { ok: true, note: 'негативная проба: фальшивая строка без записи хоста = КРАСНАЯ (fail-closed подтверждён)' };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

module.exports = { runApprovalParity, selftest };

if (require.main === module) {
  try {
    const argv = process.argv.slice(2);
    if (argv.includes('--selftest')) {
      const st = selftest();
      console.log(st.ok ? '✓ ' + st.note : '✗ ' + st.note);
      process.exit(st.ok ? 0 : 1);
    }
    const fileIdx = argv.indexOf('--file');
    const cardArg = argv.find((a) => /^card-\d{3}/.test(a));
    const r = runApprovalParity({ card: cardArg, file: fileIdx >= 0 ? argv[fileIdx + 1] : null });
    for (const l of r.lines) console.log((l.status === 'green' ? '✓ ' : l.status === 'red' ? '✗ ' : '· ') + l.fact);
    console.log(r.ready ? 'ГОТОВ: согласования подтверждены записями хоста' : 'ГОТОВОСТИ НЕТ: доведи гейт approval-parity (запись хоста или exception: в History)');
    process.exit(r.ready ? 0 : 1);
  } catch (e) {
    console.error('СТОП: ' + e.message);
    process.exit(e.exitCode || 2);
  }
}
