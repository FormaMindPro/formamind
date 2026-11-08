#!/usr/bin/env node
'use strict';

/**
 * human-row-trace — гейт видимого следа строки «human» таблицы маршрута (§2, fail-closed): строка останова
 * к человеку в History карточки обязана нести код карты следа — карты эпика протокола, ожидающей решения
 * (статус backlog, флаг ожидания решения; правило human-row-trace, card-and-board.md после §7). Обычная
 * запись остаётся где была; карта следа хранит находку от исчезновения, если её цель закроется раньше.
 * Без модельных вызовов: статус по коду возврата, находки — в stdout; потребители — узел Intent на
 * проверке карточки и check-board.
 *
 *   node .forma/board/checks/human-row-trace.cjs --board [--root <каталог>]   (скан доски: живые карточки + done/)
 *   node .forma/board/checks/human-row-trace.cjs --selftest                   (приборы во временном каталоге ОС)
 *
 * Конвенция (словарь строк останова общий с budget-stop.cjs — его шапка держатель конвенции; регулярки
 * продублированы локально, чтобы чекер стоял сам; обновление словаря — правка обеих шапок):
 *   1. Строка останова (History): описание строки начинается со слова stop/останов (сразу за датой) и
 *      называет порог — в строке есть слово budget/бюджет/порог/threshold/попытк/attempt и цифра.
 *      Строка захода (`attempt, …`) и слово stop внутри описания остановом не считаются. Строка останова
 *      судится по исходной строке — как в budget-stop (гейт fail-closed: останов ловится по всей строке).
 *   2. След: в строке останова назван код карты card-NNN — смежность: код ищется в той же строке, не в
 *      остальной карточке. Цитатная ограничительность (как в budget-stop.cjs): цитаты («…», "…",
 *      `…`) и скобки-иллюстрации после слов поимка/находка/цитата/цитирую/пример/например вырезаются до
 *      поиска кода — код из цитаты или иллюстрации следом не считается. Хватает одного названного кода,
 *      решающего следом; остальные названные коды — контекст строки.
 *   3. Карта следа: названный код обязан указывать на карту доски (живые + done/) со статусом backlog
 *      (флаг ожидания решения) и эпиком — дорожкой протокола: лейбл читается из таблицы эпиков
 *      PROJECT.md по коду protocol (один из девяти видов цели, как в epics.cjs; язык проекта не зашит).
 *
 * Вердикт: КРАСНАЯ, если (i) в строке останова нет ни одного кода карты вне цитат; (ii) названный код
 * не находится на доске; (iii) найденная карта не backlog; (iv) её эпик — не дорожка протокола.
 * Карточки без строк останова не судятся. Нераспознаваемо механически: полнота словаря остановов
 * (порог, кто остановился, решение) — часть вердикта человека при приёмке. Путь exception (как в
 * budget-stop): строка
 *   - `Узел`, ГГГГ-ММ-ДД: exception: … human-row-trace …
 * в History этой же карточки — находки карточки пропускаются с явной пометкой; решает человек.
 *
 * Коды возврата: 0 — зелёный; 1 — КРАСНАЯ (останов без следа: без кода, код не находится, не backlog,
 * не эпик протокола); 2 — ошибка исполнения (самопроба не сошлась, каталог доски или таблица эпиков
 * PROJECT.md не читаются).
 * Модуль: require('./human-row-trace.cjs') → { id: 'human-row-trace', since: null, run, runBoard,
 * selftest, isStopLine, codesOf, protocolLane } — форма реестра проверок; включение одной строкой в
 * index.cjs — решение принимающего, по умолчанию гейт вызывается явно (--board).
 * Часть ядра: следов проекта не несёт (запрет 16; фикстурные коды карт собираются в рантайме —
 * литералов вида card-NNN в теле нет, регулярки распознавания не тронуты; дат в теле нет).
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { cardFiles, zone, parseFrontmatter } = require('../../dashboard/lib/card.cjs');

// Словарь строк останова — общий с budget-stop.cjs (его шапка — держатель конвенции); продублировано,
// чтобы чекер стоял сам. Обновление словаря — правка обеих шапок.
const STOP_HEAD_RE = /^-\s*`[^`]+`,\s*\d{4}-\d{2}-\d{2}:\s*(?:stop\b|останов)/i;
const STOP_THRESHOLD_RE = /(?:budget|бюджет|порог|threshold|попытк|attempt)/i;
const QUOTE_RE = /«[^»]*»|"[^"]*"|`[^`]*`/g;
const ILLUSTRATION_RE = /(?:поимк\w*|находк\w*|цитат\w*|цитиру\w*|пример\w*|например)[^\n()«"»]{0,40}?\([^()]*\)/gi;
const CODE_RE = /\bcard-(\d+)\b/gi;
const EXCEPTION_RE = /^-\s*`[^`]+`,\s*\d{4}-\d{2}-\d{2}:\s*exception:[^\n]*human-row-trace/i;
const PROTOCOL_CODE = 'protocol';
const PROJECT_REL = 'project/config/PROJECT.md';

const err = (msg) => Object.assign(new Error(msg), { exitCode: 2 });

/**
 * Цитатная ограничительность: цитаты («…», "…", `…`) и скобки-иллюстрации после слов поимка/находка/
 * цитата/цитирую/пример/например вырезаются до поиска кода следа — код из цитаты в прозе и описание
 * поимки не есть след. Порядок — как в budget-stop.cjs: цитаты → иллюстрации → цитаты.
 * Распознавание строки останова остаётся по исходной строке — вырезание касается только поиска кода.
 */
function stripQuoted(line) {
  const q1 = String(line).replace(QUOTE_RE, ' ');
  const q2 = q1.replace(ILLUSTRATION_RE, ' ');
  return q2.replace(QUOTE_RE, ' ');
}

/** Строки-события зоны History карточки; зоны нет — пусто (как в budget-stop). */
function historyLines(text) {
  const history = zone(text, 'history');
  if (!history) return [];
  return history.split(/\r?\n/).filter((l) => /^\s*-\s/.test(l));
}

/** Строка останова: описание начинается со слова stop/останов, порог назван (слово + цифра); по исходной строке. */
function isStopLine(line) {
  return STOP_HEAD_RE.test(line) && STOP_THRESHOLD_RE.test(line) && /\d/.test(line);
}

/** Названные коды карт строки останова (вне цитат и скобок-иллюстраций), по порядку, без повторов. */
function codesOf(line) {
  const out = [];
  for (const m of stripQuoted(line).matchAll(CODE_RE)) {
    const code = 'card-' + m[1];
    if (!out.includes(code)) out.push(code);
  }
  return out;
}

/** Дорожка эпика протокола: лейбл из таблицы эпиков PROJECT.md по коду protocol (как в epics.cjs). */
function protocolLane(root) {
  const pm = path.join(root, PROJECT_REL);
  if (!fs.existsSync(pm)) {
    throw err(PROJECT_REL + ': не найден — таблица эпиков не прочитана, дорожка эпика протокола не опознана');
  }
  const re = new RegExp('^\\|\\s*`' + PROTOCOL_CODE + '`\\s*\\|\\s*([^|]+?)\\s*\\|');
  for (const line of fs.readFileSync(pm, 'utf8').split(/\r?\n/)) {
    const m = line.match(re);
    if (m) return m[1].replace(/`/g, '');
  }
  throw err(PROJECT_REL + ': в таблице эпиков нет строки кода protocol — дорожка эпика протокола не опознана (проверка эпика не выполнялась)');
}

/** Ядро гейта: скан карточек доски (живые + done/); карточки без строк останова не судятся. */
function runBoard({ root } = {}) {
  root = root || process.cwd();
  const lane = protocolLane(root);
  const cards = new Map();
  for (const file of cardFiles(root)) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const m = path.basename(file).match(/card-(\d+)/i);
    if (!m || cards.has('card-' + m[1])) continue;
    const fm = parseFrontmatter(text);
    cards.set('card-' + m[1], { status: fm.status || null, epic: fm.epic || null });
  }
  const lines = [];
  let red = 0;
  let cardsScanned = 0;
  let stopsSeen = 0;
  for (const file of cardFiles(root)) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    cardsScanned += 1;
    const hLines = historyLines(text);
    const stops = hLines.filter(isStopLine);
    if (!stops.length) continue;
    stopsSeen += stops.length;
    const code = (path.basename(file).match(/card-\d+/i) || [path.basename(file)])[0];
    if (hLines.some((l) => EXCEPTION_RE.test(l))) {
      lines.push({
        status: 'skipped',
        fact: `${code}: строк останова: ${stops.length} — пропущены по exception — решает человек`,
      });
      continue;
    }
    for (const stop of stops) {
      const codes = codesOf(stop);
      if (!codes.length) {
        red += 1;
        lines.push({
          status: 'red',
          fact: `${code}: строка останова без кода карты следа — правило human-row-trace: останов к человеку обязан нести код карты эпика протокола в backlog (флаг ожидания решения); форма: код card-NNN в той же строке, вне цитат; путь exception — строка exception: … human-row-trace … в History этой карточки (решает человек)`,
        });
        continue;
      }
      const good = codes
        .map((c) => ({ code: c, card: cards.get(c) || null }))
        .find((x) => x.card && x.card.status === 'backlog' && x.card.epic === lane);
      if (good) {
        lines.push({
          status: 'green',
          fact: `${code}: останов — след записан: карта ${good.code} (backlog, эпик протокола «${lane}») — ждёт решения`,
        });
        continue;
      }
      for (const c of codes) {
        const card = cards.get(c) || null;
        red += 1;
        const why = !card
          ? 'не находится на доске (живые + done/)'
          : card.status !== 'backlog'
            ? `не backlog (статус «${card.status}»)`
            : `не эпик протокола (эпик «${card.epic}», дорожка протокола — «${lane}»)`;
        lines.push({
          status: 'red',
          fact: `${code}: строка останова — код ${c} ${why}; правило human-row-trace: след — карта эпика протокола в backlog, флаг ожидания решения; путь exception — строка exception: … human-row-trace … в History этой карточки (решает человек)`,
        });
      }
    }
  }
  return { ready: red === 0, lines, cardsScanned, stopsSeen, red, lane };
}

// ---- --selftest: приборы во временном каталоге ---------------------------------------------------

const LANE_PROTOCOL = '3. Пробный протокол';
const LANE_OTHER = '4. Пробные ресурсы';
const LANES_MD =
  '# конфигурация\n\n| Код | Эпик |\n|---|---|\n' +
  '| `protocol` | ' + LANE_PROTOCOL + ' |\n' +
  '| `resources` | ' + LANE_OTHER + ' |\n';

// Запрет 16: фикстурные коды карт не бывают литералами тела — сканер чистой зоны матчит card-\d{3}
// как след проекта; код собирается в рантайме, регулярки распознавания (card-\d+) не тронуты.
const PROBE_CARD = ['card', '001'].join('-');    // карта следа, решающая гейтом (пробы а, з)
const PROBE_CLOSED = ['card', '002'].join('-');  // закрытая карта следа (проба в)
const PROBE_OTHER = ['card', '003'].join('-');   // карта другого эпика (проба г)
const PROBE_UNKNOWN = ['card', '004'].join('-'); // кода на доске нет (проба д)
const PROBE_GHOST = ['card', '099'].join('-');   // образцовая карта в цитатах и иллюстрациях (е, з, и)

/** Карточка-проба (остановившийся узел): одна строка задачи и набор строк Истории. */
function probeCard(histLines) {
  return (
    '# проба\n\n## Task\n901 · tooling | что доставляет проба | критерий пробы | 2 | куда далее\n\n## Kit\n\n## History\n' +
    histLines.join('\n') +
    '\n\n## Result\n'
  );
}

/** Карта следа пробы: frontmatter (статус, эпик) — единственное, что читает гейт. */
function traceCard(code, status, epic) {
  return (
    '---\nid: "' + code + '-proba-sleda"\nstatus: "' + status + '"\nepic: "' + epic + '"\n---\n\n' +
    '# ' + code + ' · проба карты следа\n\n## Task\n\n902 · decision | вопрос человеку | решает человек | 2 | человек\n\n## Kit\n\n## History\n\n## Result\n'
  );
}

function writeTree(dir, files) {
  for (const [rel, text] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  }
}

function selftest() {
  const base = process.env.FORMA_TEST_TMP && fs.existsSync(process.env.FORMA_TEST_TMP) ? process.env.FORMA_TEST_TMP : os.tmpdir();
  const dir = fs.mkdtempSync(path.join(base, 'human-row-trace-'));
  const results = [];
  const check = (name, cond) => results.push({ ok: !!cond, name });
  const today = new Date().toISOString().slice(0, 10);
  const STOP = (rest) => '- `Spec`, ' + today + ': ' + rest;
  try {
    // а: останов с кодом backlog-карты эпика протокола — ЗЕЛЁНАЯ
    writeTree(path.join(dir, 'a'), {
      'project/config/PROJECT.md': LANES_MD,
      '.devtool/features/probe-911-stop-awaiting.md': probeCard([
        STOP('останов — порог попыток 2 из 2 исчерпан, вопрос человеку: права записи; карта ' + PROBE_CARD + ' открыта в эпике протокола — ждёт решения.'),
      ]),
      ['.devtool/features/' + PROBE_CARD + '-proba-sleda.md']: traceCard(PROBE_CARD, 'backlog', LANE_PROTOCOL),
    });
    const ra = runBoard({ root: path.join(dir, 'a') });
    check('а: останов с кодом backlog-карты эпика протокола = ЗЕЛЁНАЯ', ra.ready && ra.stopsSeen === 1 && ra.lines.some((l) => l.status === 'green' && l.fact.includes(PROBE_CARD)));

    // б: останов без кода — КРАСНАЯ (fail-closed)
    writeTree(path.join(dir, 'b'), {
      'project/config/PROJECT.md': LANES_MD,
      '.devtool/features/probe-912-stop-no-code.md': probeCard([
        STOP('останов — порог попыток исчерпан (1 из 1), дальше нельзя — вопрос человеку.'),
      ]),
    });
    const rb = runBoard({ root: path.join(dir, 'b') });
    check('б: останов без кода = КРАСНАЯ (названо: без кода карты)', !rb.ready && rb.lines.some((l) => l.status === 'red' && l.fact.includes('без кода карты')));

    // в: останов с кодом закрытой карты — КРАСНАЯ
    writeTree(path.join(dir, 'c'), {
      'project/config/PROJECT.md': LANES_MD,
      '.devtool/features/probe-913-stop-closed.md': probeCard([
        STOP('останов — порог 2 из 2 исчерпан; карта ' + PROBE_CLOSED + ' названа следом.'),
      ]),
      ['.devtool/features/' + PROBE_CLOSED + '-proba-zakrytaya.md']: traceCard(PROBE_CLOSED, 'done', LANE_PROTOCOL),
    });
    const rc = runBoard({ root: path.join(dir, 'c') });
    check('в: останов с кодом закрытой карты = КРАСНАЯ (названо: не backlog)', !rc.ready && rc.lines.some((l) => l.status === 'red' && l.fact.includes('не backlog') && l.fact.includes(PROBE_CLOSED)));

    // г: останов с кодом карты другого эпика — КРАСНАЯ
    writeTree(path.join(dir, 'd'), {
      'project/config/PROJECT.md': LANES_MD,
      '.devtool/features/probe-914-stop-other-epic.md': probeCard([
        STOP('останов — порог 2 из 2 исчерпан; карта ' + PROBE_OTHER + ' названа следом.'),
      ]),
      ['.devtool/features/' + PROBE_OTHER + '-proba-drugoy-epik.md']: traceCard(PROBE_OTHER, 'backlog', LANE_OTHER),
    });
    const rd = runBoard({ root: path.join(dir, 'd') });
    check('г: останов с кодом карты другого эпика = КРАСНАЯ (названо: не эпик протокола)', !rd.ready && rd.lines.some((l) => l.status === 'red' && l.fact.includes('не эпик протокола') && l.fact.includes(PROBE_OTHER)));

    // д: останов с кодом, которого нет на доске — КРАСНАЯ
    writeTree(path.join(dir, 'e'), {
      'project/config/PROJECT.md': LANES_MD,
      '.devtool/features/probe-915-stop-unknown-code.md': probeCard([
        STOP('останов — порог 2 из 2 исчерпан; карта ' + PROBE_UNKNOWN + ' названа следом.'),
      ]),
    });
    const re2 = runBoard({ root: path.join(dir, 'e') });
    check('д: останов с кодом, которого нет на доске = КРАСНАЯ (названо: не находится)', !re2.ready && re2.lines.some((l) => l.status === 'red' && l.fact.includes('не находится') && l.fact.includes(PROBE_UNKNOWN)));

    // е: обычные строки Истории — 0 срабатываний
    writeTree(path.join(dir, 'f'), {
      'project/config/PROJECT.md': LANES_MD,
      '.devtool/features/probe-916-ordinary-lines.md': probeCard([
        '- `Kit`, ' + today + ': stage exec — работа по карточке.',
        '- `Kit`, ' + today + ': attempt, 123 tokens (100 cache-read), 10 out, 5 s, `sess-1` — запись расхода (human-row-trace probe-999).',
        '- `Intent`, ' + today + ': human approved the five fields, 0 tokens, 0 s — план одобрен ответом «да».',
        '- `Intent`, ' + today + ': человек решил (' + today + '): «принимаю» — запись решения, не останов.',
        '- `Core`, ' + today + ': closed — образ достигнут.',
        '- `Kit`, ' + today + ': поимка probe-911 (останов — порог 2 из 2, карта ' + PROBE_GHOST + ') — форма останова внутри скобок-иллюстрации.',
        '- `Kit`, ' + today + ': «останов — порог 1 из 1, карта ' + PROBE_GHOST + '» — цитата формы останова в начале описания.',
      ]),
    });
    const rf = runBoard({ root: path.join(dir, 'f') });
    check('е: обычные строки (stage/attempt/human approved/человек решил/closed/цитаты форм) = ЗЕЛЁНАЯ, остановов 0, ложных срабатываний нет', rf.ready && rf.stopsSeen === 0 && rf.lines.length === 0);

    // ж: exception в той же карточке — находка пропущена с явной пометкой
    writeTree(path.join(dir, 'g'), {
      'project/config/PROJECT.md': LANES_MD,
      '.devtool/features/probe-917-exception.md': probeCard([
        STOP('останов — порог попыток 1 из 1 исчерпан, дальше нельзя.'),
        '- `Intent`, ' + today + ': exception: human-row-trace — останов был, след открыт задним числом — решает человек.',
      ]),
    });
    const rg = runBoard({ root: path.join(dir, 'g') });
    check('ж: exception в карточке = пропуск находки с пометкой, код зелёный', rg.ready && rg.stopsSeen === 1 && rg.lines.some((l) => l.status === 'skipped'));

    // з: два названных кода, один решает (backlog эпика протокола) — ЗЕЛЁНАЯ
    writeTree(path.join(dir, 'h'), {
      'project/config/PROJECT.md': LANES_MD,
      '.devtool/features/probe-918-two-codes.md': probeCard([
        STOP('останов — порог попыток 2 из 2; правка по образцу ' + PROBE_GHOST + ' не встала в критерий; карта ' + PROBE_CARD + ' открыта — ждёт решения.'),
      ]),
      ['.devtool/features/' + PROBE_CARD + '-proba-sleda.md']: traceCard(PROBE_CARD, 'backlog', LANE_PROTOCOL),
    });
    const rh = runBoard({ root: path.join(dir, 'h') });
    check('з: из двух названных кодов один решает (backlog эпика протокола) = ЗЕЛЁНАЯ — хватает одного решающего кода', rh.ready && rh.lines.some((l) => l.status === 'green' && l.fact.includes(PROBE_CARD)));

    // и: строка останова, код только в цитате-иллюстрации — КРАСНАЯ (цитатная ограничительность)
    writeTree(path.join(dir, 'i'), {
      'project/config/PROJECT.md': LANES_MD,
      '.devtool/features/probe-919-code-in-quote.md': probeCard([
        STOP('останов — по образцу «останов — порог 2 из 2, карта ' + PROBE_GHOST + '» — иллюстрация словаря, не запись.'),
      ]),
    });
    const ri = runBoard({ root: path.join(dir, 'i') });
    check('и: строка останова, код только в цитате-иллюстрации = КРАСНАЯ (цитатная ограничительность: код из цитаты не след)', !ri.ready && ri.lines.some((l) => l.status === 'red' && l.fact.includes('без кода карты')));

    const failed = results.filter((r) => !r.ok);
    return {
      ok: failed.length === 0,
      note: failed.length
        ? 'не сошлось: ' + failed.map((r) => r.name).join('; ')
        : 'все 9 проб зелёные: останов с кодом backlog-карты эпика протокола ЗЕЛЁНАЯ, без кода КРАСНАЯ, код закрытой карты КРАСНАЯ (не backlog), код карты другого эпика КРАСНАЯ (не эпик протокола), код не находится КРАСНАЯ, обычные строки без ложных срабатываний, exception пропускает с пометкой, из двух названных кодов хватает одного решающего, код из цитаты-иллюстрации не след (КРАСНАЯ)',
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---- форма реестра проверок ----------------------------------------------------------------------

/** Находки для реестра (`run(ctx)` → строки, пустой список — чисто); регистрация в index.cjs — решение принимающего. */
function run(ctx = {}) {
  const r = runBoard({ root: ctx.root });
  return r.lines.filter((l) => l.status === 'red').map((l) => 'human-row-trace: ' + l.fact);
}

module.exports = { id: 'human-row-trace', since: null, run, runBoard, selftest, isStopLine, codesOf, protocolLane };

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
    if (!r.lines.length) console.log(`· строк останова в History не найдено (карточек просмотрено: ${r.cardsScanned})`);
    if (r.ready) console.log(`HUMAN-ROW-TRACE: ЗЕЛЁНАЯ — остановов: ${r.stopsSeen} (след записан при каждом), карточек просмотрено: ${r.cardsScanned}`);
    else console.log(`HUMAN-ROW-TRACE: КРАСНАЯ — находок: ${r.red} (см. строки ✗)`);
    process.exit(r.ready ? 0 : 1);
  } catch (e) {
    console.error('СТОП: ' + e.message);
    process.exit(e.exitCode || 2);
  }
}
