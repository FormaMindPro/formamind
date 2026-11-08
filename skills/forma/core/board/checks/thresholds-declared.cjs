#!/usr/bin/env node
'use strict';

/**
 * thresholds-declared - the gate of the declared thresholds (the law §3, fail-closed): a start without the two
 * thresholds and the nine goals never happens, and every paid external service carries a per-cycle limit. The holder -
 * the declaration in `project/config/PROJECT.md` (check-ready is read-only, hence a declaration, not a re-ask):
 * (a) the thresholds section - a line with the key k:thresholds, and in its table the lines k:attempts
 * and k:volume with numbers; (b) the table of the nine goals - a line with the key k:epics, and in its table all
 * nine codes of the goal kinds (a protocol constant, the same one as in epics.cjs); (c) the paid service's
 * limit - in the k:routes table there is a line naming a per-cycle limit (the word "limit"
 * and a digit in one line). The concrete values of the thresholds and the limits, as well as the completeness
 * of the paid services set, - the human's verdict at acceptance; the probe judges the declaration, not the magnitude.
 *
 *   node .forma/board/checks/thresholds-declared.cjs --project [--root <dir>]  (a live PROJECT.md)
 *   node .forma/board/checks/thresholds-declared.cjs --selftest                (probes in the OS temp directory)
 *
 * Exit codes: 0 - GREEN (the declaration is complete); 1 - RED (one of the three is missing - named, by address);
 * 2 - a runtime error (PROJECT.md not found, the self-probe mismatched).
 * Module: require('./thresholds-declared.cjs') → { run, runProject, selftest } - a gate script without an id
 * (not a registry line): including it as a standing check in index.cjs - a separate decision of the accepting node;
 * by default the gate is called explicitly (--project).
 * Part of the core: carries no project traces (prohibition 16).
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const i18n = require('../../i18n/index.cjs');
const msg = (key, params) => i18n.message(key, params, 'ru');

const PROJECT_REL = 'project/config/PROJECT.md';

// Nine kinds of a goal: the code is language-independent, the PROJECT.md table is their only carrier.
const CODES = ['analytics', 'structure', 'protocol', 'resources', 'balance', 'discussion', 'channels', 'competencies', 'results'];

// The word naming a per-cycle limit in the routes table - labels of the dictionary, not literals of the code.
const LIMIT_RE = new RegExp('(?:' + i18n.alt('term.limit') + ')', 'i');

const err = (m) => Object.assign(new Error(m), { exitCode: 2 });

/** Table lines under the line carrying the key `key` (`<!-- k:key -->`): consecutive lines starting with `|`. */
function tableRowsAfter(lines, key) {
  const at = lines.findIndex((l) => l.includes('k:' + key));
  if (at < 0) return { at: -1, rows: [] };
  const rows = [];
  for (let i = at + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue; // empty lines between the heading and the table - skipped
    if (!t.startsWith('|')) break; // the table runs to the first line outside `|`
    rows.push(t);
  }
  return { at, rows };
}

/** The thresholds section: the key k:thresholds found, its table holds k:attempts and k:volume with numbers. */
function thresholdsProblems(lines) {
  const { rows } = tableRowsAfter(lines, 'thresholds');
  const problems = [];
  const need = ['attempts', 'volume'];
  for (const key of need) {
    const row = rows.find((r) => r.includes('k:' + key) && /\d/.test(r));
    if (!row) problems.push(`k:${key}`);
  }
  return problems;
}

/** The table of the nine goals: the key k:epics found, all nine kind codes stand as table lines. */
function goalsProblems(lines) {
  const { rows } = tableRowsAfter(lines, 'epics');
  const missing = CODES.filter((c) => !rows.some((r) => new RegExp('^\\|\\s*`' + c + '`\\s*\\|').test(r)));
  return missing;
}

/** The paid service's limit: the k:routes table has a line with a limit word and a digit. */
function limitProblems(lines) {
  const { rows } = tableRowsAfter(lines, 'routes');
  const ok = rows.some((r) => LIMIT_RE.test(r) && /\d/.test(r));
  return ok ? [] : ['k:routes'];
}

/** Core of the gate: PROJECT.md against the three declaration points; findings - with the address and the expectation. */
function runProject({ root } = {}) {
  root = root || process.cwd();
  const file = path.join(root, PROJECT_REL);
  if (!fs.existsSync(file)) throw err(msg('board.thresholds-declared.no_project', { rel: PROJECT_REL }));
  const lines = String(fs.readFileSync(file, 'utf8')).split(/\r?\n/);
  const linesOut = [];
  let red = 0;

  const th = thresholdsProblems(lines);
  if (th.length) {
    red += 1;
    linesOut.push({
      status: 'red',
      fact: msg('board.thresholds-declared.thresholds_red', { rel: PROJECT_REL, keys: th.join(', ') }),
    });
  } else {
    linesOut.push({ status: 'green', fact: msg('board.thresholds-declared.thresholds_ok', { rel: PROJECT_REL }) });
  }

  const missing = goalsProblems(lines);
  if (missing.length) {
    red += 1;
    linesOut.push({
      status: 'red',
      fact: msg('board.thresholds-declared.goals_red', { rel: PROJECT_REL, codes: missing.join(', ') }),
    });
  } else {
    linesOut.push({ status: 'green', fact: msg('board.thresholds-declared.goals_ok', { rel: PROJECT_REL }) });
  }

  const lim = limitProblems(lines);
  if (lim.length) {
    red += 1;
    linesOut.push({
      status: 'red',
      fact: msg('board.thresholds-declared.limit_red', { rel: PROJECT_REL, key: lim[0] }),
    });
  } else {
    linesOut.push({ status: 'green', fact: msg('board.thresholds-declared.limit_ok', { rel: PROJECT_REL }) });
  }

  return { ready: red === 0, lines: linesOut, red };
}

// ---- --selftest: probes in a temp directory ---------------------------------------------------

const EPICS_ROWS = CODES.map((c) => `| \`${c}\` | goal kind ${c} | purpose |`).join('\n');

function projectMd({ withThresholds = true, withGoals = true, withLimit = true } = {}) {
  return [
    '# configuration',
    '',
    '**Project epics** <!-- k:epics -->:',
    '',
    withGoals ? EPICS_ROWS : '',
    '',
    '**Thresholds** <!-- k:thresholds -->:',
    '',
    withThresholds ? '| Threshold | Value |\n|---|---|\n| Attempts <!-- k:attempts --> | 3 |\n| Cycle volume <!-- k:volume --> | 25 |' : '',
    '',
    '**Routes** <!-- k:routes -->:',
    '',
    withLimit ? '| External model | call limit per cycle - 50 |' : '| External model | provider named |',
    '',
  ].join('\n');
}

function selftest() {
  const base = process.env.FORMA_TEST_TMP && fs.existsSync(process.env.FORMA_TEST_TMP) ? process.env.FORMA_TEST_TMP : os.tmpdir();
  const dir = fs.mkdtempSync(path.join(base, 'thresholds-declared-'));
  const results = [];
  const check = (name, cond) => results.push({ ok: !!cond, name });
  try {
    const write = (sub, text) => {
      const p = path.join(dir, sub, PROJECT_REL);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, text);
    };

    // a: a full declaration - GREEN
    write('a', projectMd());
    const ra = runProject({ root: path.join(dir, 'a') });
    check('a: full declaration = GREEN', ra.ready && ra.red === 0 && ra.lines.every((l) => l.status === 'green'));

    // b: no thresholds section - RED (named: k:attempts, k:volume)
    write('b', projectMd({ withThresholds: false }));
    const rb = runProject({ root: path.join(dir, 'b') });
    check('b: no thresholds section = RED (k:attempts, k:volume named)', !rb.ready && rb.lines.some((l) => l.status === 'red' && l.fact.includes('k:attempts') && l.fact.includes('k:volume')));

    // c: no goals table - RED (the missing codes named)
    write('c', projectMd({ withGoals: false }));
    const rc = runProject({ root: path.join(dir, 'c') });
    check('c: no goals table = RED (the kind codes named)', !rc.ready && rc.lines.some((l) => l.status === 'red' && l.fact.includes('k:epics') && l.fact.includes('analytics') && l.fact.includes('results')));

    // d: no paid service limit - RED (named: k:routes)
    write('d', projectMd({ withLimit: false }));
    const rd = runProject({ root: path.join(dir, 'd') });
    check('d: no paid service limit = RED (k:routes named)', !rd.ready && rd.lines.some((l) => l.status === 'red' && l.fact.includes('k:routes')));

    // e: no PROJECT.md - a runtime error (exit 2, fail-closed)
    let threw = false;
    try { runProject({ root: path.join(dir, 'e') }); } catch (e) { threw = e.exitCode === 2; }
    check('e: no PROJECT.md = a runtime error (exit 2)', threw);

    const failed = results.filter((r) => !r.ok);
    return {
      ok: failed.length === 0,
      note: failed.length
        ? msg('board.selftest.mismatch') + failed.map((r) => r.name).join('; ')
        : msg('board.thresholds-declared.selftest_ok'),
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---- the form of the checks registry -----------------------------------------------------------

/** Findings for the registry (`run(ctx)` → lines, an empty list - clean); registration in index.cjs is the accepting node's decision. */
function run(ctx = {}) {
  const r = runProject({ root: ctx.root });
  return r.lines.filter((l) => l.status === 'red').map((l) => 'thresholds-declared: ' + l.fact);
}

module.exports = { run, runProject, selftest };

// ---- CLI ----------------------------------------------------------------------------------------

if (require.main === module) {
  const argv = process.argv.slice(2);
  const ri = argv.indexOf('--root');
  const root = ri >= 0 ? path.resolve(argv[ri + 1]) : process.cwd();
  try {
    if (argv.includes('--selftest')) {
      const st = selftest();
      console.log((st.ok ? '✓ ' : '✗ ') + st.note);
      process.exit(st.ok ? 0 : 1);
    }
    if (argv.includes('--project')) {
      const r = runProject({ root });
      for (const l of r.lines) console.log((l.status === 'green' ? '✓ ' : '✗ ') + l.fact);
      if (r.ready) console.log(msg('board.thresholds-declared.cli_green'));
      else console.log(msg('board.thresholds-declared.cli_red', { n: r.red }));
      process.exit(r.ready ? 0 : 1);
    }
    console.error(msg('board.thresholds-declared.no_mode'));
    process.exit(1);
  } catch (e) {
    console.error(msg('board.stop') + e.message);
    process.exit(e.exitCode || 2);
  }
}
