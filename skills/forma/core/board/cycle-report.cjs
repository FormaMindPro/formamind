#!/usr/bin/env node
'use strict';

/**
 * cycle-report - the cycle summary for the Core verdict, one file instead of scanning the board
 * (AGENTS.md §7: the cycle is judged by Core on the cycle's cards together).
 *
 *   node .forma/board/cycle-report.cjs --label <goal-label> [--label ...] [--cards <code[,code...]>] [--cards ...]
 *                                       [--root <dir>] [--out <file>] [--stdout]
 *   node .forma/board/cycle-report.cjs --help
 *
 * Selection: the cards carrying any of the --label values in their frontmatter labels and/or the named
 * codes (--cards, repeatable, comma-separated; a full code "card-NNN-slug" or a short "card-NNN" resolved
 * fail-closed - an ambiguous short code is refused with the candidate list). Both the live board and done/
 * are read: at the verdict the cycle's cards may already be closed. Nothing named - nothing reported.
 *
 * Per card: the five fields of the Task zone (kind | delivers | criterion | budget | next), the last stage
 * line of History ("stage <key>" - node, date and note as written), the gate statuses: every `check:` clause
 * of the criterion runs through check-ready.cjs (a red gate skipped by a recorded exception is marked).
 * The spend lines (AGENTS.md §3) of the cycle are summed per node by the shared parser (spend-line.cjs,
 * the same one tally.cjs and cycle-metrics.cjs read) - nothing is re-parsed here.
 *
 * Output: markdown to stdout; with --out <file> the file carries the report and the console keeps only a
 * confirmation line; with --stdout the file and the console both carry the full markdown.
 * Exit codes: 0 - the report is built; 1 - the selection matched no card; 2 - usage or read error.
 *
 * Module: require('./cycle-report.cjs') -> { selectCards, spendByNode, buildReport, lastStage, main }.
 * Part of the core: one file for all engines, no project traces (prohibition 16); the visible labels come
 * from the i18n dictionary (English keys, en+ru values), the project language picks the values printed.
 */

const fs = require('fs');
const path = require('path');
const { makeCli } = require('../dashboard/lib/cli.cjs');
const { cardFiles, labelsOf, zone } = require('../dashboard/lib/card.cjs');
const { toEnglish, SPEND_SOURCE, toInt, outTokens } = require('../dashboard/spend-line.cjs');
const { fiveFields, runReady } = require('./check-ready.cjs');
const i18n = require('../i18n/index.cjs');

const err = (msg) => Object.assign(new Error(msg), { exitCode: 2 });

const HELP = [
  'cycle-report - the cycle summary for the Core verdict, one file (AGENTS.md §7).',
  '',
  '  node .forma/board/cycle-report.cjs --label <goal-label> [--label ...] [--cards <code[,code...]>] [--cards ...]',
  '                                      [--root <dir>] [--out <file>] [--stdout]',
  '  node .forma/board/cycle-report.cjs --help',
  '',
  'Selection: the cards carrying any of the --label values in their frontmatter labels and/or the named',
  'codes (--cards, repeatable, comma-separated; a full code "card-NNN-slug" or a short "card-NNN"; an',
  'ambiguous short code is refused with the candidate list). The live board and done/ are both read.',
  'Nothing named - nothing reported.',
  '',
  'Per card: the five fields of the Task zone, the last stage line of History, the gate statuses',
  '(check-ready.cjs runs every `check:` clause of the criterion). The spend lines of the cycle are',
  'summed per node by the shared parser spend-line.cjs.',
  '',
  'Output: markdown to stdout; --out <file> writes the file and keeps a confirmation line on stdout;',
  '--stdout prints the full markdown even when --out is given.',
  '',
  'Exit codes: 0 - the report is built; 1 - the selection matched no card; 2 - usage or read error.',
].join('\n');

const FLAGS = ['label', 'cards', 'out', 'stdout', 'root', 'help'];
const VALUE_FLAGS = ['label', 'cards', 'out', 'root'];

// The five fields of the Task zone (AGENTS.md §6), in the order of the line kind|delivers|criterion|budget|next.
const FIELD_KEYS = ['kind', 'delivers', 'criterion', 'budget', 'next'];

// A spend line of the History zone (AGENTS.md §3): the same shape tally.cjs reads, anchored to a list item.
const SPEND_LINE_RE = new RegExp('^-\\s*' + SPEND_SOURCE + '—\\s*(.*)$', 'i');

// A stage line: `- `Node`, YYYY-MM-DD: stage <key> — <note>`; the key - the closed list of route-stage.cjs.
const STAGE_LINE_RE = /^-\s*`(\w+)`,\s*(\d{4}-\d{2}-\d{2}):\s*stage\s+(\S+)(?:\s*—\s*(.*))?$/;

/** The last stage line of the History zone, as written (without the list dash); no stage line - null. */
function lastStage(text) {
  let last = null;
  for (const l of zone(String(text), 'history').split('\n')) {
    const s = l.trim();
    if (STAGE_LINE_RE.test(s)) last = s.replace(/^-+\s*/, '');
  }
  return last;
}

/**
 * The cycle selection: the cards carrying any of `labels` in frontmatter and/or the named `codes`.
 * Codes: a full code is the exact file name; a short card-NNN matches by prefix and must be unique.
 * Both the live board and done/ are read. A missing or ambiguous code - Error, exit code 2.
 * Returns [{ id, file }] sorted by code.
 */
function selectCards(root, labels, codes) {
  const picked = new Map();
  const wanted = (labels || []).filter(Boolean);
  if (wanted.length) {
    for (const file of cardFiles(root)) {
      if (wanted.some((l) => labelsOf(fs.readFileSync(file, 'utf8')).includes(l))) {
        picked.set(path.basename(file, '.md'), file);
      }
    }
  }
  for (const raw of (codes || []).filter(Boolean)) {
    const id = String(raw).trim().replace(/\.md$/, '');
    if (!id) continue;
    const cands = cardFiles(root, (n) => n === id + '.md' || (n.startsWith(id + '-') && n.endsWith('.md')));
    const ids = [...new Set(cands.map((f) => path.basename(f, '.md')))];
    if (ids.length > 1) throw err(`"${id}" is an ambiguous code, candidates (name the full code):\n  ${cands.map((f) => f).join('\n  ')}`);
    if (!ids.length) throw err(`card "${id}" is not on the board`);
    picked.set(ids[0], cands[0]);
  }
  return [...picked.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([id, file]) => ({ id, file }));
}

/** The spend lines of the cycle summed per node: { attempts, tokens, out, s } each; unknown-token lines counted apart. */
function spendByNode(cards) {
  const byNode = {};
  let unknownLines = 0;
  for (const { file } of cards) {
    for (const raw of zone(fs.readFileSync(file, 'utf8'), 'history').split('\n')) {
      const line = toEnglish(raw);
      const m = SPEND_LINE_RE.exec(line);
      if (!m) continue;
      const rec = byNode[m[1]] || (byNode[m[1]] = { attempts: 0, tokens: 0, out: 0, s: 0 });
      rec.attempts++;
      if (m[3] === 'unknown') unknownLines++;
      else rec.tokens += toInt(m[3]);
      const out = outTokens(line);
      if (out != null) rec.out += out;
      if (m[5] != null && m[5] !== 'unknown') rec.s += toInt(m[5]);
    }
  }
  return { byNode, unknownLines };
}

/** The gates of one card through check-ready.cjs: statuses and the verdict; an execution failure is reported, not hidden. */
function gatesOf(root, cardId) {
  try {
    const res = runReady({ root, card: cardId, gates: [] });
    return { gates: res.gates, ready: res.ready, error: null };
  } catch (e) {
    return { gates: [], ready: false, error: String((e && e.message) || e) };
  }
}

function gatesLines(g, msg) {
  const L = [];
  for (const gate of g.gates) L.push(`- gate-${gate.num}: ${msg('board.cycle-report.gate_' + gate.status)} — \`${gate.cmd}\``);
  if (g.error) L.push(`- ${msg('board.cycle-report.gates')}: ${msg('board.cycle-report.gate_error', { msg: g.error })}`);
  else L.push(`- ${msg('board.cycle-report.gates')}: ${g.ready ? msg('board.cycle-report.ready') : msg('board.cycle-report.not_ready')}`);
  return L;
}

/** One card of the report: the five fields, the last stage line, the gate statuses. */
function cardSection(id, text, gates, msg) {
  const L = [`## ${id}`, ''];
  const fields = fiveFields(text);
  if (fields) {
    L.push(`| ${msg('board.cycle-report.field')} | ${msg('board.cycle-report.value')} |`, '| --- | --- |');
    FIELD_KEYS.forEach((k, i) => L.push(`| ${msg('board.cycle-report.field_' + k)} | ${fields[i]} |`));
  } else {
    L.push(`- ${msg('board.cycle-report.no_fields')}`);
  }
  const stage = lastStage(text);
  if (stage) L.push(`- ${msg('board.cycle-report.stage')}: ${stage}`);
  L.push(...gatesLines(gates, msg));
  return L.join('\n');
}

/** Thousands with a space separator - the same shape the spend lines write numbers with. */
const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** The spend table: a row per node, the total row, the unknown-token footnote. */
function spendSection(spend, msg) {
  const L = [`## ${msg('board.cycle-report.spend')}`, '',
    `| ${msg('board.cycle-report.node')} | ${msg('board.cycle-report.attempts')} | ${msg('board.cycle-report.tokens')} | ${msg('board.cycle-report.out')} | ${msg('board.cycle-report.secs')} |`,
    '| --- | --- | --- | --- | --- |'];
  const total = { attempts: 0, tokens: 0, out: 0, s: 0 };
  for (const node of Object.keys(spend.byNode).sort()) {
    const r = spend.byNode[node];
    for (const k of Object.keys(total)) total[k] += r[k];
    L.push(`| \`${node}\` | ${r.attempts} | ${fmt(r.tokens)} | ${r.out ? fmt(r.out) : '-'} | ${r.s ? fmt(r.s) : '-'} |`);
  }
  L.push(`| ${msg('board.cycle-report.total')} | ${total.attempts} | ${fmt(total.tokens)} | ${total.out ? fmt(total.out) : '-'} | ${total.s ? fmt(total.s) : '-'} |`);
  if (spend.unknownLines) L.push('', `- ${msg('board.cycle-report.unknown', { n: spend.unknownLines })}`);
  return L;
}

/** The whole report: the title with the date, the selection line, a section per card, the spend table. */
function buildReport(root, cards, msg, sel) {
  const L = [`# ${msg('board.cycle-report.title')} — ${new Date().toISOString().slice(0, 10)}`, ''];
  const parts = [];
  if (sel.labels.length) parts.push(`${msg('board.cycle-report.labels')}: ${sel.labels.join(', ')}`);
  if (sel.codes.length) parts.push(`${msg('board.cycle-report.codes')}: ${sel.codes.join(', ')}`);
  if (parts.length) L.push(`- ${parts.join(' — ')}`, '');
  for (const { id, file } of cards) {
    L.push(cardSection(id, fs.readFileSync(file, 'utf8'), gatesOf(root, id), msg), '');
  }
  L.push(...spendSection(spendByNode(cards), msg));
  return L.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n';
}

function main(argv) {
  const cli = makeCli((argv || process.argv).slice(2));
  const die = cli.die('cycle-report');
  // Strict argv: a known value-flag consumes its next word; a free word or an "--name=value" form is a usage error,
  // not something to be silently dropped.
  for (let i = 0; i < cli.argv.length; i++) {
    const tok = cli.argv[i];
    if (!tok.startsWith('--')) die(`unexpected argument "${tok}" (${FLAGS.map((f) => '--' + f).join(' ')})`);
    const name = tok.slice(2).split('=')[0];
    if (!FLAGS.includes(name) || tok.includes('=')) die(`unknown flag "${tok}" (${FLAGS.map((f) => '--' + f).join(' ')})`);
    if (VALUE_FLAGS.includes(name) && cli.argv[i + 1] != null && !cli.argv[i + 1].startsWith('--')) i++;
  }
  if (cli.flag('help')) { console.log(HELP); return 0; }
  const root = path.resolve(cli.arg('root') || path.resolve(__dirname, '..', '..'));
  const msg = (code, params) => i18n.message(code, params, i18n.projectLang(root));
  const flat = (name) => cli.values(name).flatMap((v) => String(v || '').split(',')).map((s) => s.trim()).filter(Boolean);
  const labels = flat('label');
  const codes = flat('cards');
  if (!labels.length && !codes.length) die(msg('board.cycle-report.usage_select'));
  const out = cli.arg('out');
  if (cli.argv.includes('--out') && out == null) die(msg('board.cycle-report.usage_out'));
  let cards;
  try {
    cards = selectCards(root, labels, codes);
  } catch (e) {
    die(e.message);
  }
  if (!cards.length) { console.error('cycle-report: ' + msg('board.cycle-report.no_cards')); return 1; }
  const md = buildReport(root, cards, msg, { labels, codes });
  if (out) {
    try {
      fs.writeFileSync(path.resolve(out), md, 'utf8');
    } catch (e) {
      die(`--out: ${e.message}`);
    }
    if (!cli.flag('stdout')) {
      console.log('ok: ' + msg('board.cycle-report.written', { file: path.resolve(out), n: cards.length }));
      return 0;
    }
  }
  console.log(md);
  return 0;
}

if (require.main === module) {
  const code = main(process.argv);
  if (code) process.exit(code);
}
module.exports = { selectCards, spendByNode, buildReport, lastStage, gatesOf, main };
