#!/usr/bin/env node
'use strict';

/**
 * law-shrink — гейт сжатого закона: механика правил держится скриптами и хуками, сам закон
 * держится адресами. Проверяет четыре вещи, код 0 — только если все зелёные:
 *   1) объём AGENTS.md строго меньше базлайна; базлайн читается из .forma/living/checks.json
 *      (ключ lawShrink.baselineBytes) — в теле чекера нет фактов проекта (запрет 16),
 *      базлайн замеряется до правок и записывается один раз;
 *   2) все номера запретов 1–18 присутствуют в §5 — адреса, на которые ссылаются файлы ролей;
 *   3) заголовки §1–§7 присутствуют;
 *   4) каждый файл/скрипт, названный AGENTS.md в бэктиках (имя без пути, .md/.cjs/.sh/.json),
 *      существует на диске — лёгкая перепроверка логики law-pointers: индекс имён строится по
 *      корню, .forma и зеркалам движков (каталоги с agents/run.md); .devtool и project в индекс
 *      не входят — закон не должен держаться на карточках и материале проекта.
 *
 *   node .forma/board/checks/law-shrink.cjs [--root <каталог>]
 *   node .forma/board/checks/law-shrink.cjs --selftest
 *
 * Коды возврата: 0 — всё зелёное; 1 — есть красная; 2 — ошибка исполнения (нет закона или базлайна).
 * Модуль: require('./law-shrink.cjs').runLawShrink({ root }) → { ok, code, lines }.
 * Самопроверка — `--selftest`: приборы во временном каталоге ОС; маленький фиктивный закон со всеми
 * адресами даёт зелёный, вычтенный номер запрета — красную.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const LAW = 'AGENTS.md';
const BASELINE_KEY = 'lawShrink.baselineBytes';
const PROHIBITIONS = 18;
const SECTIONS = 7;

// Не файлы-указатели: корневые файлы протокола и проекта (закон не проверяет сам себя
// и свои корневые соседи), правила движка вида `<engine>-<цифра>.md`.
const NOT_FILE = new Set(['PROJECT.md', 'JOURNAL.md', 'GOAL.md', 'CLAUDE.md', 'AGENTS.md', 'GEMINI.md', 'README.md', 'ECONOMY.md', 'ROUTES.md']);
const ENGINE_RULE_RE = /^[a-z]+-\d+\.md$/;
// Что не входит в индекс имён: зависимости и изменяемые зоны.
const WALK_SKIP = new Set(['node_modules', '.git', '.cache', '.devtool', 'project']);

/** Имена файлов/скриптов в бэктиках закона (имя без пути). */
function pointers(text) {
  const out = new Set();
  for (const m of text.matchAll(/`([^`\s/]+\.(?:md|cjs|sh|json))`/g)) {
    const n = m[1];
    if (NOT_FILE.has(n) || ENGINE_RULE_RE.test(n)) continue;
    out.add(n);
  }
  return [...out].sort();
}

/** Текст секции `## N.` — от её заголовка до следующего заголовка `## `. */
function section(text, n) {
  const m = new RegExp(`^## ${n}\\.`, 'm').exec(text);
  if (!m) return null;
  const from = m.index;
  const next = text.slice(from + 1).match(/^## \d+\./m);
  return next ? text.slice(from, from + 1 + next.index) : text.slice(from);
}

/** Индекс имён файлов: корень (файлы), .forma и зеркала движков (рекурсивно). */
function fileIndex(root) {
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (!WALK_SKIP.has(e.name)) walk(full); }
      else if (e.isFile()) names.add(e.name);
    }
  };
  const names = new Set();
  const rootEntries = fs.readdirSync(root, { withFileTypes: true });
  for (const e of rootEntries) if (e.isFile()) names.add(e.name);
  const bases = [path.join(root, '.forma')]
    .concat(rootEntries.filter((e) => e.isDirectory() && e.name.startsWith('.') && fs.existsSync(path.join(root, e.name, 'agents', 'run.md'))).map((e) => path.join(root, e.name)))
    .filter((p) => fs.existsSync(p));
  for (const base of bases) walk(base);
  return names;
}

function runLawShrink({ root } = {}) {
  root = root || path.resolve(__dirname, '..', '..', '..');
  const lawPath = path.join(root, LAW);
  if (!fs.existsSync(lawPath)) return { ok: false, code: 2, lines: [{ ok: false, fact: `закон не найден: ${LAW}` }] };
  const checksPath = path.join(root, '.forma', 'living', 'checks.json');
  let baseline = null;
  if (fs.existsSync(checksPath)) {
    try { baseline = JSON.parse(fs.readFileSync(checksPath, 'utf8'))[BASELINE_KEY]; } catch { baseline = null; }
  }
  if (!Number.isFinite(baseline)) {
    return { ok: false, code: 2, lines: [{ ok: false, fact: `базлайна нет: ${path.relative(root, checksPath)} → ${BASELINE_KEY} — замерь закон до правок (wc -c) и запиши` }] };
  }
  const text = fs.readFileSync(lawPath, 'utf8');
  const bytes = Buffer.byteLength(text);
  const lines = [];
  let red = 0;

  if (bytes < baseline) lines.push({ ok: true, fact: `объём ${LAW}: ${bytes} Б < базлайна ${baseline} Б (−${baseline - bytes})` });
  else { red += 1; lines.push({ ok: false, fact: `объём ${LAW}: ${bytes} Б не меньше базлайна ${baseline} Б — сжатия нет` }); }

  const s5 = section(text, 5);
  if (!s5) { red += 1; lines.push({ ok: false, fact: '§5 не найден' }); }
  else {
    const missing = [];
    for (let n = 1; n <= PROHIBITIONS; n++) if (!new RegExp(`^${n}\\. `, 'm').test(s5)) missing.push(n);
    if (missing.length) { red += 1; lines.push({ ok: false, fact: `§5: нет запретов с номерами ${missing.join(', ')}` }); }
    else lines.push({ ok: true, fact: `§5: запреты 1–${PROHIBITIONS} на месте` });
  }

  const noHead = [];
  for (let n = 1; n <= SECTIONS; n++) if (!new RegExp(`^## ${n}\\.`, 'm').test(text)) noHead.push(n);
  if (noHead.length) { red += 1; lines.push({ ok: false, fact: `нет заголовков §${noHead.join(', §')}` }); }
  else lines.push({ ok: true, fact: `заголовки §1–§${SECTIONS} на месте` });

  const idx = fileIndex(root);
  const named = pointers(text);
  const ghosts = named.filter((n) => !idx.has(n));
  if (ghosts.length) { red += 1; lines.push({ ok: false, fact: `названные в бэктиках файлы не найдены на диске: ${ghosts.join(', ')}` }); }
  else lines.push({ ok: true, fact: `все названные в бэктиках файлы на диске (${named.length} имён)` });

  return { ok: red === 0, code: red === 0 ? 0 : 1, lines };
}

function selftest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'law-shrink-'));
  try {
    const parts = [];
    for (let i = 1; i <= SECTIONS; i++) {
      parts.push(`## ${i}. Раздел ${i}`, '');
      if (i === 3) parts.push('Держатель — `holder.cjs`; поля — `fields.md`.', '');
      if (i === 5) {
        parts.push('Правила:', '');
        for (let p = 1; p <= PROHIBITIONS; p++) parts.push(`${p}. Утвердительное правило ${p}.`, '');
      }
    }
    const law = parts.join('\n');
    fs.writeFileSync(path.join(dir, LAW), law);
    fs.mkdirSync(path.join(dir, '.forma', 'living'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.forma', 'living', 'checks.json'), JSON.stringify({ [BASELINE_KEY]: Buffer.byteLength(law) + 1 }));
    fs.writeFileSync(path.join(dir, 'holder.cjs'), '// фиктивный держатель\n');
    fs.writeFileSync(path.join(dir, 'fields.md'), 'фиктивные поля\n');
    const green = runLawShrink({ root: dir });
    if (!green.ok) return { ok: false, note: 'фиктивный закон со всеми адресами дал красную: ' + green.lines.filter((l) => !l.ok).map((l) => l.fact).join(' | ') };
    const broken = law.replace('7. Утвердительное правило 7.\n', '');
    fs.writeFileSync(path.join(dir, LAW), broken);
    const red = runLawShrink({ root: dir });
    if (red.ok) return { ok: false, note: 'вычтенный номер запрета не дал красной — гейт не ловит' };
    return { ok: true, note: `негативная проба: закон со всеми адресами зелёный; закон без запрета 7 — красная («${red.lines.find((l) => !l.ok).fact}»)`, greenBytes: Buffer.byteLength(law) };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

module.exports = { runLawShrink, selftest, pointers, section, fileIndex };

if (require.main === module) {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) {
    const st = selftest();
    console.log(st.ok ? '✓ ' + st.note : '✗ ' + st.note);
    process.exit(st.ok ? 0 : 1);
  }
  const rootIdx = argv.indexOf('--root');
  const r = runLawShrink({ root: rootIdx >= 0 ? path.resolve(argv[rootIdx + 1]) : undefined });
  for (const l of r.lines) console.log((l.ok ? '✓ ' : '✗ ') + l.fact);
  console.log(r.ok ? 'law-shrink: все проверки зелёные' : 'law-shrink: есть красные — см. выше');
  process.exit(r.code);
}
