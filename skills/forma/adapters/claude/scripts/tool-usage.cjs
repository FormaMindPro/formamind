#!/usr/bin/env node
// The tool-log summary by nodes.
// Sources: .forma/dashboard/tool-usage.log (written by the hook .claude/hooks/tool-usage.sh)
//          .claude/agents/*.md - the role's declared arsenal, from the frontmatter, not from memory.
//          .devtool/features/**/*.md - the call lines: `agent_id` -> the card and its epic.
//
// The summary's value is not in what was used but in what was carried in vain: a declared
// tool costs tokens on every step of a call, used or not.
//
// The three states of the log are distinguished and named aloud (the card's sign 3):
//   - no file            - the hook never ran: not registered, not executable
//                          or crashes before the first record. That is a BREAKAGE, not silence.
//   - a file, no lines   - the hook is alive (it wrote the header), no calls happened.
//   - `!ERROR` lines     - the hook ran but broke itself; the reason is in the line.
//
// Run: node .claude/scripts/tool-usage.cjs
//
// Printed labels come from the core dictionary: English key in code, ru value as data.

const fs = require('fs');
const path = require('path');

// The spend line: the canon is English, the Russian shape of old lines is normalized
// by toEnglish() before parsing (spend-line.cjs).
const { toEnglish, CALL_ID_RE, CALL_ID_UNKNOWN_RE } = require('../../.forma/dashboard/spend-line.cjs');
const { cardFiles, frontmatterBlock } = require('../../.forma/dashboard/lib/card.cjs');
const i18n = require('../../.forma/i18n/index.cjs');
const msg = (code, params) => i18n.message(code, params, 'ru');

const ROOT = path.resolve(__dirname, '..', '..');
const LOG = path.join(ROOT, '.forma/dashboard', 'tool-usage.log');
const AGENTS_DIR = path.join(ROOT, '.claude', 'agents');

// --- the declared arsenal ----------------------------------------------------
// In the frontmatter a tool may be written with a template argument:
//   Bash(node .forma/dashboard/tally.cjs *)
// The log carries the bare tool_name - "Bash". The matching goes by the base
// name (before the bracket), while the full entry is kept to show it to the human.
function baseName(decl) {
  const i = decl.indexOf('(');
  return (i === -1 ? decl : decl.slice(0, i)).trim();
}

// The roles catalog and the log file are parameters with a default, not constants:
// not only this summary needs the parsing - the "Board" tab does too (.forma/dashboard/generate.js),
// which receives the project root from outside. Two different parsings of one and the same
// log would diverge one day - and diverge silently, so it lives here once.
function readDeclared(agentsDir = AGENTS_DIR) {
  const roles = new Map(); // name -> { file, decls: [...] }
  let files = [];
  try {
    files = fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md'));
  } catch {
    return roles;
  }
  for (const f of files) {
    const text = fs.readFileSync(path.join(agentsDir, f), 'utf8');
    const fm = frontmatterBlock(text);
    if (fm === null) continue;
    const nameM = fm.match(/^name:\s*(.+)$/m);
    const toolsM = fm.match(/^tools:\s*(.+)$/m);
    const name = (nameM ? nameM[1] : path.basename(f, '.md')).trim().replace(/^["']|["']$/g, '');
    const decls = toolsM
      ? splitTools(toolsM[1].trim())
      : null; // null = the tools field is absent, the role inherits everything
    roles.set(name.toLowerCase(), { file: f, decls });
  }
  return roles;
}

// Parsing a comma-separated list with an eye on the brackets: `Bash(node x, y)` - one element.
function splitTools(line) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of line) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// --- the log ----------------------------------------------------------------
// the hook's own error marker: the current one and the one older logs carry
// (\u041e\u0428\u0418\u0411\u041a\u0410 = the older ru error marker, a parse pattern held as escapes)
const HOOK_ERROR = ['!ERROR', '!\u041e\u0428\u0418\u0411\u041a\u0410'];

function readLog(logFile = LOG) {
  if (!fs.existsSync(logFile)) return { alive: false, rows: [], errors: [] };
  const lines = fs.readFileSync(logFile, 'utf8').split(/\r?\n/);
  const rows = [];
  const errors = [];
  for (const line of lines) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const parts = s.split('·').map((p) => p.trim());
    if (parts.length < 4) {
      errors.push({ ts: '?', reason: msg('tool-usage.unparsed_line', { line: s }) });
      continue;
    }
    const [ts, node, agentId, tool, file] = parts;   // the fifth field (path) is optional: old lines lack it
    if (HOOK_ERROR.includes(node)) errors.push({ ts, reason: tool });
    else rows.push({ ts, node, agentId, tool, file: file || null });
  }
  return { alive: true, rows, errors };
}

// --- the cut by cards --------------------------------------------------------
// The log knows `agent_id` and knows no cards; the card knows the task and knows no id.
// One field in the call line stitches them:
//   `Node`, YYYY-MM-DD: call, N tokens (R cache-read), T s, `<call id>` - ...
// Hence the whole meaning of the cut: one arms for the task's KIND, not for a node in general.
// The task's kind comes from the card's epic - the only common rubric the cards
// already have; inventing a second one for the summary's sake is unnecessary.

// The third state of the field (.forma/manual/en/03-protocol/ECONOMY.md, "The `unknown` marker"): the engine
// returned no identifier, and the node NAMED it - "`id unknown`". There is nothing to stitch such a call
// with, but it exists, and the cut must name it as a separate value: otherwise the unknown is
// indistinguishable from "the node was too lazy to set an id", and the gap dissolves into the cut without a trace.
// Anchoring to the start of a list item (CALL_ID_UNKNOWN_RE) - the rule: only a `## History` item is a spend
// record, not a quote of the same shape in prose. A quote must stay a quote.

function readCardIds() {
  const byId = new Map(); // agent_id -> { card, epic, node, date }
  const unknown = [];     // the calls whose identifier was named unknown

  for (const file of cardFiles(ROOT)) {
    const f = path.basename(file);
    const text = fs.readFileSync(file, 'utf8');
    const epicM = text.match(/^epic:\s*"?([^"\n]*)"?\s*$/m);
    const epic = epicM ? epicM[1].trim() : msg('tool-usage.no_epic');
    for (const line of text.split(/\r?\n/)) {
      const t = toEnglish(line.trim());
      const u = CALL_ID_UNKNOWN_RE.exec(t);
      if (u) {
        unknown.push({ card: f.replace(/\.md$/, ''), epic, node: u[1], date: u[2] });
        continue;
      }
      const m = CALL_ID_RE.exec(t);
      if (!m) continue;
      byId.set(m[3], { card: f.replace(/\.md$/, ''), epic, node: m[1], date: m[2] });
    }
  }
  byId.unknownIds = unknown;
  return byId;
}

const sumCounts = (counts) => [...counts.values()].reduce((a, b) => a + b, 0);
const bump = (counts, key) => counts.set(key, (counts.get(key) || 0) + 1);

// The log records -> by cards (`agent_id` found) and "orphans" (not found).
function groupByCard(rows, byId) {
  const matched = new Map();   // card -> { epic, nodes:Set, tools:Map }
  const orphan = new Map();    // "node · agent_id" -> Map(tool -> n)
  for (const r of rows) {
    const card = byId.get(r.agentId);
    if (card) {
      if (!matched.has(card.card)) matched.set(card.card, { epic: card.epic, nodes: new Set(), tools: new Map() });
      const e = matched.get(card.card);
      e.nodes.add(r.node);
      bump(e.tools, r.tool);
    } else {
      const key = `${r.node} · ${r.agentId}`;
      if (!orphan.has(key)) orphan.set(key, new Map());
      bump(orphan.get(key), r.tool);
    }
  }
  return { matched, orphan };
}

// The unknown is a counted value, not a gap: the call exists, there is nothing to stitch it with.
function printUnknownIds(unknownIds) {
  if (!unknownIds.length) return;
  console.log(msg('tool-usage.unknown_header', { count: unknownIds.length }));
  unknownIds.slice(0, 8).forEach((z) => console.log(`   ${z.card} · ${z.node} · ${z.date}`));
  if (unknownIds.length > 8) console.log(msg('tool-usage.unknown_more', { count: unknownIds.length - 8 }));
}

function printMatched(matched) {
  if (matched.size === 0) {
    console.log(msg('tool-usage.matched_none_1'));
    console.log(msg('tool-usage.matched_none_2'));
    return;
  }
  const byEpic = new Map();
  for (const [card, e] of matched) {
    if (!byEpic.has(e.epic)) byEpic.set(e.epic, []);
    byEpic.get(e.epic).push([card, e]);
  }
  for (const [epic, cards] of [...byEpic.entries()].sort()) {
    console.log(msg('tool-usage.epic_header', { epic }));
    for (const [card, e] of cards.sort((a, b) => a[0].localeCompare(b[0]))) {
      console.log(msg('tool-usage.card_line', { card, nodes: [...e.nodes].sort().join(', '), calls: sumCounts(e.tools) }));
      [...e.tools.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .forEach(([tool, n]) => console.log(`     ${String(n).padStart(5)} × ${tool}`));
    }
  }
}

function printOrphans(orphan) {
  if (!orphan.size) return;
  const total = [...orphan.values()].reduce((s, t) => s + sumCounts(t), 0);
  console.log(msg('tool-usage.orphan_header', { count: orphan.size, calls: total }));
  console.log(msg('tool-usage.orphan_note_1'));
  console.log(msg('tool-usage.orphan_note_2'));
  [...orphan.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(0, 20)
    .forEach(([key, t]) => {
      const top = [...t.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([tool, c]) => `${tool}×${c}`).join(', ');
      console.log(msg('tool-usage.orphan_line', { key, calls: sumCounts(t), top, more: t.size > 5 ? ', …' : '' }));
    });
  if (orphan.size > 20) console.log(msg('tool-usage.orphan_more', { count: orphan.size - 20 }));
}

function printCardCut(rows) {
  const byId = readCardIds();
  const { matched, orphan } = groupByCard(rows, byId);

  console.log(msg('tool-usage.cut_header'));
  console.log(msg('tool-usage.cut_stitch'));
  printUnknownIds(byId.unknownIds || []);
  printMatched(matched);
  printOrphans(orphan);
}

// --- the summary --------------------------------------------------------------
function printPreamble() {
  console.log(msg('tool-usage.preamble_1'));
  console.log(msg('tool-usage.preamble_2'));
  console.log(msg('tool-usage.preamble_note'));
}

function printLogMissing() {
  console.log(msg('tool-usage.log_missing'));
  process.exitCode = 1;
}

// The log records -> node -> tool -> how many attempts.
function countByNode(rows) {
  const byNode = new Map();
  for (const r of rows) {
    if (!byNode.has(r.node)) byNode.set(r.node, new Map());
    bump(byNode.get(r.node), r.tool);
  }
  return byNode;
}

// The files by nodes: how many different files each node touched (the lines with a path; old lines without a path do not count).
function printFilesByNode(rows) {
  const by = new Map();
  for (const r of rows) {
    if (!r.file) continue;
    if (!by.has(r.node)) by.set(r.node, new Set());
    by.get(r.node).add(r.file);
  }
  console.log('');
  if (!by.size) { console.log(msg('tool-usage.files_none')); return; }
  console.log(msg('tool-usage.files_header'));
  for (const [node, set] of [...by].sort((a, b) => b[1].size - a[1].size)) console.log(`  ${node}: ${set.size}`);
}

// The honest caveat: the log keeps the bare tool_name, so two records like
// Bash(...) with different arguments are indistinguishable to it.
function printAmbiguity(role, usedBases) {
  const ambiguous = role.decls.filter((d) => d.includes('(') && usedBases.has(baseName(d)));
  for (const b of new Set(ambiguous.map(baseName))) {
    const sameBase = role.decls.filter((d) => baseName(d) === b);
    if (sameBase.length > 1 || sameBase[0].includes('(')) {
      console.log(msg('tool-usage.ambiguity', { base: b, count: sameBase.length }));
    }
  }
}

// The declared against the applied: how much is carried in vain.
function printDeclared(role, used) {
  if (role.decls === null) {
    console.log(msg('tool-usage.declared_null_1'));
    console.log(msg('tool-usage.declared_null_2'));
    return;
  }
  const usedBases = new Set([...used.keys()]);
  const unused = role.decls.filter((d) => !usedBases.has(baseName(d)));
  console.log(msg('tool-usage.declared_line', {
    declared: role.decls.length, reached: role.decls.length - unused.length, vain: unused.length,
  }));
  if (unused.length === 0) console.log(msg('tool-usage.all_in_use'));
  else unused.forEach((d) => console.log(`     · ${d}`));
  printAmbiguity(role, usedBases);
}

function printNode(node, used, role) {
  const total = sumCounts(used);
  console.log(msg('tool-usage.node_header', {
    node, role: role ? `(.claude/agents/${role.file})` : msg('tool-usage.node_no_role'),
  }));
  if (total === 0) console.log(msg('tool-usage.node_no_calls'));
  else {
    console.log(msg('tool-usage.node_calls', { total }));
    [...used.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .forEach(([tool, n]) => console.log(`     ${String(n).padStart(5)} × ${tool}`));
  }
  if (role) printDeclared(role, used);
}

function printHookErrors(errors) {
  if (!errors.length) return;
  console.log(msg('tool-usage.hook_errors', { count: errors.length }));
  const byReason = new Map();
  for (const e of errors) bump(byReason, e.reason);
  [...byReason.entries()].forEach(([reason, n]) => console.log(`   ${String(n).padStart(5)} × ${reason}`));
  console.log(msg('tool-usage.hook_errors_note'));
  process.exitCode = 1;
}

function main() {
  const declared = readDeclared();
  const { alive, rows, errors } = readLog();

  printPreamble();
  if (!alive) { printLogMissing(); return; }
  if (rows.length === 0) {
    console.log(msg('tool-usage.empty_log_1'));
    console.log(msg('tool-usage.empty_log_2'));
  }

  const byNode = countByNode(rows);
  // nodes: first those with a role, then the session and the unknown ones
  const nodeNames = [...new Set([...byNode.keys(), ...declared.keys()])].sort();
  for (const node of nodeNames) printNode(node, byNode.get(node) || new Map(), declared.get(node));

  if (rows.length) printCardCut(rows);
  printFilesByNode(rows);
  printHookErrors(errors);
}

// The parsing is given away (the "Board" tab), the printing stays here. main() runs only
// when the file is run directly: a require from .forma/dashboard/generate.js prints nothing.
module.exports = { readDeclared, readLog, readCardIds, baseName, splitTools };

if (require.main === module) main();
