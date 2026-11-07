#!/usr/bin/env node
'use strict';

/**
 * check-ready — судья готовности карточки по гейтам критерия: машинные клаузулы гонятся, досье фактов
 * печатается, записанные исключения пропускают гейт с явной пометкой. Без модельных вызовов: статус —
 * по коду возврата, досье — в stdout; потребители — узлы Intent/Core и обёртка в прогоне check-board.
 *
 *   node .forma/board/check-ready.cjs card-NNN [--gate "<команда>"] [--root <каталог>]
 *   (аргумент карточки — NNN, card-NNN или полное имя карточки на доске)
 *   node .forma/board/check-ready.cjs --help
 *
 * Гейты: клаузулы `check:` в критерии карточки (поле 3 строки пяти полей зоны Task) — в порядке появления,
 * затем `--gate` в порядке аргументов. Клауза `check:` идёт до ближайшей `;` или до конца критерия.
 * Конвенция зелёного: код возврата команды 0 = зелёный, не 0 = КРАСНЫЙ; stdout команды — факт для досье
 * (усечение 200 знаков, пустой stdout — stderr). Команда гейта гонится через shell платформы, cwd — корень.
 *
 * Исключения — строки с `exception:` в зоне History карточки, форма строки:
 *   exception: <что> — <причина> — <кто утвердил>
 * Красный гейт пропускается, только если строка называет гейт — адресом (gate-N, как в досье), командой
 * целиком или ключевым словом гейта (первый значимый токен команды: не интерпретатор и не флаг; для
 * `node путь/имя.cjs` — имя файла без расширения). Первое подходящее исключение побеждает. Правило
 * fail-closed: гейт не назван — гейт остаётся КРАСНЫМ и вердикт не зелёный.
 *
 * Досье (stdout): строка на каждый гейт — статус, адрес, команда, факт; у пропущенных — строка исключения
 * с пометкой; затем вердикт-остаток (критерий без клаузул `check:` — что скрипт решить не может), итог
 * («ГОТОВ» | «ГОТОВОСТИ НЕТ») и пути («довести гейт N» | «записать exception: в History»).
 *
 * Коды возврата: 0 — все гейты зелёные или пропущены по исключениям; 1 — есть КРАСНЫЙ без исключения
 * (ГОТОВОСТИ НЕТ); 2 — ошибка исполнения (нет карточки, нет пяти полей, нет гейтов).
 * Самопроверка — .forma/board/check-ready-sandbox.cjs (песочница + пробы подмены), в общий прогон её
 * ставит обёртка .forma/board/checks/check-ready.cjs.
 *
 * Модуль: require('./check-ready.cjs').runReady({ root, card, gates }) → { ready, gates, remainder, cardId, file }.
 * Часть ядра: одна для всех движков, следов проекта не несёт (запрет 16) — карточка, гейты и исключения
 * приходят аргументами и из зон Task/History карточки.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { cardFiles, zone } = require('../dashboard/lib/card.cjs');
const { normalize } = require('./run-in-card.cjs');

const FACT_LIMIT = 200;
const STATUS_RU = { green: 'зелёный', red: 'КРАСНЫЙ', skipped: 'пропущен по записанному исключению' };

const err = (msg) => Object.assign(new Error(msg), { exitCode: 2 });

// --- разбор карточки ---------------------------------------------------------------------

/** Строка пяти полей зоны Task (kind|delivers|criterion|budget|next); нет или полей не пять — null. */
function fiveFields(text) {
  const m = String(text).replace(/\r\n/g, '\n').match(/^## Task\s*\n\s*(\d+ · .+)$/m);
  if (!m) return null;
  const parts = m[1].split('|').map((s) => s.trim());
  return parts.length === 5 ? parts : null;
}

/** Критерий — поле 3 строки пяти полей; карточка без пяти полей — null (ошибка исполнения). */
function criterionOf(text) {
  const f = fiveFields(text);
  return f ? f[2] : null;
}

/** Клаузулы `check:` критерия — до ближайшей `;` или конца критерия, в порядке появления. */
function checkClauses(criterion) {
  const out = [];
  const re = /check:\s*([^;]+)/g;
  let m;
  while ((m = re.exec(String(criterion))) !== null) out.push(m[1].trim());
  return out.filter(Boolean);
}

/** Вердикт-остаток — критерий без клаузул `check:`: то, что скрипт решить не может. */
function remainderOf(criterion) {
  return String(criterion).replace(/check:\s*[^;]+;?/g, '')
    .split(';').map((s) => s.trim()).filter(Boolean).join('; ');
}

/** Строки-исключения зоны History: любые строки с `exception:` — { line, text (после «exception:») }. */
function exceptionsOf(text) {
  const body = zone(String(text).replace(/\r\n/g, '\n'), 'history');
  const out = [];
  for (const line of body.split('\n')) {
    const i = line.toLowerCase().indexOf('exception:');
    if (i >= 0) out.push({ line: line.trim(), text: line.slice(i + 'exception:'.length).trim() });
  }
  return out;
}

// --- сопоставление гейта и исключения ------------------------------------------------------

/** Ключевое слово гейта — первый значимый токен команды (не интерпретатор, не флаг), имя файла без расширения. */
const INTERPRETERS = new Set(['node', 'npm', 'npx', 'pnpm', 'yarn', 'deno', 'bun',
  'python', 'python3', 'sh', 'bash', 'cmd', 'powershell', 'pwsh']);

function gateKeyword(cmd) {
  for (const tok of String(cmd).trim().split(/\s+/)) {
    if (tok.startsWith('-')) continue;
    const bare = tok.replace(/^["']|["']$/g, '');
    if (INTERPRETERS.has(bare.toLowerCase())) continue;
    return bare.split(/[\\/]/).pop().replace(/\.(cjs|mjs|js|py|sh|bat|cmd)$/i, '').toLowerCase();
  }
  return '';
}

const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordBounded = (kw) => (/^\w/.test(kw) ? '\\b' : '') + escapeRx(kw) + (/\w$/.test(kw) ? '\\b' : '');

/** Исключение для гейта — первое из History, назвавшее гейт адресом (gate-N), командой или ключевым словом. */
function exceptionFor(gate, exceptions) {
  const kw = gateKeyword(gate.cmd);
  for (const e of exceptions) {
    let tier = null;
    if (new RegExp('\\bgate-' + gate.num + '\\b', 'i').test(e.line)) tier = 'gate-' + gate.num;
    else if (gate.cmd && e.line.includes(gate.cmd)) tier = 'команда гейта';
    else if (kw && new RegExp(wordBounded(kw), 'i').test(e.line)) tier = 'ключевое слово «' + kw + '»';
    if (tier) return { ...e, tier };
  }
  return null;
}

// --- гейты ---------------------------------------------------------------------------------

/** Один гейт: команда через shell платформы, cwd — корень. Факт — stdout (пуст — stderr), усечённый. */
function runGate(cmd, cwd) {
  const r = spawnSync(String(cmd), { shell: true, cwd, encoding: 'utf8' });
  const raw = String(r.stdout || r.stderr || '').replace(/\s+/g, ' ').trim();
  return {
    code: r.status == null ? -1 : r.status,
    fact: raw.length > FACT_LIMIT ? raw.slice(0, FACT_LIMIT) + '…' : raw,
    spawnError: r.error ? String(r.error.message || r.error) : null,
  };
}

/**
 * Прогон готовности: `ready` — все гейты зелёные или пропущены по записанным исключениям.
 * Ошибка исполнения (нет карточки/пяти полей/гейтов) — Error с .exitCode = 2, ничего не решено.
 */
function runReady({ root, card, gates: cliGates = [] }) {
  if (!root) throw err('check-ready: нет корня доски — передайте --root');
  const id = normalize(card) || String(card || '').trim().replace(/\.md$/, '');
  if (!id) throw err(`check-ready: "${card}" — не код карточки (ожидается NNN, card-NNN или имя карточки)`);
  const files = cardFiles(root, (n) => n === id + '.md' || n.startsWith(id + '-') && n.endsWith('.md'));
  if (!files.length) throw err(`check-ready: карточки ${id} нет на доске`);
  const file = files[0];
  const text = fs.readFileSync(file, 'utf8');
  const criterion = criterionOf(text);
  if (criterion == null) throw err(`check-ready: ${path.basename(file)} — зона Task не держит строку пяти полей (kind|delivers|criterion|budget|next)`);
  const clauseGates = checkClauses(criterion);
  const argGates = (Array.isArray(cliGates) ? cliGates : [cliGates]).filter(Boolean).map(String);
  if (!clauseGates.length && !argGates.length) throw err(`check-ready: ${id} — гейтов нет: клаузул \`check:\` в критерии нет и --gate не передан`);
  const exceptions = exceptionsOf(text);
  const gates = [...clauseGates, ...argGates].map((cmd, i) => {
    const gate = { num: i + 1, src: i < clauseGates.length ? 'check:' : '--gate', cmd };
    const { code, fact, spawnError } = runGate(cmd, root);
    gate.code = code;
    gate.fact = fact || (spawnError ? 'запуск не удался: ' + spawnError : '');
    gate.exc = code === 0 ? null : exceptionFor(gate, exceptions);
    gate.status = code === 0 ? 'green' : gate.exc ? 'skipped' : 'red';
    return gate;
  });
  return { ready: gates.every((g) => g.status !== 'red'), gates, remainder: remainderOf(criterion), criterion, cardId: id, file };
}

/** Досье фактов — строки для stdout: гейты с адресами и фактами, вердикт-остаток, итог и пути. */
function dossier(res) {
  const L = [`досье готовности: ${res.cardId} (${path.basename(res.file)})`];
  for (const g of res.gates) {
    L.push(`  гейт ${g.num} (${g.src}) [${STATUS_RU[g.status]}] \`${g.cmd}\` — код ${g.code}${g.fact ? ', факт: ' + g.fact : ''}`);
    if (g.exc) L.push(`    исключение: ${g.exc.text} (совпало по: ${g.exc.tier}; строка History: «${g.exc.line}»)`);
  }
  if (res.remainder) L.push(`остаток вердикта (скрипт решить не может): ${res.remainder}`);
  const reds = res.gates.filter((g) => g.status === 'red');
  const skips = res.gates.filter((g) => g.status === 'skipped');
  L.push(res.ready
    ? 'итог: ГОТОВ' + (skips.length ? ` (гейт ${skips.map((g) => g.num).join(', ')} — по записанному исключению)` : '')
    : 'итог: ГОТОВОСТИ НЕТ');
  if (!res.ready) {
    L.push(`пути: довести гейт ${reds.map((g) => g.num).join(', ')}; или записать в History карточки строку`);
    L.push('  `exception: <что> — <причина> — <кто утвердил>`, назвав гейт: gate-N (как в досье), команду целиком или ключевое слово гейта');
  } else if (skips.length) {
    L.push('пути: исключения записаны в History; остаток вердикта — на приёмку');
  } else {
    L.push('пути: —');
  }
  return L;
}

// --- CLI -----------------------------------------------------------------------------------

const HELP = [
  'check-ready — судья готовности карточки по гейтам критерия (без модельных вызовов).',
  '',
  '  node .forma/board/check-ready.cjs card-NNN [--gate "<команда>"] [--root <каталог>]',
  '  (аргумент карточки — NNN, card-NNN или полное имя карточки на доске)',
  '  node .forma/board/check-ready.cjs --help',
  '',
  'Гейты: клаузулы `check:` в критерии карточки (поле 3 строки пяти полей зоны Task), в порядке появления,',
  'затем --gate в порядке аргументов. Клауза `check:` идёт до ближайшей `;` или до конца критерия.',
  'Конвенция зелёного: код возврата команды 0 = зелёный, не 0 = КРАСНЫЙ; stdout команды — факт для досье',
  '(усечение ' + FACT_LIMIT + ' знаков, пустой stdout — stderr). Команда гейта гонится через shell платформы, cwd — корень.',
  '',
  'Исключения — строки с `exception:` в зоне History карточки, форма строки:',
  '  exception: <что> — <причина> — <кто утвердил>',
  'Красный гейт пропускается, только если строка называет гейт — адресом (gate-N, как в досье), командой',
  'целиком или ключевым словом гейта (первый значимый токен команды: не интерпретатор и не флаг; для',
  '`node путь/имя.cjs` — имя файла без расширения). Первое подходящее исключение побеждает. Правило',
  'fail-closed: гейт не назван — гейт остаётся КРАСНЫМ.',
  '',
  'Досье (stdout): строка на каждый гейт — статус, адрес, команда, факт; у пропущенных — строка исключения',
  'с пометкой; затем вердикт-остаток (критерий без клаузул `check:` — что скрипт решить не может), итог и',
  'пути («довести гейт N» | «записать exception: в History»).',
  '',
  'Коды возврата: 0 — все гейты зелёные или пропущены по исключениям; 1 — есть КРАСНЫЙ без исключения',
  '(ГОТОВОСТИ НЕТ); 2 — ошибка исполнения (нет карточки, нет пяти полей, нет гейтов).',
].join('\n');

function main(argv) {
  const args = argv.slice(2);
  if (args.includes('--help')) { console.log(HELP); process.exit(0); }
  const gates = [];
  let card = null, root = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--gate') { if (args[++i] == null) { console.error('check-ready: --gate без команды'); process.exit(2); } gates.push(args[i]); continue; }
    if (a === '--root') { if (args[++i] == null) { console.error('check-ready: --root без каталога'); process.exit(2); } root = args[i]; continue; }
    if (a.startsWith('--')) { console.error(`check-ready: "${a}" — нет такого флага`); process.exit(2); }
    if (card == null) card = a;
    else { console.error('check-ready: больше одного кода карточки'); process.exit(2); }
  }
  if (card == null) { console.error(HELP); process.exit(2); }
  if (root == null) root = path.resolve(__dirname, '..', '..');
  try {
    const res = runReady({ root, card, gates });
    for (const l of dossier(res)) console.log(l);
    process.exit(res.ready ? 0 : 1);
  } catch (e) {
    console.error(e.message);
    process.exit(e.exitCode || 2);
  }
}

if (require.main === module) main(process.argv);
module.exports = { runReady, dossier, fiveFields, criterionOf, checkClauses, remainderOf, exceptionsOf, gateKeyword, exceptionFor, runGate };
