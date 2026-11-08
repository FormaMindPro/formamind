#!/usr/bin/env node
'use strict';

/**
 * goal-freeze - the version-freeze gate (prohibition 8, fail-closed): a committed change of a goal's GOAL.md
 * or of a project reference file is stopped, if no card's History on the board has a "human approved" line
 * naming this file or its goal's code. The frozen set is read dynamically: all GOAL.md files in
 * `project/goals/<goal>/` plus the reference files from the "Project references" table in
 * `project/config/PROJECT.md` (the "Where it lives" column; table lines are added without editing this checker).
 * No model calls; consumers - the pre-commit hook, the Intent node at the card check and check-board.
 *
 *   node .forma/board/checks/goal-freeze.cjs                      (the frozen set, code 0)
 *   node .forma/board/checks/goal-freeze.cjs --staged             (the list from `git diff --cached --name-only`)
 *   node .forma/board/checks/goal-freeze.cjs --files <path>…      (the listed count as staged; probes without the index)
 *   node .forma/board/checks/goal-freeze.cjs --selftest           (probes in the OS temp directory)
 *   node .forma/board/checks/goal-freeze.cjs --wired              (inclusion into the pre-commit chain; fixes the local hook)
 *
 * The `--staged`/`--files` verdict: every staged file of the frozen set must have a "human approved"
 * record (a line `- `Node`, YYYY-MM-DD: human approved — …` in the History zone of any card of the board,
 * including closed ones) naming the file or its goal's code; no record - RED and a message of which record
 * is required. The exception path - at the card's acceptance: an `exception:` line in History naming this
 * gate (the check-ready convention), it does not affect the commit. `--wired`: reads the actual commit hook
 * (`.git/hooks/pre-commit`) and the scripts it calls; if the chain does not call goal-freeze.cjs - it appends
 * the call into the local hook (outside git) and re-checks; no real commit is made.
 *
 * Exit codes: 0 - green; 1 - RED (a frozen file without an approval); 2 - a runtime error (no repository/
 * PROJECT.md, git unavailable, the self-probe mismatched).
 * Module: require('./goal-freeze.cjs').runGoalFreeze({ root, staged }) → { ready, lines, frozen }.
 * Part of the core: carries no project traces (prohibition 16).
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const i18n = require('../../i18n/index.cjs');
const { cardFiles, zone } = require('../../dashboard/lib/card.cjs');

const GOALS_REL = 'project/goals';
const GOAL_FILE = 'GOAL.md';
const PROJECT_REL = 'project/config/PROJECT.md';
// The references table's label - the dictionary label (data), not a literal of the code.
const REFERENCES_MARK = ((i18n.KEYS.labels.references || {}).ru || [])[0] || 'References';
const APPROVED_RE = /^- `[^`]+`, \d{4}-\d{2}-\d{2}: human approved\b/m;
const msg = (key, params) => i18n.message(key, params, 'ru');

const err = (m) => Object.assign(new Error(m), { exitCode: 2 });
const norm = (p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Goal code from a path `project/goals/<code>/GOAL.md`, else null. */
function goalCodeOf(relPath) {
  const m = norm(relPath).match(/^project\/goals\/([^/]+)\/GOAL\.md$/i);
  return m ? m[1] : null;
}

/** The frozen set: goals + references from the references table. */
function frozenFiles(root) {
  const files = [];
  const problems = [];
  const goalsDir = path.join(root, GOALS_REL);
  if (!fs.existsSync(goalsDir)) {
    problems.push(msg('board.goal-freeze.no_goals_dir', { rel: GOALS_REL }));
  } else {
    for (const e of fs.readdirSync(goalsDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!e.isDirectory()) continue;
      const rel = `${GOALS_REL}/${e.name}/${GOAL_FILE}`;
      if (fs.existsSync(path.join(root, rel))) files.push({ path: rel, code: e.name, source: msg('board.goal-freeze.src_goal') });
      else problems.push(msg('board.goal-freeze.goal_no_file', { rel, file: GOAL_FILE }));
    }
  }
  const pm = path.join(root, PROJECT_REL);
  if (!fs.existsSync(pm)) {
    problems.push(msg('board.goal-freeze.no_project', { rel: PROJECT_REL, mark: REFERENCES_MARK }));
  } else {
    const refs = referenceFiles(fs.readFileSync(pm, 'utf8'));
    for (const rel of refs) files.push({ path: rel, code: null, source: msg('board.goal-freeze.src_ref') });
  }
  return { files, problems };
}

/** Reference files: table lines under the references heading, the "Where it lives" column. */
function referenceFiles(projectMdText) {
  const lines = String(projectMdText).split(/\r?\n/);
  const head = lines.findIndex((l) => l.includes(REFERENCES_MARK));
  if (head < 0) return [];
  let i = head + 1;
  while (i < lines.length && !lines[i].trim()) i++; // empty lines between the heading and the table
  if (i >= lines.length || !lines[i].trim().startsWith('|')) return [];
  const out = [];
  for (; i < lines.length && lines[i].trim().startsWith('|'); i++) { // the table runs to the first line outside `|`
    const cells = lines[i].split('|').slice(1, -1).map((c) => c.trim().replace(/^`|`$/g, ''));
    if (cells.length < 2) continue;
    const rel = norm(cells[1]);
    if (!rel || !/[./]/.test(rel) || /^[-: ]+$/.test(rel)) continue; // the header and the separator - not a path
    out.push(rel);
  }
  return out;
}

/** "human approved" lines in a card's History; no zones - empty. */
function approvedLines(cardText) {
  const history = zone(cardText, 'history');
  if (!history) return [];
  return history.split(/\r?\n/).filter((l) => APPROVED_RE.test(l));
}

/** Does the approval line name this file (a path) or its goal's code. */
function lineNames(line, file) {
  const hay = line.replace(/\\/g, '/').toLowerCase();
  if (hay.includes(file.path.toLowerCase())) return true;
  if (file.code) {
    const re = new RegExp('(^|[^\\p{L}\\p{N}_-])' + escapeRe(file.code.toLowerCase()) + '([^\\p{L}\\p{N}_-]|$)', 'u');
    if (re.test(hay)) return true;
  }
  return false;
}

/** Search of an approval record over all the board's cards (including done/). */
function findApproval(root, file) {
  for (const card of cardFiles(root)) {
    let text;
    try { text = fs.readFileSync(card, 'utf8'); } catch { continue; }
    const hit = approvedLines(text).find((l) => lineNames(l, file));
    if (hit) return { card: path.basename(card), line: hit.trim() };
  }
  return null;
}

/** Core of the gate: the staged list against the frozen set and the approval records. */
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
      lines.push({ status: 'green', fact: msg('board.goal-freeze.not_frozen', { p }) });
      continue;
    }
    frozenSeen += 1;
    const ok = findApproval(root, f);
    if (ok) lines.push({ status: 'green', fact: msg('board.goal-freeze.approved', { p, card: ok.card }) });
    else {
      red += 1;
      lines.push({
        status: 'red',
        fact: msg('board.goal-freeze.no_approval', { p, code: f.code ? ' ' + msg('board.goal-freeze.or_goal_code', { code: f.code }) : '' }),
      });
    }
  }
  if (!staged || staged.length === 0) lines.push({ status: 'info', fact: msg('board.goal-freeze.no_staged') });
  for (const p of problems) lines.push({ status: 'red', fact: p });
  return { ready: red === 0 && problems.length === 0, lines, frozen: files, frozenSeen };
}

/** The staged list from the git index (read-only). */
function stagedFromGit(root) {
  const r = spawnSync('git', ['diff', '--cached', '--name-only'], { cwd: root, encoding: 'utf8' });
  if (r.error || r.status !== 0) {
    throw err(msg('board.goal-freeze.git_unavailable', { tail: String(r.stderr || (r.error && r.error.message) || msg('board.goal-freeze.unknown_error')).trim() }));
  }
  return String(r.stdout || '').split(/\r?\n/).filter(Boolean);
}

// ---- --wired: inclusion into the pre-commit chain ------------------------------------------------

const WIRE_SNIPPET =
  '# forma: ' + msg('board.goal-freeze.wire_comment') + '\n' +
  'node .forma/board/checks/goal-freeze.cjs --staged || exit 1\n';
const HOOK_FALLBACK =
  '#!/bin/sh\n' +
  WIRE_SNIPPET +
  '# forma: ' + msg('board.goal-freeze.hook_fallback_comment') + '\n' +
  'exec node .forma/protocol/scripts/forma-commit.cjs --sync-staged\n';

/** Scripts the hook calls (`node …`/`exec …` lines with paths inside the repository). */
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

/** Check (and fix) of the gate's inclusion into the pre-commit chain; no commit is made. */
function runWired(root) {
  root = root || process.cwd();
  if (!fs.existsSync(path.join(root, '.git'))) throw err(msg('board.goal-freeze.not_git'));
  let state = chainHasWire(root);
  const lines = [];
  if (!state.wired) {
    if (!fs.existsSync(state.hook)) {
      fs.mkdirSync(path.dirname(state.hook), { recursive: true });
      fs.writeFileSync(state.hook, HOOK_FALLBACK);
      lines.push({ status: 'info', fact: msg('board.goal-freeze.hook_created') });
    } else if (!state.hookText.includes('goal-freeze.cjs')) {
      const nl = state.hookText.includes('\r\n') ? '\r\n' : '\n';
      const parts = state.hookText.split(/\r?\n/);
      const at = parts[0].startsWith('#!') ? 1 : 0; // right behind the shebang, before the rest of the chain
      parts.splice(at, 0, ...WIRE_SNIPPET.trimEnd().split('\n'));
      fs.writeFileSync(state.hook, parts.join(nl));
      lines.push({ status: 'info', fact: msg('board.goal-freeze.hook_appended') });
    }
    try { fs.chmodSync(state.hook, 0o755); } catch { /* an FS without chmod - git will run the hook anyway */ }
    state = chainHasWire(root);
  }
  lines.push({ status: 'info', fact: msg('board.goal-freeze.hook_line', { hook: path.relative(root, state.hook), refs: state.refs.map((p) => path.relative(root, p)).join(', ') || msg('board.goal-freeze.no_refs') }) });
  if (!state.wired) {
    lines.push({ status: 'red', fact: msg('board.goal-freeze.not_wired') });
    return { ready: false, lines };
  }
  lines.push({ status: 'green', fact: msg('board.goal-freeze.wired') });
  return { ready: true, lines };
}

// ---- --selftest: probes in a temp directory -------------------------------------------------------

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
  // Fixture names - dynamic (prohibition 16): a card-NNN literal in a clean-zone source is caught by the trace check.
  const name = (k, slug) => '.devtool/features/card-' + (900 + k) + '-' + slug + '.md';
  try {
    writeTree(dir, {
      'project/goals/goal-alpha/GOAL.md': '# goal alpha\n',
      'project/goals/goal-beta/GOAL.md': '# goal beta\n',
      'project/goals/goal-gamma/GOAL.md': '# goal gamma\n',
      'project/config/PROJECT.md':
        '# configuration\n\n**' + REFERENCES_MARK + '**:\n\n| Reference | Where it lives | What it defines | Version today |\n|---|---|---|---|\n| Handbook | `docs/handbook.md` | domain rules | v1 |\n',
      'docs/handbook.md': '# reference\n',
    });
    // 1: a frozen goal without an approval - RED (fail-closed)
    const r1 = runGoalFreeze({ root: dir, staged: ['project/goals/goal-alpha/GOAL.md'] });
    check('a goal without an approval = RED', !r1.ready);
    // 2: foreign files - GREEN
    const r2 = runGoalFreeze({ root: dir, staged: ['src/other/file.txt', 'README.md'] });
    check('foreign files = GREEN', r2.ready);
    // 3: a "human approved" record with the file name - GREEN
    writeTree(dir, {
      [name(1, 'sample-approved')]:
        '# probe\n\n## History\n\n- `Intent`, ' + today + ': human approved — the edit of project/goals/goal-alpha/GOAL.md was approved by the human.\n',
    });
    const r3 = runGoalFreeze({ root: dir, staged: ['project/goals/goal-alpha/GOAL.md'] });
    check('a record with the file name = GREEN', r3.ready);
    // 4: a record by the goal's code - GREEN
    writeTree(dir, {
      [name(2, 'sample-code')]:
        '# probe\n\n## History\n\n- `Intent`, ' + today + ': human approved — the edit of the goal goal-beta was approved by the human.\n',
    });
    const r4 = runGoalFreeze({ root: dir, staged: ['project/goals/goal-beta/GOAL.md'] });
    check('a record by the goal code = GREEN', r4.ready);
    // 5: a reference from the table without an approval - RED
    const r5 = runGoalFreeze({ root: dir, staged: ['docs/handbook.md'] });
    check('a reference without an approval = RED', !r5.ready);
    // 6: a reference with a record - GREEN
    writeTree(dir, {
      [name(3, 'sample-ref')]:
        '# probe\n\n## History\n\n- `Intent`, ' + today + ': human approved — the edit of docs/handbook.md was approved by the human.\n',
    });
    const r6 = runGoalFreeze({ root: dir, staged: ['docs/handbook.md'] });
    check('a reference with a record = GREEN', r6.ready);
    // 7: a mention of a frozen file without the words "human approved" - RED (not every line counts)
    writeTree(dir, {
      [name(4, 'sample-mention')]:
        '# probe\n\n## History\n\n- `Intent`, ' + today + ': the frozen file project/goals/goal-gamma/GOAL.md was discussed, there was no approval.\n',
    });
    const r7 = runGoalFreeze({ root: dir, staged: ['project/goals/goal-gamma/GOAL.md'] });
    check('a mention without "human approved" = RED', !r7.ready);
    // 8: the set's composition is dynamic - 4 files (3 goals + 1 reference)
    const { frozen } = runGoalFreeze({ root: dir, staged: [] });
    check('the set composition: 3 goals + 1 reference from the table', frozen.length === 4);
    const failed = results.filter((r) => !r.ok);
    return {
      ok: failed.length === 0,
      note: failed.length
        ? msg('board.selftest.mismatch') + failed.map((r) => r.name).join('; ')
        : msg('board.goal-freeze.selftest_ok'),
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---- CLI ------------------------------------------------------------------------------------------

function printFrozen(root) {
  const { files, problems } = frozenFiles(root);
  console.log(msg('board.goal-freeze.frozen_list_header'));
  for (const f of files) console.log(`  ${f.path}${f.code ? ' (' + msg('board.goal-freeze.frozen_goal', { code: f.code }) + ')' : ' (' + msg('board.goal-freeze.frozen_ref', { mark: REFERENCES_MARK }) + ')'}`);
  console.log(msg('board.goal-freeze.total', { n: files.length, problems: problems.length ? '; ' + msg('board.push-verify-rule.problems') + problems.map((p) => '  - ' + p).join('\n') : '' }));
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
      console.log(r.ready ? msg('board.goal-freeze.cli_wired') : msg('board.goal-freeze.cli_not_wired'));
      process.exit(r.ready ? 0 : 1);
    }
    const fi = argv.indexOf('--files');
    let staged = null;
    if (fi >= 0) staged = argv.slice(fi + 1).filter((a) => !a.startsWith('--'));
    else if (argv.includes('--staged')) staged = stagedFromGit(root);
    else {
      const { files, problems } = printFrozen(root);
      if (problems.length) process.exit(2);
      console.log(msg('board.goal-freeze.cli_frozen_ok', { n: files.length }));
      process.exit(0);
    }
    const r = runGoalFreeze({ root, staged });
    for (const l of r.lines) console.log((l.status === 'green' ? '✓ ' : l.status === 'red' ? '✗ ' : '· ') + l.fact);
    const others = r.lines.filter((l) => l.status === 'green' && !l.fact.includes(msg('board.goal-freeze.frozen_marker'))).length;
    if (r.ready) console.log(msg('board.goal-freeze.cli_green', { n: r.frozenSeen, others }));
    else console.log(msg('board.goal-freeze.cli_red'));
    process.exit(r.ready ? 0 : 1);
  } catch (e) {
    console.error(msg('board.stop') + e.message);
    process.exit(e.exitCode || 2);
  }
}
