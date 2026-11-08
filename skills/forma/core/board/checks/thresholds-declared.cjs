#!/usr/bin/env node
'use strict';

/**
 * thresholds-declared — гейт декларации порогов (закон §3, fail-closed): старту без двух порогов
 * и девяти целей не бывать, и каждый платный внешний сервис несёт лимит на круг. Держатель —
 * декларация в `project/config/PROJECT.md` (check-ready read-only, поэтому декларация, а не
 * дозапрос): (а) секция порогов — строка с ключом k:thresholds, в её таблице строки k:attempts
 * и k:volume с числами; (б) таблица девяти целей — строка с ключом k:epics, в её таблице все
 * девять кодов видов цели (константа протокола, та же, что в epics.cjs); (в) лимит платного
 * сервиса — в таблице k:routes есть строка, называющая лимит на круг (слово «лимит»/«limit»
 * и цифра в одной строке). Конкретные значения порогов и лимитов, как и полнота состава
 * платных сервисов, — вердикт человека при приёмке; прибор судит декларацию, не величину.
 *
 *   node .forma/board/checks/thresholds-declared.cjs --project [--root <каталог>]  (живой PROJECT.md)
 *   node .forma/board/checks/thresholds-declared.cjs --selftest                    (приборы во временном каталоге ОС)
 *
 * Коды возврата: 0 — ЗЕЛЁНАЯ (декларация полна); 1 — КРАСНАЯ (чего-то из трёх нет — названо,
 * по адресу); 2 — ошибка исполнения (PROJECT.md не найден, самопроба не сошлась).
 * Модуль: require('./thresholds-declared.cjs') → { run, runProject, selftest } — гейт-скрипт без id
 * (не строка реестра): включение стоящей проверкой в index.cjs — отдельное решение принимающего,
 * по умолчанию гейт вызывается явно (--project).
 * Часть ядра: следов проекта не несёт (запрет 16).
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PROJECT_REL = 'project/config/PROJECT.md';

// Девять видов цели: код не зависит от языка, таблица PROJECT.md — единственный их носитель.
const CODES = ['analytics', 'structure', 'protocol', 'resources', 'balance', 'discussion', 'channels', 'competencies', 'results'];

const LIMIT_RE = /(?:лимит|limit)/i;

const err = (msg) => Object.assign(new Error(msg), { exitCode: 2 });

/** Строки таблицы под строкой-носителем ключа `key` (`<!-- k:key -->`): подряд идущие строки `|`. */
function tableRowsAfter(lines, key) {
  const at = lines.findIndex((l) => l.includes('k:' + key));
  if (at < 0) return { at: -1, rows: [] };
  const rows = [];
  for (let i = at + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue; // пустые строки между заголовком и таблицей — пропускаем
    if (!t.startsWith('|')) break; // таблица — до первой строки вне `|`
    rows.push(t);
  }
  return { at, rows };
}

/** Секция порогов: ключ k:thresholds найден, в его таблице k:attempts и k:volume с числами. */
function thresholdsProblems(lines) {
  const { rows } = tableRowsAfter(lines, 'thresholds');
  const problems = [];
  const need = ['attempts', 'volume'];
  for (const key of need) {
    const row = rows.find((r) => r.includes('k:' + key) && /\d/.test(r));
    if (!row) problems.push(`k:${key}`);
  }
  return problems;
}

/** Таблица девяти целей: ключ k:epics найден, все девять кодов видов стоят строками таблицы. */
function goalsProblems(lines) {
  const { rows } = tableRowsAfter(lines, 'epics');
  const missing = CODES.filter((c) => !rows.some((r) => new RegExp('^\\|\\s*`' + c + '`\\s*\\|').test(r)));
  return missing;
}

/** Лимит платного сервиса: в таблице k:routes есть строка с «лимит»/«limit» и цифрой. */
function limitProblems(lines) {
  const { rows } = tableRowsAfter(lines, 'routes');
  const ok = rows.some((r) => LIMIT_RE.test(r) && /\d/.test(r));
  return ok ? [] : ['k:routes'];
}

/** Ядро гейта: PROJECT.md против трёх пунктов декларации; находки — с адресом и ожиданием. */
function runProject({ root } = {}) {
  root = root || process.cwd();
  const file = path.join(root, PROJECT_REL);
  if (!fs.existsSync(file)) throw err(`${PROJECT_REL}: не найден — декларацию судить не о чем`);
  const lines = String(fs.readFileSync(file, 'utf8')).split(/\r?\n/);
  const linesOut = [];
  let red = 0;

  const th = thresholdsProblems(lines);
  if (th.length) {
    red += 1;
    linesOut.push({
      status: 'red',
      fact: `${PROJECT_REL}: секция порогов не полна (k:thresholds) — нет ${th.join(', ')}; закон §3: старту не бывать без заходов на задачу и объёма круга по эпику; нужна строка с ключом k:thresholds и в её таблице k:attempts и k:volume с числами`,
    });
  } else {
    linesOut.push({ status: 'green', fact: `${PROJECT_REL}: секция порогов на месте — k:attempts и k:volume с числами` });
  }

  const missing = goalsProblems(lines);
  if (missing.length) {
    red += 1;
    linesOut.push({
      status: 'red',
      fact: `${PROJECT_REL}: таблица девяти целей не полна (k:epics) — нет кодов: ${missing.join(', ')}; закон §3: девять видов цели задекларированы строками таблицы \`| \`код\` | … |\` под ключом k:epics`,
    });
  } else {
    linesOut.push({ status: 'green', fact: `${PROJECT_REL}: таблица девяти целей на месте — все девять кодов видов` });
  }

  const lim = limitProblems(lines);
  if (lim.length) {
    red += 1;
    linesOut.push({
      status: 'red',
      fact: `${PROJECT_REL}: лимит платного внешнего сервиса не декларирован (k:routes) — в таблице нет строки с «лимит»/«limit» и числом; закон §3: свой лимит на круг несёт каждый платный сервис (полнота состава — вердикт человека)`,
    });
  } else {
    linesOut.push({ status: 'green', fact: `${PROJECT_REL}: лимит платного сервиса декларирован (k:routes)` });
  }

  return { ready: red === 0, lines: linesOut, red };
}

// ---- --selftest: приборы во временном каталоге ---------------------------------------------------

const EPICS_ROWS = CODES.map((c) => `| \`${c}\` | вид цели ${c} | назначение |`).join('\n');

function projectMd({ withThresholds = true, withGoals = true, withLimit = true } = {}) {
  return [
    '# конфигурация',
    '',
    '**Эпики проекта** <!-- k:epics -->:',
    '',
    withGoals ? EPICS_ROWS : '',
    '',
    '**Пороги** <!-- k:thresholds -->:',
    '',
    withThresholds ? '| Порог | Значение |\n|---|---|\n| Заходы <!-- k:attempts --> | 3 |\n| Объём <!-- k:volume --> | 25 |' : '',
    '',
    '**Маршруты** <!-- k:routes -->:',
    '',
    withLimit ? '| Внешняя модель | лимит вызовов на круг — 50 |' : '| Внешняя модель | поставщик назван |',
    '',
  ].join('\n');
}

function selftest() {
  const base = process.env.FORMA_TEST_TMP && fs.existsSync(process.env.FORMA_TEST_TMP) ? process.env.FORMA_TEST_TMP : os.tmpdir();
  const dir = fs.mkdtempSync(path.join(base, 'thresholds-declared-'));
  const results = [];
  const check = (name, cond) => results.push({ ok: !!cond, name });
  try {
    const write = (sub, text) => {
      const p = path.join(dir, sub, PROJECT_REL);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, text);
    };

    // а: полная декларация — ЗЕЛЁНАЯ
    write('a', projectMd());
    const ra = runProject({ root: path.join(dir, 'a') });
    check('а: полная декларация = ЗЕЛЁНАЯ', ra.ready && ra.red === 0 && ra.lines.every((l) => l.status === 'green'));

    // б: без секции порогов — КРАСНАЯ (названо: k:attempts, k:volume)
    write('b', projectMd({ withThresholds: false }));
    const rb = runProject({ root: path.join(dir, 'b') });
    check('б: без секции порогов = КРАСНАЯ (названы k:attempts, k:volume)', !rb.ready && rb.lines.some((l) => l.status === 'red' && l.fact.includes('k:attempts') && l.fact.includes('k:volume')));

    // в: без таблицы целей — КРАСНАЯ (названы недостающие коды)
    write('c', projectMd({ withGoals: false }));
    const rc = runProject({ root: path.join(dir, 'c') });
    check('в: без таблицы целей = КРАСНАЯ (названы коды видов)', !rc.ready && rc.lines.some((l) => l.status === 'red' && l.fact.includes('k:epics') && l.fact.includes('analytics') && l.fact.includes('results')));

    // г: без лимита платного сервиса — КРАСНАЯ (названо: k:routes)
    write('d', projectMd({ withLimit: false }));
    const rd = runProject({ root: path.join(dir, 'd') });
    check('г: без лимита платного сервиса = КРАСНАЯ (названо k:routes)', !rd.ready && rd.lines.some((l) => l.status === 'red' && l.fact.includes('k:routes')));

    // д: PROJECT.md нет — ошибка исполнения (exit 2, fail-closed)
    let threw = false;
    try { runProject({ root: path.join(dir, 'e') }); } catch (e) { threw = e.exitCode === 2; }
    check('д: PROJECT.md нет = ошибка исполнения (exit 2)', threw);

    const failed = results.filter((r) => !r.ok);
    return {
      ok: failed.length === 0,
      note: failed.length
        ? 'не сошлось: ' + failed.map((r) => r.name).join('; ')
        : 'все пробы зелёные: полная декларация ЗЕЛЁНАЯ, без порогов КРАСНАЯ, без таблицы целей КРАСНАЯ, без лимита КРАСНАЯ, без PROJECT.md — ошибка исполнения',
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---- форма реестра проверок ----------------------------------------------------------------------

/** Находки для реестра (`run(ctx)` → строки, пустой список — чисто); регистрация в index.cjs — решение принимающего. */
function run(ctx = {}) {
  const r = runProject({ root: ctx.root });
  return r.lines.filter((l) => l.status === 'red').map((l) => 'thresholds-declared: ' + l.fact);
}

module.exports = { run, runProject, selftest };

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
    if (argv.includes('--project')) {
      const r = runProject({ root });
      for (const l of r.lines) console.log((l.status === 'green' ? '✓ ' : '✗ ') + l.fact);
      if (r.ready) console.log('ПОРОГИ-И-ЦЕЛИ: ЗЕЛЁНАЯ — декларация полна: пороги (k:attempts, k:volume), девять целей (k:epics), лимит платного сервиса (k:routes); значения — вердикт человека при приёмке');
      else console.log(`ПОРОГИ-И-ЦЕЛИ: КРАСНАЯ — находок: ${r.red} (см. строки ✗)`);
      process.exit(r.ready ? 0 : 1);
    }
    console.error('режим не назван: --project (живой PROJECT.md) или --selftest (приборы)');
    process.exit(1);
  } catch (e) {
    console.error('СТОП: ' + e.message);
    process.exit(e.exitCode || 2);
  }
}
