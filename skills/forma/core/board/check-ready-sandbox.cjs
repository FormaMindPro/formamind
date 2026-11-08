#!/usr/bin/env node
'use strict';

/**
 * The self-check of check-ready (the criterion's gates, the fact dossier, the recorded exceptions) - machine-made, no model
 * calls. A sandbox in a temp directory: a card with a `check:` clause in the criterion goes through an honest run
 * (a green gate, code 0), then the tamper probes: a broken gate without an exception gives no green (code 1),
 * an exception in History that named the gate (by the command, by the address gate-N or by the keyword) skips it
 * with an explicit mark in the dossier (code 0), an exception that named no gate skips nothing (fail-closed),
 * no card or no gates - a runtime error (code 2).
 *
 *   node .forma/board/check-ready-sandbox.cjs [--quiet]   — code 0 clean, 1 failed
 *
 * Runs by the check-board pass / sync-engines --check — the wrapper is .forma/board/checks/check-ready.cjs.
 * Module: runSandbox() → { problems } — findings with addresses (the probe, the gate, the sandbox card).
 * The card, the date and the commands of the sandbox - by the runtime, not by literals (prohibition 16).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const i18n = require('../i18n/index.cjs');
const TOOL = path.join(__dirname, 'check-ready.cjs');
const { runReady } = require('./check-ready.cjs');

const msg = (key, params) => i18n.message(key, params, 'ru');

const D = () => new Date().toISOString().slice(0, 10);   // the sandbox date - by the runtime, not a literal (prohibition 16)
const NNN = String(Date.now()).slice(-3);                // the sandbox card number - by the runtime, not a literal (prohibition 16)

const GREEN = 'node -e "process.exit(0)"';
const RED = 'node -e "process.exit(3)"';
const CARD = 'card-' + NNN + '-check-ready-sandbox';     // the sandbox code assembled: a clean zone, prohibition 16

function cardFile(dir) { return path.join(dir, '.devtool', 'features', CARD + '.md'); }

/** The sandbox card: five fields with a `check:` clause in the criterion, History - with the exception lines, if given. */
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

/** A CLI run in the sandbox: { status, out } - for checking the exit codes and the dossier in stdout. */
function runCli(dir, extraArgs) {
  const r = spawnSync(process.execPath, [TOOL, CARD, '--root', dir, ...(extraArgs || [])], { encoding: 'utf8' });
  return { status: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
}

/** One run: the honest run + the tamper probes. Returns the findings (an empty list - the self-check is clean). */
function runSandbox() {
  const problems = [];
  const push = (name, cond, detail) => { if (!cond) problems.push(msg('board.check-ready-sandbox.problem', { name, detail })); };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-check-ready-'));
  try {
    // --- The honest run: the `check:` clause from the criterion + a green --gate, code 0 ----------------
    writeCard(dir);
    const good = runReady({ root: dir, card: CARD, gates: [GREEN] });
    push('honest run', good.ready === true, 'the verdict is not green: ' + JSON.stringify(good.gates.map((g) => g.status)));
    push('honest run', good.gates.length === 2 && good.gates[0].src === 'check:' && good.gates[1].src === '--gate',
      good.gates.length + ' gates or wrong sources: ' + good.gates.map((g) => g.src).join(','));
    push('honest run', good.gates.every((g) => g.status === 'green' && g.code === 0), 'a gate is not green: ' + JSON.stringify(good.gates.map((g) => [g.num, g.status, g.code])));
    push('honest run', good.remainder.includes('residual clause'), 'the verdict remainder lost: "' + good.remainder + '"');
    const cli = runCli(dir, ['--gate', GREEN]);
    push('honest run', cli.status === 0 && cli.out.includes(msg('board.check-ready.verdict_ready')), 'code ' + cli.status + ', the output has no "' + msg('board.check-ready.verdict_ready') + '"');

    // --- The tamper probes: each must be caught with an address -----------------------------------------
    // 1. A broken gate without an exception - fail-closed: not green, code 1.
    writeCard(dir);
    const red = runReady({ root: dir, card: CARD, gates: [RED] });
    push('broken gate', red.ready === false && red.gates[1].status === 'red', 'the broken gate gave: ready=' + red.ready + ', status ' + red.gates[1].status);
    push('broken gate', red.gates[1].num === 2, 'the address lost: gate number ' + red.gates[1].num);
    const cliRed = runCli(dir, ['--gate', RED]);
    push('broken gate', cliRed.status === 1 && cliRed.out.includes(msg('board.check-ready.verdict_not_ready')) && cliRed.out.includes(msg('board.check-ready.path_fix', { list: '2' })), 'code ' + cliRed.status + ' — the broken gate gave a green');

    // 2. An exception that named the gate by the command - a skip with an explicit mark, code 0.
    writeCard(dir, ['exception: ' + RED + ' — allowed in the sandbox — sandbox-human']);
    const skip = runReady({ root: dir, card: CARD, gates: [RED] });
    push('exception by command', skip.ready === true && skip.gates[1].status === 'skipped' && skip.gates[1].exc, 'the exception did not skip: ready=' + skip.ready + ', status ' + skip.gates[1].status);
    push('exception by command', skip.gates[1].exc.tier === msg('board.check-ready.tier_cmd'), 'the match is not by the command: ' + (skip.gates[1].exc || {}).tier);
    const cliSkip = runCli(dir, ['--gate', RED]);
    push('exception by command', cliSkip.status === 0 && cliSkip.out.includes(msg('board.check-ready.status_skipped')) && cliSkip.out.includes(msg('board.check-ready.verdict_ready')), 'code ' + cliSkip.status + ' — a skip without an explicit mark in the dossier');

    // 3. An exception that named no gate - fail-closed: skips nothing.
    writeCard(dir, ['exception: everything is allowed — a reason — nobody']);
    const closed = runReady({ root: dir, card: CARD, gates: [RED] });
    push('exception without an address', closed.ready === false && closed.gates[1].status === 'red' && !closed.gates[1].exc, 'an unfit exception skipped the gate: ready=' + closed.ready);
    push('exception without an address', runCli(dir, ['--gate', RED]).status === 1, 'the code is not 1 with an unfit exception');

    // 4. An exception by the address gate-N.
    writeCard(dir, ['exception: gate-2 is allowed — a reason — who approved']);
    const byAddr = runReady({ root: dir, card: CARD, gates: [RED] });
    push('exception by address', byAddr.ready === true && byAddr.gates[1].status === 'skipped' && byAddr.gates[1].exc.tier === 'gate-2', 'the address gate-2 did not work: ' + JSON.stringify(byAddr.gates[1].exc));

    // 5. An exception by the gate's keyword (the first meaningful token).
    writeCard(dir, ['exception: process.exit(3) is allowed — a reason — who approved']);
    const byKw = runReady({ root: dir, card: CARD, gates: [RED] });
    push('exception by keyword', byKw.ready === true && byKw.gates[1].exc && String(byKw.gates[1].exc.tier).includes('process.exit(3)'), 'the keyword did not work: ' + JSON.stringify(byKw.gates[1].exc));

    // 6. Runtime errors - code 2: no card; no gates (a criterion without `check:` clauses).
    const cliNoCard = spawnSync(process.execPath, [TOOL, String(Number(NNN) + 1), '--root', dir], { encoding: 'utf8' });
    push('no card', cliNoCard.status === 2, 'code ' + cliNoCard.status + ' instead of 2');
    fs.writeFileSync(cardFile(dir), fs.readFileSync(cardFile(dir), 'utf8').replace(/; check: [^;]+;/, ';'));
    let threw = null;
    try { runReady({ root: dir, card: CARD }); } catch (e) { threw = e.exitCode; }
    push('no gates', threw === 2, 'a run without gates gave ' + threw + ' instead of a runtime error (code 2)');
    push('no gates', runCli(dir).status === 2, 'the CLI code is not 2 with the gates absent');

    // 7. The five fields broken - code 2.
    const text = fs.readFileSync(cardFile(dir), 'utf8');
    fs.writeFileSync(cardFile(dir), text.replace(/\n\d+ · tooling \| [^\n]+/, '\nbroken task line'));
    const badFive = runCli(dir, ['--gate', GREEN]);
    push('five fields', badFive.status === 2, 'code ' + badFive.status + ' instead of 2 with a broken five-fields line');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return { problems };
}

function main() {
  const quiet = process.argv.includes('--quiet');
  const { problems } = runSandbox();
  if (quiet) { console.log(problems.length ? msg('board.check-ready-sandbox.quiet_red', { n: problems.length }) : msg('board.check-ready-sandbox.quiet_green')); process.exit(problems.length ? 1 : 0); }
  if (problems.length) {
    for (const p of problems) console.error(p);
    console.error(msg('board.check-ready-sandbox.red', { n: problems.length }));
    process.exit(1);
  }
  console.log(msg('board.check-ready-sandbox.green'));
  process.exit(0);
}

if (require.main === module) main();
module.exports = { runSandbox };
