#!/usr/bin/env node
'use strict';

/**
 * budget-stop — гейт смены бюджета попыток (запрет 3, fail-closed): строка смены attempt-бюджета в History
 * карточки обязана (а) нести новое значение — форма `budget N→M`, (б) опираться на строку останова с отчётом
 * в той же карточке; поле бюджета в Задаче обязано совпадать с последней записанной сменой. Молчаливой смены
 * нет: каждое новое значение стоит за записанным остановом. Без модельных вызовов: статус по коду возврата,
 * находки — в stdout; потребители — узел Intent на проверке карточки и при закрытиях.
 *
 *   node .forma/board/checks/budget-stop.cjs --board [--root <каталог>]   (скан доски: живые карточки + done/)
 *   node .forma/board/checks/budget-stop.cjs --selftest                   (приборы во временном каталоге ОС)
 *
 * Конвенция форм (формат строки несёт обязательные данные — по образцу approval-parity):
 *   1. Строка смены бюджета (History): `- `Узел`, ГГГГ-ММ-ДД: budget N→M …` — слово `budget` (или `бюджет`
 *      с падежным окончанием до двух букв), необязательное двоеточие, число N, стрелка `→` или `->`, число M;
 *      пробелы вокруг стрелки допустимы. Форма сама несёт новое значение M. Бюджет-слово обязано быть
 *      смежным со стрелкой-выражением: присутствие слова в строке без смежности форму смены не образует.
 *      Цитатная ограничительность: цитаты («…», "…", `…`) и скобки-иллюстрации после слов поимка/находка/
 *      цитата/цитирую/пример/например вырезаются до поиска — цитата формы в прозе и описание поимки
 *      не есть запись смены; форма вне цитат ловится как прежде (гейт остаётся fail-closed).
 *   2. Строка останова с отчётом (History): описание строки начинается со слова `stop`/`останов` и называет
 *      порог — в строке есть слово `budget`/`бюджет`/`порог`/`threshold`/`попытк`/`attempt` и цифра. Строкой
 *      останова может быть и сама строка смены, если её описание начинается со слова `stop`/`останов`
 *      (совмещённая запись останова и смены). Строка захода (`attempt, …`) и упоминание слова `stop` внутри
 *      описания (например, в имени держателя) остановом не считаются.
 *   3. Поле бюджета в Задаче: четвёртое поле строки задачи `NNN · kind | что доставляет | критерий | БЮДЖЕТ |
 *      куда далее`, число с необязательным словом («2», «3 попытки»).
 *
 * Вердикт: КРАСНАЯ, если (i) у строки смены нет строки останова в той же карточке; (ii) поле бюджета в Задаче
 * ≠ последней записанной смене (последняя по порядку строк Истории); (iii) у карточки со сменами поле бюджета
 * не читается — равенство не доказано. Карточки без строк смены не судятся. Нераспознаваемо механически:
 * молча правленное поле бюджета без строки смены вовсе — нет основания для сравнения; это часть вердикта
 * человека при приёмке. Путь exception (как в approval-parity): строка
 *   `- `Узел`, ГГГГ-ММ-ДД: exception: … budget-stop …`
 * в History этой же карточки — находки карточки пропускаются с явной пометкой; решает человек.
 *
 * Коды возврата: 0 — зелёный; 1 — КРАСНАЯ (смена без останова, поле ≠ смене, поле не читается);
 * 2 — ошибка исполнения (самопроба не сошлась, каталог доски не читается).
 * Модуль: require('./budget-stop.cjs') → { id: 'budget-stop', since: null, run, runBoard, selftest, … } —
 * форма реестра проверок; включение одной строкой в index.cjs — решение принимающего, по умолчанию гейт
 * вызывается явно (--board).
 * Часть ядра: следов проекта не несёт (запрет 16).
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { cardFiles, zone } = require('../../dashboard/lib/card.cjs');

const CHANGE_RE = /(?:\bbudget\b|бюджет[а-яё]{0,2})\s*:?\s*(\d+)\s*(?:→|->)\s*(\d+)/iu;
const QUOTE_RE = /«[^»]*»|"[^"]*"|`[^`]*`/g;
const ILLUSTRATION_RE = /(?:поимк\w*|находк\w*|цитат\w*|цитиру\w*|пример\w*|например)[^\n()«"»]{0,40}?\([^()]*\)/gi;
const STOP_HEAD_RE = /^-\s*`[^`]+`,\s*\d{4}-\d{2}-\d{2}:\s*(?:stop\b|останов)/i;
const STOP_THRESHOLD_RE = /(?:budget|бюджет|порог|threshold|попытк|attempt)/i;
const EXCEPTION_RE = /^-\s*`[^`]+`,\s*\d{4}-\d{2}-\d{2}:\s*exception:[^\n]*budget-stop/i;

const err = (msg) => Object.assign(new Error(msg), { exitCode: 2 });

/**
 * Цитатная ограничительность: цитаты («…», "…", `…`) и скобки-иллюстрации после слов поимка/находка/цитата/
 * цитирую/пример/например вырезаются до поиска формы смены — цитата формы в прозе и описание поимки
 * не есть запись смены. Порядок: цитаты → иллюстрации → цитаты (иллюстрация может нести цитату внутри;
 * вырезание цитат первым открывает смежность маркера со скобкой). Строки останова и exception судятся
 * по исходной строке — вырезание касается только поиска формы смены.
 */
function stripQuoted(line) {
  const q1 = String(line).replace(QUOTE_RE, ' ');
  const q2 = q1.replace(ILLUSTRATION_RE, ' ');
  return q2.replace(QUOTE_RE, ' ');
}

/** Строки-события зоны History карточки; зоны нет — пусто. */
function historyLines(text) {
  const history = zone(text, 'history');
  if (!history) return [];
  return history.split(/\r?\n/).filter((l) => /^\s*-\s/.test(l));
}

/** Строки смены бюджета: совпадение с формой `budget N→M` вне цитат и скобок-иллюстраций; порядок — порядок строк Истории. */
function changesOf(lines) {
  const out = [];
  for (const line of lines) {
    const m = CHANGE_RE.exec(stripQuoted(line));
    if (m) out.push({ line: line.trim(), from: Number(m[1]), to: Number(m[2]) });
  }
  return out;
}

/** Строка останова: описание начинается со слова stop/останов, порог назван (слово + цифра). */
function isStopLine(line) {
  return STOP_HEAD_RE.test(line) && STOP_THRESHOLD_RE.test(line) && /\d/.test(line);
}

/** Путь exception: строка `exception: … budget-stop …` в History этой же карточки. */
function hasException(lines) {
  return lines.some((l) => EXCEPTION_RE.test(l));
}

/** Поле бюджета в Задаче: четвёртое поле первой строки задачи с четырьмя разделителями. */
function taskBudgetOf(text) {
  const task = zone(text, 'task');
  const line = task.split(/\r?\n/).find((l) => (l.match(/\|/g) || []).length >= 4);
  if (!line) return { parsed: null, raw: null };
  const segs = line.split('|');
  const raw = (segs[segs.length - 2] || '').trim();
  const m = raw.match(/(\d+)/);
  return { parsed: m ? Number(m[1]) : null, raw };
}

/** Ядро гейта: скан карточек доски (живые + done/); карточки без смен не судятся. */
function runBoard({ root } = {}) {
  root = root || process.cwd();
  const lines = [];
  let red = 0;
  let cardsScanned = 0;
  let changesSeen = 0;
  for (const file of cardFiles(root)) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    cardsScanned += 1;
    const hLines = historyLines(text);
    const changes = changesOf(hLines);
    if (!changes.length) continue;
    changesSeen += changes.length;
    const code = (path.basename(file).match(/card-\d+/) || [path.basename(file)])[0];
    if (hasException(hLines)) {
      lines.push({
        status: 'skipped',
        fact: `${code}: смены бюджета (${changes.map((c) => `${c.from}→${c.to}`).join(', ')}) пропущены по exception — решает человек`,
      });
      continue;
    }
    const stopOk = hLines.some(isStopLine);
    if (!stopOk) {
      red += 1;
      lines.push({
        status: 'red',
        fact: `${code}: строка смены бюджета (${changes.map((c) => `${c.from}→${c.to}`).join(', ')}) без строки останова с отчётом — запрет 3: бюджет меняется только через останов с отчётом и записью нового значения; форма останова: описание строки Истории начинается со слова stop/останов и называет порог; путь exception — строка exception: … budget-stop … в History этой карточки (решает человек)`,
      });
    }
    const last = changes[changes.length - 1];
    const { parsed, raw } = taskBudgetOf(text);
    if (parsed === null) {
      red += 1;
      lines.push({
        status: 'red',
        fact: `${code}: поле бюджета в Задаче не читается${raw ? ` («${raw}»)` : ' — строки задачи с четырьмя разделителями нет'} — равенство последней записанной смене (${last.from}→${last.to}) не доказано`,
      });
    } else if (parsed !== last.to) {
      red += 1;
      lines.push({
        status: 'red',
        fact: `${code}: поле бюджета в Задаче (${parsed}) ≠ последней записанной смене (${last.from}→${last.to})`,
      });
    } else if (stopOk) {
      lines.push({ status: 'green', fact: `${code}: смена ${last.from}→${last.to} — останов записан, поле бюджета в Задаче совпадает (${parsed})` });
    }
  }
  return { ready: red === 0, lines, cardsScanned, changesSeen, red };
}

// ---- --selftest: приборы во временном каталоге ---------------------------------------------------

/** Карточка-проба: одна строка задачи (поле бюджета подставляется) и набор строк Истории. */
function probeCard(budgetField, histLines) {
  return (
    '# проба\n\n## Task\n901 · tooling | что доставляет проба | критерий пробы | ' +
    budgetField +
    ' | куда далее\n\n## Kit\n\n## History\n' +
    histLines.join('\n') +
    '\n\n## Result\n'
  );
}

function writeProbe(dir, name, text) {
  const p = path.join(dir, '.devtool', 'features', name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
}

function selftest() {
  const base = process.env.FORMA_TEST_TMP && fs.existsSync(process.env.FORMA_TEST_TMP) ? process.env.FORMA_TEST_TMP : os.tmpdir();
  const dir = fs.mkdtempSync(path.join(base, 'budget-stop-'));
  const results = [];
  const check = (name, cond) => results.push({ ok: !!cond, name });
  const today = new Date().toISOString().slice(0, 10);
  const STOP = '- `Spec`, ' + today + ': останов — бюджет 1 из 1 исчерпан, отчёт: правка не встала в критерий, эскалация за новым бюджетом.';
  try {
    // а: смена с остановом и совпадающим полем — ЗЕЛЁНАЯ
    writeProbe(path.join(dir, 'a'), 'probe-901-budget-with-stop.md', probeCard('2', [
      STOP,
      '- `Intent`, ' + today + ': budget 1 → 2 attempts — новый бюджет записан по останову.',
    ]));
    const ra = runBoard({ root: path.join(dir, 'a') });
    check('а: смена с остановом и совпадающим полем = ЗЕЛЁНАЯ', ra.ready && ra.changesSeen === 1 && ra.lines.some((l) => l.status === 'green'));

    // б: смена без останова — КРАСНАЯ (fail-closed)
    writeProbe(path.join(dir, 'b'), 'probe-902-budget-no-stop.md', probeCard('3', [
      '- `Intent`, ' + today + ': budget 2 → 3 attempts — смена записана, останова нет.',
    ]));
    const rb = runBoard({ root: path.join(dir, 'b') });
    check('б: смена без останова = КРАСНАЯ (названо: без строки останова)', !rb.ready && rb.lines.some((l) => l.status === 'red' && l.fact.includes('без строки останова')));

    // в: поле бюджета в Задаче ≠ записанной смене — КРАСНАЯ
    writeProbe(path.join(dir, 'c'), 'probe-903-budget-field-mismatch.md', probeCard('2', [
      STOP,
      '- `Intent`, ' + today + ': budget 2 → 3 attempts — смена по останову, поле не обновлено.',
    ]));
    const rc = runBoard({ root: path.join(dir, 'c') });
    check('в: поле бюджета ≠ записанной смене = КРАСНАЯ (названо ≠)', !rc.ready && rc.lines.some((l) => l.status === 'red' && l.fact.includes('≠')));

    // г: обычные строки Истории (stage exec, attempt, closed, Budget без стрелки, trap «budget-stop» в строке захода) — смен 0, ЗЕЛЁНАЯ
    writeProbe(path.join(dir, 'd'), 'probe-904-budget-ordinary-lines.md', probeCard('2', [
      '- `Kit`, ' + today + ': stage exec — работа по карточке.',
      '- `Kit`, ' + today + ': attempt, 123 tokens (100 cache-read), 10 out, 5 s, `sess-1` — запись расхода (budget-stop probe-999).',
      '- `Intent`, ' + today + ': Budget: второй заход из двух — последняя, без стрелки.',
      '- `Kit`, ' + today + ': Similar: probe-901.',
      '- `Core`, ' + today + ': closed — образ достигнут.',
    ]));
    const rd = runBoard({ root: path.join(dir, 'd') });
    check('г: обычные строки Истории без стрелочных смен = ЗЕЛЁНАЯ, смен 0, ложных срабатываний нет', rd.ready && rd.changesSeen === 0 && rd.lines.length === 0);

    // д: две смены, каждая с остановом, поле = последней смене — ЗЕЛЁНАЯ
    writeProbe(path.join(dir, 'e'), 'probe-905-budget-two-changes.md', probeCard('3', [
      STOP,
      '- `Intent`, ' + today + ': budget 1 → 2 attempts — по останову.',
      '- `Spec`, ' + today + ': останов — бюджет 2 из 2 исчерпан, отчёт: вторая попытка тоже мимо критерия.',
      '- `Intent`, ' + today + ': budget 2 → 3 attempts — по второму останову.',
    ]));
    const re = runBoard({ root: path.join(dir, 'e') });
    check('д: две смены с остановами, поле = последней смене = ЗЕЛЁНАЯ', re.ready && re.changesSeen === 2);

    // е: exception в той же карточке — находка пропущена с явной пометкой
    writeProbe(path.join(dir, 'f'), 'probe-906-budget-exception.md', probeCard('3', [
      '- `Intent`, ' + today + ': budget 2 → 3 attempts — смена без останова.',
      '- `Intent`, ' + today + ': exception: budget-stop — останов был в сеансе, строка не записана — утверждено человеком.',
    ]));
    const rf = runBoard({ root: path.join(dir, 'f') });
    check('е: exception в карточке = пропуск находки с пометкой, код зелёный', rf.ready && rf.lines.some((l) => l.status === 'skipped'));

    // ж (приёмка 2): цитата формы в прозе — НЕ смена
    writeProbe(path.join(dir, 'g'), 'probe-907-budget-quote-in-prose.md', probeCard('2', [
      '- `Intent`, ' + today + ': проверка приёмкой: поимка probe-901 сверена по файлу — строка 38 «budget 2 → 3 attempts», основания в строке есть, строки останова нет.',
    ]));
    const rg = runBoard({ root: path.join(dir, 'g') });
    check('ж: цитата формы «…» в прозе = НЕ смена, ЗЕЛЁНАЯ, смен 0', rg.ready && rg.changesSeen === 0);

    // з (приёмка 2, вариант): форма в кавычках-коде — НЕ смена
    writeProbe(path.join(dir, 'h'), 'probe-908-budget-quote-in-code.md', probeCard('2', [
      '- `Intent`, ' + today + ': строка 38 `budget 2 → 3 attempts` — цитата формы в строке кода.',
    ]));
    const rh = runBoard({ root: path.join(dir, 'h') });
    check('з: цитата формы в кавычках-коде = НЕ смена, ЗЕЛЁНАЯ, смен 0', rh.ready && rh.changesSeen === 0);

    // и (приёмка 3): описание поимки без смежного budget-слова — НЕ смена (строка с budget-stop.cjs в тексте)
    writeProbe(path.join(dir, 'i'), 'probe-909-budget-catch-description.md', probeCard('2', [
      '- `Kit`, ' + today + ': stage exec — budget-stop.cjs собран: --selftest 6 проб зелёные (exit 0), --board живой доски — 1 поимка probe-901 (смена 2→3 без строки останова, exit 1 fail-closed).',
    ]));
    const ri = runBoard({ root: path.join(dir, 'i') });
    check('и: описание поимки (смена 2→3) при budget-слове без смежности = НЕ смена, ЗЕЛЁНАЯ, смен 0', ri.ready && ri.changesSeen === 0);

    // к (приёмка 1, охрана от ослабления): настоящая запись вне цитат остаётся сменой — КРАСНАЯ
    writeProbe(path.join(dir, 'j'), 'probe-910-budget-real-record-quotes-in-reason.md', probeCard('3', [
      '- `Intent`, ' + today + ': budget 2 → 3 attempts — основание «по команде», кавычки только в основании.',
    ]));
    const rj = runBoard({ root: path.join(dir, 'j') });
    check('к: настоящая запись вне цитат (кавычки в основании) = по-прежнему КРАСНАЯ без останова', !rj.ready && rj.lines.some((l) => l.status === 'red' && l.fact.includes('без строки останова')));

    // л (приёмка 3, вариант): форма внутри скобок после слова поимка — НЕ смена
    writeProbe(path.join(dir, 'k'), 'probe-911-budget-paren-after-marker.md', probeCard('2', [
      '- `Kit`, ' + today + ': поимка probe-901 (смена budget 2→3 без останова) — форма внутри скобок-иллюстрации.',
    ]));
    const rk = runBoard({ root: path.join(dir, 'k') });
    check('л: форма внутри скобок после слова поимка = НЕ смена, ЗЕЛЁНАЯ, смен 0', rk.ready && rk.changesSeen === 0);

    const failed = results.filter((r) => !r.ok);
    return {
      ok: failed.length === 0,
      note: failed.length
        ? 'не сошлось: ' + failed.map((r) => r.name).join('; ')
        : 'все 11 проб зелёные: смена с остановом и совпадающим полем ЗЕЛЁНАЯ, без останова КРАСНАЯ, поле ≠ смене КРАСНАЯ, обычные строки без ложных срабатываний, две смены с остановами ЗЕЛЁНАЯ, exception пропускает с пометкой; цитатная ограничительность: цитата формы в прозе и в кавычках-коде НЕ смена, описание поимки НЕ смена, форма в скобках после поимки НЕ смена, настоящая запись вне цитат по-прежнему КРАСНАЯ',
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---- форма реестра проверок ----------------------------------------------------------------------

/** Находки для реестра (`run(ctx)` → строки, пустой список — чисто); регистрация в index.cjs — решение принимающего. */
function run(ctx = {}) {
  const r = runBoard({ root: ctx.root });
  return r.lines.filter((l) => l.status === 'red').map((l) => 'budget-stop: ' + l.fact);
}

module.exports = { id: 'budget-stop', since: null, run, runBoard, selftest, changesOf, taskBudgetOf, isStopLine };

// ---- CLI ----------------------------------------------------------------------------------------

if (require.main === module) {
  const argv = process.argv.slice(2);
  const ri = argv.indexOf('--root');
  const root = ri >= 0 ? path.resolve(argv[ri + 1]) : process.cwd();
  try {
    if (argv.includes('--selftest')) {
      const st = selftest();
      console.log((st.ok ? '✓ ' : '✗ ') + st.note);
      process.exit(st.ok ? 0 : 1);
    }
    const r = runBoard({ root });
    for (const l of r.lines) console.log((l.status === 'green' ? '✓ ' : l.status === 'red' ? '✗ ' : '· ') + l.fact);
    if (!r.lines.length) console.log(`· строк смены бюджета в History не найдено (карточек просмотрено: ${r.cardsScanned})`);
    if (r.ready) console.log(`БЮДЖЕТ-СТОП: ЗЕЛЁНАЯ — смен: ${r.changesSeen} (все с остановом, поле бюджета совпадает), карточек просмотрено: ${r.cardsScanned}`);
    else console.log(`БЮДЖЕТ-СТОП: КРАСНАЯ — находок: ${r.red} (см. строки ✗)`);
    process.exit(r.ready ? 0 : 1);
  } catch (e) {
    console.error('СТОП: ' + e.message);
    process.exit(e.exitCode || 2);
  }
}
