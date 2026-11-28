#!/usr/bin/env node
'use strict';

/**
 * check-node-defaults.cjs - the reconciliation of a zone's declared node defaults.
 *
 * A zone declares its five nodes' defaults once: `nodeModels` of its `forma-adapter.cjs`. The zone's
 * §8 rule file carries the declared view of the same rows under the marker `k:<zone>.node_defaults`,
 * and the five node roles carry the same values in their frontmatter. The checker reads all three and
 * paints every divergence red, naming the zone, the node, the file and the line, and the expected value.
 *
 * Zones are discovered, not listed: `loadAdapters` of the core finds every `<dir>/forma-adapter.cjs`;
 * the rules file and the roles directory come from the adapter itself. No zone path, engine name or
 * model name is written here - the values are read. A zone without `nodeModels`, a rules file or a
 * roles directory is a named skip, not a failure.
 *
 *   node .claude/scripts/check-node-defaults.cjs --check [--root <dir>]
 *   node .claude/scripts/check-node-defaults.cjs --self-test
 *
 * --check       the live reconciliation. Output: `ok <zone>: 5 <nodes>` for a zone in agreement,
 *               `skip <zone>: <address> <absent>` for a zone without a declaration, and one line per
 *               divergence: `<zone> / <node> / <file>:<line> / <expected> <model> <effort>, <got> ...`.
 *               The last line: `check-node-defaults: <N> <zones>, 5 <nodes> - green: 0 | red: <K>`.
 *               Exit codes: 0 - green, 1 - red findings, 2 - no engine adapter or a bad call.
 * --self-test   a fixture project in the temp base (`FORMA_TEST_TMP`, else the OS temp): a synthetic
 *               zone with synthetic model names; baseline green, red on each of the three axes (a table
 *               cell, a `nodeModels` cell, a role header), green again after each restore. The live
 *               zones are never read; the fixture is removed on exit.
 * --root        the project the check reads; the self-test passes its fixture. A live call runs from
 *               the project root by itself.
 *
 * The template copy in the protocol clone is byte-identical and is not run in place.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');

// The output contract's words in the project language, kept as code point escapes (prohibition 19: the
// code file stays ASCII).
const RU = {
  nodes: '\u0443\u0437\u043b\u043e\u0432',
  zones: '\u0437\u043e\u043d',
  absent: '\u043e\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0443\u0435\u0442',
  expected: '\u043e\u0436\u0438\u0434\u0430\u043b\u043e\u0441\u044c',
  got: '\u043f\u043e\u043b\u0443\u0447\u0435\u043d\u043e',
  none: '\u043d\u0435\u0442',
};
const DASH = '\u2014';

/** The comparable form of a value: trimmed, wrapping ticks and quotes cut, inner spaces collapsed, lower case. */
const norm = (s) => String(s == null ? '' : s).trim().replace(/^[`'"]+|[`'"]+$/g, '').replace(/\s+/g, ' ').toLowerCase();

/** The first backticked token of a cell - a model cell may carry a tier note after it; no ticks - the cell itself. */
function firstTicked(cell) {
  const m = /`([^`]+)`/.exec(cell);
  return m ? m[1].trim() : String(cell).replace(/^[`'"]+|[`'"]+$/g, '').trim();
}

/** The cells of a markdown table row, the leading and trailing pipe cut. */
function cells(line) {
  const parts = String(line).trim().split('|');
  if (parts.length && parts[0].trim() === '') parts.shift();
  if (parts.length && parts[parts.length - 1].trim() === '') parts.pop();
  return parts.map((s) => s.trim());
}

/**
 * The table after the marker of a §8 file: `{ markerLine, tableLine, rows }`, lines 1-based; the scan
 * stops at the next heading. A row: `{ line, node, model, effort }`. The effort is the third cell, or
 * the `(effort X)` note of the model cell in a two-column table.
 */
function readTable(file, marker) {
  const lines = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n');
  const at = lines.findIndex((l) => l.includes(marker));
  if (at < 0) return { markerLine: null, tableLine: null, rows: [] };
  let head = null;
  for (let i = at + 1; i < lines.length; i += 1) {
    if (/^\s*\|/.test(lines[i])) { head = i; break; }
    if (/^#{1,6}\s/.test(lines[i])) break;
  }
  if (head == null) return { markerLine: at + 1, tableLine: null, rows: [] };
  const rows = [];
  let i = head + 1;
  if (i < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) i += 1;
  for (; i < lines.length && /^\s*\|/.test(lines[i]); i += 1) {
    const c = cells(lines[i]);
    if (c.length < 2) continue;
    const node = String(c[0]).replace(/`/g, '').trim();
    const model = firstTicked(c[1]);
    let effort = c.length > 2 ? firstTicked(c[2]) : '';
    if (!effort) {
      const note = /\(effort\s+([^)]+)\)/i.exec(c[1]);
      if (note) effort = note[1].trim();
    }
    rows.push({ line: i + 1, node, model, effort });
  }
  return { markerLine: at + 1, tableLine: head + 1, rows };
}

/** A role's frontmatter fields with their 1-based file lines: `{ model: {value,line}, effort: {value,line} }`. */
function readRole(file) {
  const lines = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n');
  const out = { model: { value: null, line: 1 }, effort: { value: null, line: 1 } };
  if (String(lines[0]).trim() !== '---') return out;
  let end = -1;
  for (let i = 1; i < lines.length; i += 1) if (lines[i].trim() === '---') { end = i; break; }
  if (end < 0) return out;
  for (let i = 1; i < end; i += 1) {
    for (const key of ['model', 'effort']) {
      const m = new RegExp('^' + key + ':\\s*(.+)$').exec(lines[i]);
      if (m) out[key] = { value: m[1].trim().replace(/^[`'"]+|[`'"]+$/g, ''), line: i + 1 };
    }
  }
  return out;
}

/** One zone's reconciliation: `{ lines, problems, nodes, skipped }`; the declaration is the expected value. */
function checkZone(root, engines, adapter) {
  const zone = engines.idOf(adapter);
  const nodeModels = adapter.nodeModels;
  const nodes = Object.keys(nodeModels);
  const rulesRel = typeof adapter.engineRulesFile === 'string' ? adapter.engineRulesFile : null;
  const rolesRel = typeof adapter.rolesDir === 'string' ? adapter.rolesDir : engines.sourcesOf(adapter).rolesDir;
  const rulesAbs = rulesRel ? engines.resolveRel(root, rulesRel) : null;
  const rolesAbs = rolesRel ? engines.resolveRel(root, rolesRel) : null;
  const dir = adapter.dir || '.' + zone;
  const address = !rulesRel ? `${dir}/forma-adapter.cjs engineRulesFile`
    : !rolesRel ? `${dir}/forma-adapter.cjs rolesDir`
      : !fs.existsSync(rulesAbs) ? rulesRel
        : !fs.existsSync(rolesAbs) ? rolesRel : null;
  if (address) return { lines: [`skip ${zone}: ${address} ${RU.absent}`], problems: [], nodes: nodes.length, skipped: true };

  const problems = [];
  const expectedOf = (decl) => `${decl.model} ${decl.effort}`;

  // Axis 1: the §8 table against the declaration.
  const table = readTable(rulesAbs, `k:${zone}.node_defaults`);
  if (table.markerLine == null) {
    problems.push(`${zone} / - / ${rulesRel}:1 / ${RU.expected} marker k:${zone}.node_defaults, ${RU.got} ${RU.none}`);
  } else if (table.tableLine == null) {
    problems.push(`${zone} / - / ${rulesRel}:${table.markerLine} / ${RU.expected} table after k:${zone}.node_defaults, ${RU.got} ${RU.none}`);
  } else {
    for (const node of nodes) {
      const decl = nodeModels[node];
      const row = table.rows.find((r) => norm(r.node) === norm(node));
      if (!row) {
        problems.push(`${zone} / ${node} / ${rulesRel}:${table.tableLine} / ${RU.expected} ${expectedOf(decl)}, ${RU.got} ${RU.none}`);
      } else if (norm(row.model) !== norm(decl.model) || norm(row.effort) !== norm(decl.effort)) {
        problems.push(`${zone} / ${node} / ${rulesRel}:${row.line} / ${RU.expected} ${expectedOf(decl)}, ${RU.got} ${row.model || RU.none} ${row.effort || RU.none}`);
      }
    }
  }

  // Axis 2: the five node roles' headers against the declaration.
  for (const node of nodes) {
    const decl = nodeModels[node];
    const roleRel = `${rolesRel}/${node.toLowerCase()}.md`;
    const roleAbs = path.join(root, ...roleRel.split('/'));
    if (!fs.existsSync(roleAbs)) {
      problems.push(`${zone} / ${node} / ${roleRel}:1 / ${RU.expected} ${expectedOf(decl)}, ${RU.got} ${RU.none}`);
      continue;
    }
    const h = readRole(roleAbs);
    if (norm(h.model.value) !== norm(decl.model) || norm(h.effort.value) !== norm(decl.effort)) {
      const line = norm(h.model.value) !== norm(decl.model) ? h.model.line : h.effort.line;
      problems.push(`${zone} / ${node} / ${roleRel}:${line} / ${RU.expected} ${expectedOf(decl)}, ${RU.got} ${h.model.value || RU.none} ${h.effort.value || RU.none}`);
    }
  }

  if (problems.length) return { lines: problems, problems, nodes: nodes.length, skipped: false };
  return { lines: [`ok ${zone}: ${nodes.length} ${RU.nodes}`], problems, nodes: nodes.length, skipped: false };
}

/** All discovered zones: `{ lines, red, zones, nodes, skipped, fatal }`. */
function checkAll(root, engines) {
  const adapters = engines.loadAdapters(root);
  if (!adapters.length) return { lines: [`error: no engine adapter under ${root}`], red: 0, zones: 0, nodes: 0, skipped: 0, fatal: true };
  const lines = [];
  let red = 0;
  let zones = 0;
  let nodes = 0;
  let skipped = 0;
  for (const adapter of adapters) {
    const zone = engines.idOf(adapter);
    if (!adapter.nodeModels || typeof adapter.nodeModels !== 'object' || Array.isArray(adapter.nodeModels)) {
      const dir = adapter.dir || '.' + zone;
      lines.push(`skip ${zone}: ${dir}/forma-adapter.cjs nodeModels ${RU.absent}`);
      skipped += 1;
      continue;
    }
    const res = checkZone(root, engines, adapter);
    lines.push(...res.lines);
    red += res.problems.length;
    if (!res.skipped) {
      zones += 1;
      nodes = Math.max(nodes, res.nodes);
    } else {
      skipped += 1;
    }
  }
  return { lines, red, zones, nodes, skipped, fatal: false };
}

/** The core engine boundary of this project, found by its path, not by an engine name. */
function enginesLib() {
  const found = ['.forma/dashboard/lib/engines.cjs', 'dashboard/lib/engines.cjs']
    .map((rel) => path.join(ROOT, rel))
    .find((abs) => fs.existsSync(abs));
  return found ? require(found) : null;
}

// --- the self-test -----------------------------------------------------------------------------

/** The temp base: `FORMA_TEST_TMP` when it is a live directory, else the OS temp directory. */
function tempBase() {
  const env = process.env.FORMA_TEST_TMP;
  try {
    if (env && fs.statSync(env).isDirectory()) return env;
  } catch { /* fall through */ }
  return os.tmpdir();
}

const WRITE = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

// The synthetic zone: node -> [model, effort]. The names are invented for the fixture only.
const FIXTURE = {
  Intent: ['synth-quasar-1', 'max'],
  Spec: ['synth-quasar-1', 'high'],
  Kit: ['synth-quasar-1', 'high'],
  Run: ['synth-quasar-1', 'low'],
  Core: ['synth-pulsar-2', 'low'],
};

/** A minimal project: an adapter, its §8 table under the marker, five role headers. */
function writeFixture(dir) {
  const declaration = Object.entries(FIXTURE)
    .map(([node, [model, effort]]) => `  ${node}: { model: '${model}', effort: '${effort}' },`).join('\n');
  WRITE(path.join(dir, '.fixture/forma-adapter.cjs'), `'use strict';
module.exports = {
  engine: 'fixture',
  id: 'fixture',
  nodeModels: {
${declaration}
  },
  engineRulesFile: '.fixture/rules/fixture-8.md',
  rolesDir: '.fixture/agents',
  sources: { rolesDir: '.fixture/agents' },
};
`);
  const rows = Object.entries(FIXTURE)
    .map(([node, [model, effort]]) => `| \`${node}\` | \`${model}\` | \`${effort}\` |`).join('\n');
  WRITE(path.join(dir, '.fixture/rules/fixture-8.md'), `# 8. Fixture engine

## Models per node

A synthetic zone: the declaration, its declared view and the role headers. <!-- k:fixture.node_defaults -->

| Node | Model | Effort |
| --- | --- | --- |
${rows}
`);
  for (const [node, [model, effort]] of Object.entries(FIXTURE)) {
    WRITE(path.join(dir, '.fixture/agents', node.toLowerCase() + '.md'), `---
name: ${node.toLowerCase()}
model: ${model}
effort: ${effort}
---
`);
  }
}

function selfTest() {
  const dir = fs.mkdtempSync(path.join(tempBase(), 'forma-node-defaults-'));
  const rules = '.fixture/rules/fixture-8.md';
  const adapter = '.fixture/forma-adapter.cjs';
  const core = '.fixture/agents/core.md';
  const saved = {};
  const read = (rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
  const save = (rel) => { saved[rel] = read(rel); };
  const restore = (rel) => fs.writeFileSync(path.join(dir, rel), saved[rel]);
  const run = () => spawnSync(process.execPath, [__filename, '--check', '--root', dir], { encoding: 'utf8' });
  let failures = 0;
  const expect = (label, r, code, needles) => {
    const text = `${r.stdout || ''}${r.stderr || ''}`;
    const bad = [];
    if (r.status !== code) bad.push(`exit ${r.status}, expected ${code}`);
    for (const needle of needles) if (!text.includes(needle)) bad.push(`missing: ${needle}`);
    if (bad.length) {
      failures += 1;
      console.log(`not ok  ${label} - ${bad.join('; ')}`);
      for (const line of text.trim().split('\n')) console.log('    ' + line);
    } else {
      console.log(`ok  ${label}`);
    }
  };
  try {
    writeFixture(dir);
    expect('baseline green', run(), 0, ['ok fixture: 5', 'green: 0']);

    save(rules);
    fs.writeFileSync(path.join(dir, rules), read(rules).replace('| `Run` | `synth-quasar-1` | `low` |', '| `Run` | `synth-gamma-3` | `low` |'));
    expect('table cell drift is red', run(), 1, [`fixture / Run / ${rules}:`, 'synth-quasar-1 low', 'synth-gamma-3']);
    restore(rules);
    expect('table cell restored', run(), 0, ['green: 0']);

    save(adapter);
    fs.writeFileSync(path.join(dir, adapter), read(adapter).replace("Run: { model: 'synth-quasar-1', effort: 'low' }", "Run: { model: 'synth-quasar-1', effort: 'high' }"));
    expect('nodeModels cell drift is red', run(), 1, [`fixture / Run / ${rules}:`, 'synth-quasar-1 high']);
    restore(adapter);
    expect('nodeModels cell restored', run(), 0, ['green: 0']);

    save(core);
    fs.writeFileSync(path.join(dir, core), read(core).replace('model: synth-pulsar-2', 'model: synth-gamma-3'));
    expect('role header drift is red', run(), 1, [`fixture / Core / ${core}:`, 'synth-pulsar-2 low', 'synth-gamma-3']);
    restore(core);
    expect('role header restored', run(), 0, ['green: 0']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (failures) {
    console.log(`check-node-defaults self-test: ${failures} failed`);
    process.exit(1);
  }
  console.log('check-node-defaults self-test: green');
  process.exit(0);
}

// --- the call ----------------------------------------------------------------------------------

function argValue(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) return selfTest();
  if (argv.length && !argv.includes('--check')) {
    console.error('usage: node check-node-defaults.cjs --check [--root <dir>] | --self-test');
    process.exit(2);
  }
  const engines = enginesLib();
  if (!engines) {
    console.error(`error: the core engine boundary not found under ${ROOT}`);
    process.exit(2);
  }
  const rootArg = argValue(argv, '--root');
  const res = checkAll(rootArg ? path.resolve(rootArg) : ROOT, engines);
  for (const line of res.lines) console.log(line);
  const verdict = res.red ? `red: ${res.red}` : 'green: 0';
  console.log(`check-node-defaults: ${res.zones} ${RU.zones}, ${res.nodes} ${RU.nodes} ${DASH} ${verdict}`);
  process.exit(res.fatal ? 2 : res.red ? 1 : 0);
}

if (require.main === module) main();

module.exports = { checkAll };
