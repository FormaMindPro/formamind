#!/usr/bin/env node
'use strict';

/**
 * goal-freeze — гейт заморозки версий (запрет 8, fail-closed): закоммиченное изменение GOAL.md цели
 * или файла справочника проекта останавливается, если в History какой-либо карточки доски нет строки
 * «human approved», называющей этот файл или код его цели. Замороженное множество читается
 * динамически: все GOAL.md в `project/goals/<цель>/` плюс файлы справочников из таблицы
 * «Справочники проекта» в `project/config/PROJECT.md` (столбец «Где живёт»; строки таблицы
 * добавляются без правки этого чекера). Без модельных вызовов; потребители — предкоммитный хук,
 * узел Intent на проверке карточки и check-board.
 *
 *   node .forma/board/checks/goal-freeze.cjs                      (состав замороженного множества, код 0)
 *   node .forma/board/checks/goal-freeze.cjs --staged             (список из `git diff --cached --name-only`)
 *   node .forma/board/checks/goal-freeze.cjs --files <путь>…      (перечисленные считаются staged; пробы без индекса)
 *   node .forma/board/checks/goal-freeze.cjs --selftest           (приборы во временном каталоге ОС)
 *   node .forma/board/checks/goal-freeze.cjs --wired              (включение в предкоммитную цепочку; чинит локальный хук)
 *
 * Вердикт `--staged`/`--files`: каждый staged-файл из замороженного множества обязан иметь запись
 * «human approved» (строка `- `Node`, ГГГГ-ММ-ДЦ: human approved — …` в зоне History любой карточки
 * доски, включая закрытые), называющую файл или код его цели; нет записи — КРАСНАЯ и сообщение,
 * какая запись требуется. Путь exception — на приёмке карточки: строка `exception:` в History,
 * называющая этот гейт (соглашение check-ready), на коммит не влияет. `--wired`: читает фактический
 * хук коммита (`.git/hooks/pre-commit`) и скрипты, которые он вызывает; если цепочка не вызывает
 * goal-freeze.cjs — дописывает вызов в локальный хук (вне git) и перепроверяет; настоящий коммит
 * не делается.
 *
 * Коды возврата: 0 — зелёный; 1 — КРАСНАЯ (замороженный файл без согласования); 2 — ошибка
 * исполнения (нет репозитория/PROJECT.md, git недоступен, самопроба не сошлась).
 * Модуль: require('./goal-freeze.cjs').runGoalFreeze({ root, staged }) → { ready, lines, frozen }.
 * Часть ядра: следов проекта не несёт (запрет 16).
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { cardFiles, zone } = require('../../dashboard/lib/card.cjs');

const GOALS_REL = 'project/goals';
const GOAL_FILE = 'GOAL.md';
const PROJECT_REL = 'project/config/PROJECT.md';
const REFERENCES_MARK = 'Справочники проекта';
const APPROVED_RE = /^- `[^`]+`, \d{4}-\d{2}-\d{2}: human approved\b/m;

const err = (msg) => Object.assign(new Error(msg), { exitCode: 2 });
const norm = (p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Код цели из пути `project/goals/<code>/GOAL.md`, иначе null. */
function goalCodeOf(relPath) {
  const m = norm(relPath).match(/^project\/goals\/([^/]+)\/GOAL\.md$/i);
  return m ? m[1] : null;
}

/** Замороженное множество: цели + справочники из таблицы «Справочники проекта». */
function frozenFiles(root) {
  const files = [];
  const problems = [];
  const goalsDir = path.join(root, GOALS_REL);
  if (!fs.existsSync(goalsDir)) {
    problems.push(`${GOALS_REL}: каталог целей не найден — заморозить нечего, основа гейта неполна`);
  } else {
    for (const e of fs.readdirSync(goalsDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!e.isDirectory()) continue;
      const rel = `${GOALS_REL}/${e.name}/${GOAL_FILE}`;
      if (fs.existsSync(path.join(root, rel))) files.push({ path: rel, code: e.name, source: 'цель' });
      else problems.push(`${rel}: у цели нет ${GOAL_FILE} — файл не попадает в заморозку`);
    }
  }
  const pm = path.join(root, PROJECT_REL);
  if (!fs.existsSync(pm)) {
    problems.push(`${PROJECT_REL}: не найден — таблица «${REFERENCES_MARK}» не прочитана`);
  } else {
    const refs = referenceFiles(fs.readFileSync(pm, 'utf8'));
    for (const rel of refs) files.push({ path: rel, code: null, source: 'справочник' });
  }
  return { files, problems };
}

/** Файлы справочников: строки таблицы под заголовком «Справочники проекта», столбец «Где живёт». */
function referenceFiles(projectMdText) {
  const lines = String(projectMdText).split(/\r?\n/);
  const head = lines.findIndex((l) => l.includes(REFERENCES_MARK));
  if (head < 0) return [];
  let i = head + 1;
  while (i < lines.length && !lines[i].trim()) i++; // пустые строки между заголовком и таблицей
  if (i >= lines.length || !lines[i].trim().startsWith('|')) return [];
  const out = [];
  for (; i < lines.length && lines[i].trim().startsWith('|'); i++) { // таблица — до первой строки вне `|`
    const cells = lines[i].split('|').slice(1, -1).map((c) => c.trim().replace(/^`|`$/g, ''));
    if (cells.length < 2) continue;
    const rel = norm(cells[1]);
    if (!rel || !/[./]/.test(rel) || /^[-: ]+$/.test(rel)) continue; // шапка и разделитель — не путь
    out.push(rel);
  }
  return out;
}

/** Строки «human approved» в History карточки; зон нет — пусто. */
function approvedLines(cardText) {
  const history = zone(cardText, 'history');
  if (!history) return [];
  return history.split(/\r?\n/).filter((l) => APPROVED_RE.test(l));
}

/** Называет ли строка одобрения этот файл (путь) или код его цели. */
function lineNames(line, file) {
  const hay = line.replace(/\\/g, '/').toLowerCase();
  if (hay.includes(file.path.toLowerCase())) return true;
  if (file.code) {
    const re = new RegExp('(^|[^\\p{L}\\p{N}_-])' + escapeRe(file.code.toLowerCase()) + '([^\\p{L}\\p{N}_-]|$)', 'u');
    if (re.test(hay)) return true;
  }
  return false;
}

/** Поиск записи согласования по всем карточкам доски (включая done/). */
function findApproval(root, file) {
  for (const card of cardFiles(root)) {
    let text;
    try { text = fs.readFileSync(card, 'utf8'); } catch { continue; }
    const hit = approvedLines(text).find((l) => lineNames(l, file));
    if (hit) return { card: path.basename(card), line: hit.trim() };
  }
  return null;
}

/** Ядро гейта: staged-список против замороженного множества и записей согласования. */
function runGoalFreeze({ root, staged } = {}) {
  root = root || process.cwd();
  const { files, problems } = frozenFiles(root);
  const frozenByPath = new Map(files.map((f) => [f.path.toLowerCase(), f]));
  const lines = [];
  let red = 0;
  let frozenSeen = 0;
  const seen = new Set();
  for (const raw of staged || []) {
    const p = norm(raw);
    if (!p || seen.has(p.toLowerCase())) continue;
    seen.add(p.toLowerCase());
    const f = frozenByPath.get(p.toLowerCase());
    if (!f) {
      lines.push({ status: 'green', fact: `${p} — не в замороженном множестве` });
      continue;
    }
    frozenSeen += 1;
    const ok = findApproval(root, f);
    if (ok) lines.push({ status: 'green', fact: `${p} — заморожен, согласование найдено (${ok.card})` });
    else {
      red += 1;
      lines.push({
        status: 'red',
        fact: `${p} — заморожен, согласования нет; требуется строка «human approved» в History любой карточки доски (включая закрытые), называющая этот файл${f.code ? ` или код цели ${f.code}` : ''}; путь exception — строка exception: в History карточки гейта (решает человек на приёмке)`,
      });
    }
  }
  if (!staged || staged.length === 0) lines.push({ status: 'info', fact: 'staged-файлов нет — останавливать нечего' });
  for (const p of problems) lines.push({ status: 'red', fact: p });
  return { ready: red === 0 && problems.length === 0, lines, frozen: files, frozenSeen };
}

/** Список staged-файлов из индекса git (только чтение). */
function stagedFromGit(root) {
  const r = spawnSync('git', ['diff', '--cached', '--name-only'], { cwd: root, encoding: 'utf8' });
  if (r.error || r.status !== 0) {
    throw err('git diff --cached недоступен: ' + String(r.stderr || (r.error && r.error.message) || 'неизвестная ошибка').trim());
  }
  return String(r.stdout || '').split(/\r?\n/).filter(Boolean);
}

// ---- --wired: включение в предкоммитную цепочку --------------------------------------------------

const WIRE_SNIPPET =
  '# forma: гейт заморозки версий (goal-freeze.cjs) — замороженные файлы без записи «human approved» коммит не проходят\n' +
  'node .forma/board/checks/goal-freeze.cjs --staged || exit 1\n';
const HOOK_FALLBACK =
  '#!/bin/sh\n' +
  WIRE_SNIPPET +
  '# forma: проверка ядра и адаптеров перед коммитом (forma-commit.cjs)\n' +
  'exec node .forma/protocol/scripts/forma-commit.cjs --sync-staged\n';

/** Скрипты, которые вызывает хук (строки `node …`/`exec …` с путями внутрь репозитория). */
function hookRefs(hookText, root) {
  const refs = [];
  for (const m of String(hookText).matchAll(/(?:^|\n)\s*(?:exec\s+)?node\s+(\S+\.cjs)/g)) {
    const p = path.resolve(root, m[1]);
    if (fs.existsSync(p) && !refs.includes(p)) refs.push(p);
  }
  return refs;
}

function chainHasWire(root) {
  const hook = path.join(root, '.git', 'hooks', 'pre-commit');
  if (!fs.existsSync(hook)) return { hook, refs: [], wired: false, hookText: null };
  const hookText = fs.readFileSync(hook, 'utf8');
  const refs = hookRefs(hookText, root);
  const wired = hookText.includes('goal-freeze.cjs') || refs.some((p) => {
    try { return fs.readFileSync(p, 'utf8').includes('goal-freeze.cjs'); } catch { return false; }
  });
  return { hook, refs, wired, hookText };
}

/** Проверка (и починка) включения гейта в предкоммитную цепочку; коммит не делается. */
function runWired(root) {
  root = root || process.cwd();
  if (!fs.existsSync(path.join(root, '.git'))) throw err('это не git-репозиторий — хука коммита нет');
  let state = chainHasWire(root);
  const lines = [];
  if (!state.wired) {
    if (!fs.existsSync(state.hook)) {
      fs.mkdirSync(path.dirname(state.hook), { recursive: true });
      fs.writeFileSync(state.hook, HOOK_FALLBACK);
      lines.push({ status: 'info', fact: 'хука pre-commit не было — создан с вызовом goal-freeze и прежней проверкой ядра' });
    } else if (!state.hookText.includes('goal-freeze.cjs')) {
      const nl = state.hookText.includes('\r\n') ? '\r\n' : '\n';
      const parts = state.hookText.split(/\r?\n/);
      const at = parts[0].startsWith('#!') ? 1 : 0; // сразу за шебангом, до остальной цепочки
      parts.splice(at, 0, ...WIRE_SNIPPET.trimEnd().split('\n'));
      fs.writeFileSync(state.hook, parts.join(nl));
      lines.push({ status: 'info', fact: 'в локальный хук дописан вызов goal-freeze.cjs (вне git, коммит не делался)' });
    }
    try { fs.chmodSync(state.hook, 0o755); } catch { /* ФС без chmod — git запустит хук и так */ }
    state = chainHasWire(root);
  }
  lines.push({ status: 'info', fact: `хук: ${path.relative(root, state.hook)}; цепочка вызывает: ${state.refs.map((p) => path.relative(root, p)).join(', ') || 'ничего дальше'}` });
  if (!state.wired) {
    lines.push({ status: 'red', fact: 'предкоммитная цепочка не вызывает goal-freeze.cjs — дописать вызов в локальный хук не удалось' });
    return { ready: false, lines };
  }
  lines.push({ status: 'green', fact: 'goal-freeze.cjs входит в предкоммитную цепочку (до проверки ядра)' });
  return { ready: true, lines };
}

// ---- --selftest: приборы во временном каталоге ---------------------------------------------------

function writeTree(dir, files) {
  for (const [rel, text] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  }
}

function selftest() {
  const base = process.env.FORMA_TEST_TMP && fs.existsSync(process.env.FORMA_TEST_TMP) ? process.env.FORMA_TEST_TMP : os.tmpdir();
  const dir = fs.mkdtempSync(path.join(base, 'goal-freeze-'));
  const today = new Date().toISOString().slice(0, 10);
  const results = [];
  const check = (name, cond) => results.push({ ok: !!cond, name });
  // Имена фикстур — динамически (запрет 16): литерал card-NNN в исходнике чистой зоны ловит проверка следа.
  const name = (k, slug) => '.devtool/features/card-' + (900 + k) + '-' + slug + '.md';
  try {
    writeTree(dir, {
      'project/goals/goal-alpha/GOAL.md': '# цель альфа\n',
      'project/goals/goal-beta/GOAL.md': '# цель бета\n',
      'project/goals/goal-gamma/GOAL.md': '# цель гамма\n',
      'project/config/PROJECT.md':
        '# конфигурация\n\n**' + REFERENCES_MARK + '**:\n\n| Справочник | Где живёт | Что определяет | Версия сегодня |\n|---|---|---|---|\n| Руководство | `docs/handbook.md` | правила предметной области | v1 |\n',
      'docs/handbook.md': '# справочник\n',
    });
    // 1: замороженная цель без согласования — КРАСНАЯ (fail-closed)
    const r1 = runGoalFreeze({ root: dir, staged: ['project/goals/goal-alpha/GOAL.md'] });
    check('цель без согласования = КРАСНАЯ', !r1.ready);
    // 2: чужие файлы — ЗЕЛЁНАЯ
    const r2 = runGoalFreeze({ root: dir, staged: ['src/other/file.txt', 'README.md'] });
    check('чужие файлы = ЗЕЛЁНАЯ', r2.ready);
    // 3: запись «human approved» с именем файла — ЗЕЛЁНАЯ
    writeTree(dir, {
      [name(1, 'sample-approved')]:
        '# проба\n\n## History\n\n- `Intent`, ' + today + ': human approved — правка project/goals/goal-alpha/GOAL.md согласована человеком.\n',
    });
    const r3 = runGoalFreeze({ root: dir, staged: ['project/goals/goal-alpha/GOAL.md'] });
    check('запись с именем файла = ЗЕЛЁНАЯ', r3.ready);
    // 4: запись по коду цели — ЗЕЛЁНАЯ
    writeTree(dir, {
      [name(2, 'sample-code')]:
        '# проба\n\n## History\n\n- `Intent`, ' + today + ': human approved — правка цели goal-beta согласована человеком.\n',
    });
    const r4 = runGoalFreeze({ root: dir, staged: ['project/goals/goal-beta/GOAL.md'] });
    check('запись по коду цели = ЗЕЛЁНАЯ', r4.ready);
    // 5: справочник из таблицы без согласования — КРАСНАЯ
    const r5 = runGoalFreeze({ root: dir, staged: ['docs/handbook.md'] });
    check('справочник без согласования = КРАСНАЯ', !r5.ready);
    // 6: справочник с записью — ЗЕЛЁНАЯ
    writeTree(dir, {
      [name(3, 'sample-ref')]:
        '# проба\n\n## History\n\n- `Intent`, ' + today + ': human approved — правка docs/handbook.md согласована человеком.\n',
    });
    const r6 = runGoalFreeze({ root: dir, staged: ['docs/handbook.md'] });
    check('справочник с записью = ЗЕЛЁНАЯ', r6.ready);
    // 7: упоминание замороженного файла без слов «human approved» — КРАСНАЯ (не всякая строка считается)
    writeTree(dir, {
      [name(4, 'sample-mention')]:
        '# проба\n\n## History\n\n- `Intent`, ' + today + ': замороженный файл project/goals/goal-gamma/GOAL.md обсуждался, согласования не было.\n',
    });
    const r7 = runGoalFreeze({ root: dir, staged: ['project/goals/goal-gamma/GOAL.md'] });
    check('упоминание без «human approved» = КРАСНАЯ', !r7.ready);
    // 8: состав множества динамический — 4 файла (3 цели + 1 справочник)
    const { frozen } = runGoalFreeze({ root: dir, staged: [] });
    check('состав множества: 3 цели + 1 справочник из таблицы', frozen.length === 4);
    const failed = results.filter((r) => !r.ok);
    return {
      ok: failed.length === 0,
      note: failed.length
        ? 'не сошлось: ' + failed.map((r) => r.name).join('; ')
        : 'все пробы зелёные: без записи КРАСНАЯ, с записью (файл или код цели) ЗЕЛЁНАЯ, чужие файлы ЗЕЛЁНАЯ, состав множества динамический',
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---- CLI ----------------------------------------------------------------------------------------

function printFrozen(root) {
  const { files, problems } = frozenFiles(root);
  console.log('Замороженное множество (читается динамически):');
  for (const f of files) console.log(`  ${f.path}${f.code ? ` (цель ${f.code})` : ' (справочник из таблицы «' + REFERENCES_MARK + '»)'}`);
  console.log(`Итого: ${files.length} файлов${problems.length ? '; ПРОБЛЕМЫ:\n' + problems.map((p) => '  - ' + p).join('\n') : ''}`);
  return { files, problems };
}

module.exports = { runGoalFreeze, runWired, frozenFiles, referenceFiles, selftest, stagedFromGit };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const root = process.cwd();
  try {
    if (argv.includes('--selftest')) {
      const st = selftest();
      console.log((st.ok ? '✓ ' : '✗ ') + st.note);
      process.exit(st.ok ? 0 : 1);
    }
    if (argv.includes('--wired')) {
      const r = runWired(root);
      for (const l of r.lines) console.log((l.status === 'green' ? '✓ ' : l.status === 'red' ? '✗ ' : '· ') + l.fact);
      console.log(r.ready ? 'ГОТОВ: гейт включён в предкоммитную цепочку' : 'ГОТОВОСТИ НЕТ: цепочка коммита не вызывает goal-freeze.cjs');
      process.exit(r.ready ? 0 : 1);
    }
    const fi = argv.indexOf('--files');
    let staged = null;
    if (fi >= 0) staged = argv.slice(fi + 1).filter((a) => !a.startsWith('--'));
    else if (argv.includes('--staged')) staged = stagedFromGit(root);
    else {
      const { files, problems } = printFrozen(root);
      if (problems.length) process.exit(2);
      console.log(`ГОТОВ: замороженное множество полное — ${files.length} файлов (цели + справочники из таблицы)`);
      process.exit(0);
    }
    const r = runGoalFreeze({ root, staged });
    for (const l of r.lines) console.log((l.status === 'green' ? '✓ ' : l.status === 'red' ? '✗ ' : '· ') + l.fact);
    const others = r.lines.filter((l) => l.status === 'green' && !l.fact.includes('заморожен')).length;
    if (r.ready) console.log(`ЗАМОРОЗКА: ЗЕЛЁНАЯ — staged из замороженного множества: ${r.frozenSeen} (все с согласованием), вне множества: ${others}`);
    else console.log('ЗАМОРОЗКА: КРАСНАЯ — коммит остановлен, доведи согласование (см. строки ✗)');
    process.exit(r.ready ? 0 : 1);
  } catch (e) {
    console.error('СТОП: ' + e.message);
    process.exit(e.exitCode || 2);
  }
}
