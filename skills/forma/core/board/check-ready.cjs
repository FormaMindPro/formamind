#!/usr/bin/env node
'use strict';

/**
 * check-ready - the judge of a card's readiness by the criterion's gates: the machine clauses are run, the fact
 * dossier is printed, the recorded exceptions skip a gate with an explicit mark. No model calls: the status -
 * by the exit code, the dossier - in stdout; consumers - the Intent/Core nodes and the wrapper in the check-board pass.
 *
 *   node .forma/board/check-ready.cjs card-NNN [--gate "<command>"] [--root <dir>]
 *   (the card argument - NNN, card-NNN or the full card name on the board)
 *   node .forma/board/check-ready.cjs --help
 *
 * Gates: the `check:` clauses in the card's criterion (field 3 of the five-fields line of the Task zone) - in the order of appearance,
 * then `--gate` in the order of the arguments. A `check:` clause runs to the nearest `;` or to the end of the criterion.
 * The green convention: the command's exit code 0 = green, not 0 = RED; the command's stdout - the fact for the dossier
 * (a truncation of 200 characters, an empty stdout - stderr). A gate's command runs through the platform's shell, cwd - the root.
 *
 * Exceptions - lines with `exception:` in the card's History zone, the line's form:
 *   exception: <what> — <why> — <who approved>
 * A red gate is skipped only if the line names the gate - by the address (gate-N, as in the dossier), by the whole
 * command or by the gate's keyword (the first meaningful token of the command: not an interpreter and not a flag; for
 * `node path/name.cjs` - the file name without the extension). The first fitting exception wins. The rule
 * fail-closed: the gate is not named - the gate stays RED and the verdict is not green.
 *
 * The dossier (stdout): a line per gate - the status, the address, the command, the fact; for the skipped - the exception line
 * with a mark; then the verdict remainder (a criterion without `check:` clauses - what the script cannot decide), the verdict
 * ("READY" | "NOT READY") and the paths ("bring gate N through" | "write an exception: into History").
 *
 * Exit codes: 0 - all gates green or skipped by exceptions; 1 - there is a RED without an exception
 * (NOT READY); 2 - a runtime error (no card, no five fields, no gates).
 * The self-check - .forma/board/check-ready-sandbox.cjs (the sandbox + the tamper probes); the wrapper
 * .forma/board/checks/check-ready.cjs puts it into the common pass.
 *
 * Module: require('./check-ready.cjs').runReady({ root, card, gates }) → { ready, gates, remainder, cardId, file }.
 * Part of the core: one for all engines, carries no project traces (prohibition 16) - the card, the gates and the exceptions
 * come by arguments and from the card's Task/History zones.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const i18n = require('../i18n/index.cjs');
const { cardFiles, zone } = require('../dashboard/lib/card.cjs');
const { normalize } = require('./run-in-card.cjs');

const FACT_LIMIT = 200;
// The status words - the dictionary (data), not literals of the code.
const STATUS = { green: () => i18n.message('board.check-ready.status_green', null, 'ru'), red: () => i18n.message('board.check-ready.status_red', null, 'ru'), skipped: () => i18n.message('board.check-ready.status_skipped', null, 'ru') };
const msg = (key, params) => i18n.message(key, params, 'ru');

const err = (m) => Object.assign(new Error(m), { exitCode: 2 });

// --- parsing the card ----------------------------------------------------------------------

/** The five-fields line of the Task zone (kind|delivers|criterion|budget|next); none or not five fields - null. */
function fiveFields(text) {
  const m = String(text).replace(/\r\n/g, '\n').match(/^## Task\s*\n\s*(\d+ · .+)$/m);
  if (!m) return null;
  const parts = m[1].split('|').map((s) => s.trim());
  return parts.length === 5 ? parts : null;
}

/** The criterion - field 3 of the five-fields line; a card without five fields - null (a runtime error). */
function criterionOf(text) {
  const f = fiveFields(text);
  return f ? f[2] : null;
}

/** The `check:` clauses of the criterion - to the nearest `;` or the end of the criterion, in the order of appearance. */
function checkClauses(criterion) {
  const out = [];
  const re = /check:\s*([^;]+)/g;
  let m;
  while ((m = re.exec(String(criterion))) !== null) out.push(m[1].trim());
  return out.filter(Boolean);
}

/** The verdict remainder - a criterion without `check:` clauses: what the script cannot decide. */
function remainderOf(criterion) {
  return String(criterion).replace(/check:\s*[^;]+;?/g, '')
    .split(';').map((s) => s.trim()).filter(Boolean).join('; ');
}

/** The exception lines of the History zone: any lines with `exception:` - { line, text (after "exception:") }. */
function exceptionsOf(text) {
  const body = zone(String(text).replace(/\r\n/g, '\n'), 'history');
  const out = [];
  for (const line of body.split('\n')) {
    const i = line.toLowerCase().indexOf('exception:');
    if (i >= 0) out.push({ line: line.trim(), text: line.slice(i + 'exception:'.length).trim() });
  }
  return out;
}

// --- matching a gate and an exception --------------------------------------------------------

/** The gate's keyword - the first meaningful token of the command (not an interpreter, not a flag), the file name without the extension. */
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

/** The exception for a gate - the first one from History that named the gate by the address (gate-N), by the command or by the keyword. */
function exceptionFor(gate, exceptions) {
  const kw = gateKeyword(gate.cmd);
  for (const e of exceptions) {
    let tier = null;
    if (new RegExp('\\bgate-' + gate.num + '\\b', 'i').test(e.line)) tier = 'gate-' + gate.num;
    else if (gate.cmd && e.line.includes(gate.cmd)) tier = msg('board.check-ready.tier_cmd');
    else if (kw && new RegExp(wordBounded(kw), 'i').test(e.line)) tier = msg('board.check-ready.tier_kw', { kw });
    if (tier) return { ...e, tier };
  }
  return null;
}

// --- gates ------------------------------------------------------------------------------------

/** One gate: the command through the platform's shell, cwd - the root. The fact - stdout (empty - stderr), truncated. */
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
 * The readiness run: `ready` - all gates green or skipped by the recorded exceptions.
 * A runtime error (no card/five fields/gates) - an Error with .exitCode = 2, nothing decided.
 */
function runReady({ root, card, gates: cliGates = [] }) {
  if (!root) throw err(msg('board.check-ready.err_no_root'));
  const id = normalize(card) || String(card || '').trim().replace(/\.md$/, '');
  if (!id) throw err(msg('board.check-ready.err_not_code', { card }));
  const files = cardFiles(root, (n) => n === id + '.md' || n.startsWith(id + '-') && n.endsWith('.md'));
  if (!files.length) throw err(msg('board.check-ready.err_no_card', { id }));
  const file = files[0];
  const text = fs.readFileSync(file, 'utf8');
  const criterion = criterionOf(text);
  if (criterion == null) throw err(msg('board.check-ready.err_no_five', { f: path.basename(file) }));
  const clauseGates = checkClauses(criterion);
  const argGates = (Array.isArray(cliGates) ? cliGates : [cliGates]).filter(Boolean).map(String);
  if (!clauseGates.length && !argGates.length) throw err(msg('board.check-ready.err_no_gates', { id }));
  const exceptions = exceptionsOf(text);
  const gates = [...clauseGates, ...argGates].map((cmd, i) => {
    const gate = { num: i + 1, src: i < clauseGates.length ? 'check:' : '--gate', cmd };
    const { code, fact, spawnError } = runGate(cmd, root);
    gate.code = code;
    gate.fact = fact || (spawnError ? msg('board.check-ready.spawn_failed', { why: spawnError }) : '');
    gate.exc = code === 0 ? null : exceptionFor(gate, exceptions);
    gate.status = code === 0 ? 'green' : gate.exc ? 'skipped' : 'red';
    return gate;
  });
  return { ready: gates.every((g) => g.status !== 'red'), gates, remainder: remainderOf(criterion), criterion, cardId: id, file };
}

/** The fact dossier - the lines for stdout: the gates with addresses and facts, the verdict remainder, the verdict and the paths. */
function dossier(res) {
  const L = [msg('board.check-ready.dossier_header', { id: res.cardId, f: path.basename(res.file) })];
  for (const g of res.gates) {
    L.push(msg('board.check-ready.dossier_gate', {
      num: g.num, src: g.src, status: STATUS[g.status](), cmd: g.cmd, code: g.code,
      fact: g.fact ? msg('board.check-ready.fact_part', { fact: g.fact }) : '',
    }));
    if (g.exc) L.push(msg('board.check-ready.dossier_exc', { text: g.exc.text, tier: g.exc.tier, line: g.exc.line }));
  }
  if (res.remainder) L.push(msg('board.check-ready.dossier_remainder', { remainder: res.remainder }));
  const reds = res.gates.filter((g) => g.status === 'red');
  const skips = res.gates.filter((g) => g.status === 'skipped');
  L.push(res.ready
    ? msg('board.check-ready.verdict_ready') + (skips.length ? msg('board.check-ready.verdict_ready_skips', { list: skips.map((g) => g.num).join(', ') }) : '')
    : msg('board.check-ready.verdict_not_ready'));
  if (!res.ready) {
    L.push(msg('board.check-ready.path_fix', { list: reds.map((g) => g.num).join(', ') }));
    L.push(msg('board.check-ready.path_exception'));
  } else if (skips.length) {
    L.push(msg('board.check-ready.path_skips'));
  } else {
    L.push(msg('board.check-ready.path_none'));
  }
  return L;
}

// --- CLI ---------------------------------------------------------------------------------------

function help() {
  return msg('board.check-ready.help', { limit: FACT_LIMIT });
}

function main(argv) {
  const args = argv.slice(2);
  if (args.includes('--help')) { console.log(help()); process.exit(0); }
  const gates = [];
  let card = null, root = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--gate') { if (args[++i] == null) { console.error(msg('board.check-ready.err_gate_no_cmd')); process.exit(2); } gates.push(args[i]); continue; }
    if (a === '--root') { if (args[++i] == null) { console.error(msg('board.check-ready.err_root_no_dir')); process.exit(2); } root = args[i]; continue; }
    if (a.startsWith('--')) { console.error(msg('board.check-ready.err_bad_flag', { a })); process.exit(2); }
    if (card == null) card = a;
    else { console.error(msg('board.check-ready.err_two_cards')); process.exit(2); }
  }
  if (card == null) { console.error(help()); process.exit(2); }
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
