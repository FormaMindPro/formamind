#!/usr/bin/env node
'use strict';

/**
 * law-shrink - the gate of the shrunk law: the mechanics of the rules is held by scripts and hooks, the law itself
 * is held by addresses. It checks four things, code 0 - only if all are green:
 *   1) the size of AGENTS.md is strictly less than the baseline; the baseline is read from .forma/living/checks.json
 *      (the key lawShrink.baselineBytes) - the checker's body carries no project facts (prohibition 16),
 *      the baseline is measured before the edits and written once;
 *   2) all the prohibition numbers 1-18 are present in §5 - the addresses the role files reference;
 *   3) the headings of §1-§7 are present;
 *   4) every file/script named by AGENTS.md in backticks (a name without a path, .md/.cjs/.sh/.json)
 *      exists on disk - a light recheck of the law-pointers logic: the index of names is built over
 *      the root, .forma and the engine mirrors (directories with agents/run.md); .devtool and project are not
 *      in the index - the law must not rest on cards and project material.
 *
 *   node .forma/board/checks/law-shrink.cjs [--root <dir>]
 *   node .forma/board/checks/law-shrink.cjs --selftest
 *
 * Exit codes: 0 - everything green; 1 - there is a red; 2 - a runtime error (no law or no baseline).
 * Module: require('./law-shrink.cjs').runLawShrink({ root }) → { ok, code, lines }.
 * Self-check - `--selftest`: probes in the OS temp directory; a small dummy law with all the addresses
 * gives green, a subtracted prohibition number - a red.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const i18n = require('../../i18n/index.cjs');
const msg = (key, params) => i18n.message(key, params, 'ru');

const LAW = 'AGENTS.md';
const BASELINE_KEY = 'lawShrink.baselineBytes';
const PROHIBITIONS = 18;
const SECTIONS = 7;

// Not pointer files: the root files of the protocol and the project (the law does not check itself
// and its root neighbors), engine rules of the form `<engine>-<digit>.md`.
const NOT_FILE = new Set(['PROJECT.md', 'JOURNAL.md', 'GOAL.md', 'CLAUDE.md', 'AGENTS.md', 'GEMINI.md', 'README.md', 'ECONOMY.md', 'ROUTES.md']);
const ENGINE_RULE_RE = /^[a-z]+-\d+\.md$/;
// What does not enter the index of names: dependencies and changeable zones.
const WALK_SKIP = new Set(['node_modules', '.git', '.cache', '.devtool', 'project']);

/** File/script names in the law's backticks (a name without a path). */
function pointers(text) {
  const out = new Set();
  for (const m of text.matchAll(/`([^`\s/]+\.(?:md|cjs|sh|json))`/g)) {
    const n = m[1];
    if (NOT_FILE.has(n) || ENGINE_RULE_RE.test(n)) continue;
    out.add(n);
  }
  return [...out].sort();
}

/** Text of the `## N.` section - from its heading to the next `## ` heading. */
function section(text, n) {
  const m = new RegExp(`^## ${n}\\.`, 'm').exec(text);
  if (!m) return null;
  const from = m.index;
  const next = text.slice(from + 1).match(/^## \d+\./m);
  return next ? text.slice(from, from + 1 + next.index) : text.slice(from);
}

/** Index of file names: the root (files), .forma and the engine mirrors (recursively). */
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
  if (!fs.existsSync(lawPath)) return { ok: false, code: 2, lines: [{ ok: false, fact: msg('board.law-shrink.law_missing', { law: LAW }) }] };
  const checksPath = path.join(root, '.forma', 'living', 'checks.json');
  let baseline = null;
  if (fs.existsSync(checksPath)) {
    try { baseline = JSON.parse(fs.readFileSync(checksPath, 'utf8'))[BASELINE_KEY]; } catch { baseline = null; }
  }
  if (!Number.isFinite(baseline)) {
    return { ok: false, code: 2, lines: [{ ok: false, fact: msg('board.law-shrink.baseline_missing', { rel: path.relative(root, checksPath), key: BASELINE_KEY }) }] };
  }
  const text = fs.readFileSync(lawPath, 'utf8');
  const bytes = Buffer.byteLength(text);
  const lines = [];
  let red = 0;

  if (bytes < baseline) lines.push({ ok: true, fact: msg('board.law-shrink.bytes_ok', { law: LAW, bytes, baseline, delta: baseline - bytes }) });
  else { red += 1; lines.push({ ok: false, fact: msg('board.law-shrink.bytes_red', { law: LAW, bytes, baseline }) }); }

  const s5 = section(text, 5);
  if (!s5) { red += 1; lines.push({ ok: false, fact: msg('board.law-shrink.no_s5') }); }
  else {
    const missing = [];
    for (let n = 1; n <= PROHIBITIONS; n++) if (!new RegExp(`^${n}\\. `, 'm').test(s5)) missing.push(n);
    if (missing.length) { red += 1; lines.push({ ok: false, fact: msg('board.law-shrink.prohibitions_missing', { missing: missing.join(', ') }) }); }
    else lines.push({ ok: true, fact: msg('board.law-shrink.prohibitions_ok', { n: PROHIBITIONS }) });
  }

  const noHead = [];
  for (let n = 1; n <= SECTIONS; n++) if (!new RegExp(`^## ${n}\\.`, 'm').test(text)) noHead.push(n);
  if (noHead.length) { red += 1; lines.push({ ok: false, fact: msg('board.law-shrink.headers_missing', { missing: noHead.join(', §') }) }); }
  else lines.push({ ok: true, fact: msg('board.law-shrink.headers_ok', { n: SECTIONS }) });

  const idx = fileIndex(root);
  const named = pointers(text);
  const ghosts = named.filter((n) => !idx.has(n));
  if (ghosts.length) { red += 1; lines.push({ ok: false, fact: msg('board.law-shrink.ghosts', { ghosts: ghosts.join(', ') }) }); }
  else lines.push({ ok: true, fact: msg('board.law-shrink.pointers_ok', { n: named.length }) });

  return { ok: red === 0, code: red === 0 ? 0 : 1, lines };
}

function selftest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'law-shrink-'));
  try {
    const parts = [];
    for (let i = 1; i <= SECTIONS; i++) {
      parts.push(`## ${i}. Section ${i}`, '');
      if (i === 3) parts.push('Holder - `holder.cjs`; fields - `fields.md`.', '');
      if (i === 5) {
        parts.push('Rules:', '');
        for (let p = 1; p <= PROHIBITIONS; p++) parts.push(`${p}. Affirmative rule ${p}.`, '');
      }
    }
    const law = parts.join('\n');
    fs.writeFileSync(path.join(dir, LAW), law);
    fs.mkdirSync(path.join(dir, '.forma', 'living'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.forma', 'living', 'checks.json'), JSON.stringify({ [BASELINE_KEY]: Buffer.byteLength(law) + 1 }));
    fs.writeFileSync(path.join(dir, 'holder.cjs'), '// a dummy holder\n');
    fs.writeFileSync(path.join(dir, 'fields.md'), 'dummy fields\n');
    const green = runLawShrink({ root: dir });
    if (!green.ok) return { ok: false, note: msg('board.law-shrink.selftest_fixture_red', { facts: green.lines.filter((l) => !l.ok).map((l) => l.fact).join(' | ') }) };
    const broken = law.replace('7. Affirmative rule 7.\n', '');
    fs.writeFileSync(path.join(dir, LAW), broken);
    const red = runLawShrink({ root: dir });
    if (red.ok) return { ok: false, note: msg('board.law-shrink.selftest_not_caught') };
    return { ok: true, note: msg('board.law-shrink.selftest_ok', { fact: red.lines.find((l) => !l.ok).fact }), greenBytes: Buffer.byteLength(law) };
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
  console.log(r.ok ? msg('board.law-shrink.green') : msg('board.law-shrink.red'));
  process.exit(r.code);
}
