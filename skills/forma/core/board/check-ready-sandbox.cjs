#!/usr/bin/env node
'use strict';

/**
 * Самопроверка check-ready (гейты критерия, досье фактов, записанные исключения) — машинная, без модельных
 * вызовов. Песочница во временном каталоге: карточка с клаузулой `check:` в критерии проходит честный прогон
 * (зелёный гейт, код 0), затем пробы подмен: сломанный гейт без исключения не даёт зелёного (код 1),
 * исключение в History, назвавшее гейт (командой, адресом gate-N или ключевым словом), пропускает его
 * с явной пометкой в досье (код 0), исключение, гейт не назвавшее, не пропускает ничего (fail-closed),
 * нет карточки или гейтов — ошибка исполнения (код 2).
 *
 *   node .forma/board/check-ready-sandbox.cjs [--quiet]   — код 0 чисто, 1 провал
 *
 * Запускается прогоном check-board / sync-engines --check — обёртку ставит .forma/board/checks/check-ready.cjs.
 * Модуль: runSandbox() → { problems } — находки с адресами (проба, гейт, карточка песочницы).
 * Карточка, дата и команды песочницы — рантаймом, не литералами (запрет 16).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const TOOL = path.join(__dirname, 'check-ready.cjs');
const { runReady } = require('./check-ready.cjs');

const D = () => new Date().toISOString().slice(0, 10);   // дата песочницы — рантаймом, не литералом (запрет 16)
const NNN = String(Date.now()).slice(-3);                // номер карточки песочницы — рантаймом, не литералом (запрет 16)

const GREEN = 'node -e "process.exit(0)"';
const RED = 'node -e "process.exit(3)"';
const CARD = 'card-' + NNN + '-check-ready-sandbox';     // код песочницы собран: чистая зона, запрет 16

function cardFile(dir) { return path.join(dir, '.devtool', 'features', CARD + '.md'); }

/** Карточка песочницы: пять полей с клаузулой `check:` в критерии, History — со строками исключений, если заданы. */
function writeCard(dir, exceptionLines) {
  const text = [
    '---',
    'id: "' + CARD + '",',
    'status: "backlog"',
    'assignee: "Kit"',
    'epic: "0. Sandbox"',
    'labels: ["route-4"]',
    '---',
    '# ' + CARD + ' · sandbox',
    '',
    '## Task',
    NNN + ' · tooling | Sandbox deliverable exists | Sandbox gate passes; check: ' + GREEN + '; residual clause for the verdict remainder | 2 | Intent',
    '',
    '## Kit',
    '',
    '## History',
    '- `Kit`, ' + D() + ': stage kit — sandbox card.',
    ...(exceptionLines || []).map((l) => '- `Kit`, ' + D() + ': ' + l),
    '',
    '## Result',
    ''
  ].join('\n');
  fs.mkdirSync(path.dirname(cardFile(dir)), { recursive: true });
  fs.writeFileSync(cardFile(dir), text);
}

/** Прогон CLI в песочнице: { status, out } — для проверки кодов возврата и досье в stdout. */
function runCli(dir, extraArgs) {
  const r = spawnSync(process.execPath, [TOOL, CARD, '--root', dir, ...(extraArgs || [])], { encoding: 'utf8' });
  return { status: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
}

/** Один прогон: честный прогон + пробы подмен. Возвращает находки (пустой список — самопроверка чиста). */
function runSandbox() {
  const problems = [];
  const push = (name, cond, detail) => { if (!cond) problems.push('проба «' + name + '»: ' + detail); };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-check-ready-'));
  try {
    // --- Честный прогон: клауза `check:` из критерия + зелёный --gate, код 0 ---------------------------
    writeCard(dir);
    const good = runReady({ root: dir, card: CARD, gates: [GREEN] });
    push('честный прогон', good.ready === true, 'вердикт не зелёный: ' + JSON.stringify(good.gates.map((g) => g.status)));
    push('честный прогон', good.gates.length === 2 && good.gates[0].src === 'check:' && good.gates[1].src === '--gate',
      'гейтов ' + good.gates.length + ' или источники не те: ' + good.gates.map((g) => g.src).join(','));
    push('честный прогон', good.gates.every((g) => g.status === 'green' && g.code === 0), 'гейт не зелёный: ' + JSON.stringify(good.gates.map((g) => [g.num, g.status, g.code])));
    push('честный прогон', good.remainder.includes('residual clause'), 'вердикт-остаток потерян: «' + good.remainder + '»');
    const cli = runCli(dir, ['--gate', GREEN]);
    push('честный прогон', cli.status === 0 && cli.out.includes('итог: ГОТОВ'), 'код ' + cli.status + ', вывод без «итог: ГОТОВ»');

    // --- Пробы подмены: каждая обязана быть поймана с адресом ------------------------------------------
    // 1. Сломанный гейт без исключения — fail-closed: не зелёный, код 1.
    writeCard(dir);
    const red = runReady({ root: dir, card: CARD, gates: [RED] });
    push('сломанный гейт', red.ready === false && red.gates[1].status === 'red', 'сломанный гейт дал: ready=' + red.ready + ', статус ' + red.gates[1].status);
    push('сломанный гейт', red.gates[1].num === 2, 'адрес потерян: номер гейта ' + red.gates[1].num);
    const cliRed = runCli(dir, ['--gate', RED]);
    push('сломанный гейт', cliRed.status === 1 && cliRed.out.includes('ГОТОВОСТИ НЕТ') && cliRed.out.includes('довести гейт 2'), 'код ' + cliRed.status + ' — сломанный гейт дал зелёного');

    // 2. Исключение, назвавшее гейт командой, — пропуск с явной пометкой, код 0.
    writeCard(dir, ['exception: ' + RED + ' — разрешено в песочнице — песочница-человек']);
    const skip = runReady({ root: dir, card: CARD, gates: [RED] });
    push('исключение по команде', skip.ready === true && skip.gates[1].status === 'skipped' && skip.gates[1].exc, 'исключение не пропустило: ready=' + skip.ready + ', статус ' + skip.gates[1].status);
    push('исключение по команде', skip.gates[1].exc.tier === 'команда гейта', 'совпадение не по команде: ' + (skip.gates[1].exc || {}).tier);
    const cliSkip = runCli(dir, ['--gate', RED]);
    push('исключение по команде', cliSkip.status === 0 && cliSkip.out.includes('пропущен по записанному исключению') && cliSkip.out.includes('итог: ГОТОВ'), 'код ' + cliSkip.status + ' — пропуск без явной пометки в досье');

    // 3. Исключение, гейт не назвавшее, — fail-closed: ничего не пропускает.
    writeCard(dir, ['exception: всё разрешено — причина — никто']);
    const closed = runReady({ root: dir, card: CARD, gates: [RED] });
    push('исключение без адреса', closed.ready === false && closed.gates[1].status === 'red' && !closed.gates[1].exc, 'негодное исключение пропустило гейт: ready=' + closed.ready);
    push('исключение без адреса', runCli(dir, ['--gate', RED]).status === 1, 'код не 1 при негодном исключении');

    // 4. Исключение по адресу gate-N.
    writeCard(dir, ['exception: gate-2 разрешён — причина — кто утвердил']);
    const byAddr = runReady({ root: dir, card: CARD, gates: [RED] });
    push('исключение по адресу', byAddr.ready === true && byAddr.gates[1].status === 'skipped' && byAddr.gates[1].exc.tier === 'gate-2', 'адрес gate-2 не сработал: ' + JSON.stringify(byAddr.gates[1].exc));

    // 5. Исключение по ключевому слову гейта (первый значимый токен).
    writeCard(dir, ['exception: process.exit(3) разрешён — причина — кто утвердил']);
    const byKw = runReady({ root: dir, card: CARD, gates: [RED] });
    push('исключение по ключевому слову', byKw.ready === true && byKw.gates[1].exc && byKw.gates[1].exc.tier.includes('ключевое слово'), 'ключевое слово не сработало: ' + JSON.stringify(byKw.gates[1].exc));

    // 6. Ошибки исполнения — код 2: нет карточки; нет гейтов (критерий без клаузул `check:`).
    const cliNoCard = spawnSync(process.execPath, [TOOL, String(Number(NNN) + 1), '--root', dir], { encoding: 'utf8' });
    push('нет карточки', cliNoCard.status === 2, 'код ' + cliNoCard.status + ' вместо 2');
    fs.writeFileSync(cardFile(dir), fs.readFileSync(cardFile(dir), 'utf8').replace(/; check: [^;]+;/, ';'));
    let threw = null;
    try { runReady({ root: dir, card: CARD }); } catch (e) { threw = e.exitCode; }
    push('нет гейтов', threw === 2, 'прогон без гейтов дал ' + threw + ' вместо ошибки исполнения (код 2)');
    push('нет гейтов', runCli(dir).status === 2, 'код CLI не 2 при отсутствии гейтов');

    // 7. Пять полей сломаны — код 2.
    const text = fs.readFileSync(cardFile(dir), 'utf8');
    fs.writeFileSync(cardFile(dir), text.replace(/\n\d+ · tooling \| [^\n]+/, '\nbroken task line'));
    const badFive = runCli(dir, ['--gate', GREEN]);
    push('пять полей', badFive.status === 2, 'код ' + badFive.status + ' вместо 2 при сломанной строке пяти полей');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return { problems };
}

function main() {
  const quiet = process.argv.includes('--quiet');
  const { problems } = runSandbox();
  if (quiet) { console.log(problems.length ? 'check-ready-sandbox: ' + problems.length + ' находок' : 'check-ready-sandbox: чисто'); process.exit(problems.length ? 1 : 0); }
  if (problems.length) {
    for (const p of problems) console.error(p);
    console.error('check-ready-sandbox: ' + problems.length + ' находок, самопроверка не пройдена');
    process.exit(1);
  }
  console.log('check-ready-sandbox: честный прогон чист, 6 проб подмены пойманы с адресом, коды 0/1/2 сходятся');
  process.exit(0);
}

if (require.main === module) main();
module.exports = { runSandbox };
