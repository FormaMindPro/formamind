#!/usr/bin/env node
'use strict';

/**
 * sync-engines.cjs - the deterministic check and synchronization of the rules
 * between Claude Code (.claude/ + .claude/rules/claude-8.md), Google Antigravity (.agents/ + .agents/rules/gemini-8.md)
 * and Codex (.codex/ + CODEX-8.md).
 *
 * Claude and Gemini are reconciled by text - their roles are equal by content. Codex reads
 * the canonical Claude text by an executable reference, so what is checked is the reference,
 * the construction and the availability of the skills mirror (see checks/codex.cjs).
 *
 * Purpose:
 *   1. Check the roles' parity without a manual file-by-file comparison.
 *   2. Check the root rules' construction: AGENTS.md - the only source, both wrapper files import it
 *      and hold no copy of §1-7 of their own (two rules texts no longer need comparing - the text is one).
 *   3. Give an instant status for the SessionStart hooks (check-ready.sh) and the intent-housekeeping procedure.
 *
 * Usage:
 *   node .claude/scripts/sync-engines.cjs [--check] [--diff] [--quiet] [--file <path>]
 *   node .claude/scripts/sync-engines.cjs --apply [--dry-run]
 *   node .claude/scripts/sync-engines.cjs --selftest
 *
 * Flags:
 *   --check    (the default) Reconcile the file pairs and print the status. Code 0 - parity, 1 - drift.
 *   --selftest The self-test of the registry checks that carry one (export selftest()): the rigs run in
 *              a temp directory of the OS. Code 0 - all rigs green, 1 - a red one or no self-tests.
 *   --diff     Show the diverging lines for the files where drift was found.
 *   --quiet    Print the single status line only (handy for hooks).
 *   --file     One file (the clean zones hook): a project trace - into the output, exit 0 always; outside the zone - silence.
 *   --apply    Generate `.agents/plugins/forma/agents/` from `.claude/agents/` (the node roles and
 *              on-demand) by the rules of `checks/support/gen-gemini-roles.cjs`. Idempotent: with
 *              no change in the source a re-run writes nothing. The frontmatter (model/effort/
 *              tools/skills) is untouched - it is an engineering choice per the engine, not generated.
 *              Code 0 - applied (or already in sync), 1 - there is a `problem` (a new file without
 *              the destination's frontmatter, a one-time manual edit needed).
 *   --dry-run  With `--apply`: show what would be written, without writing.
 *
 * What is checked: the core's integrity (the law, the manual, the economy module and its conformance
 * test) and every installed engine adapter - by its own economy-contract conformance test. An adapter
 * without a test ("not ready") is named an info note, not a violation; the Claude<->Gemini roles parity
 * and the .codex/ construction are also info notes only.
 *
 * The checks - a registry in checks/index.cjs: one check - one file, the script only runs them in a circle.
 *
 * Printed labels come from the core dictionary: English key in code, ru value as data.
 */

const fs = require('fs');
const path = require('path');
const i18n = require('../../.forma/i18n/index.cjs');
const msg = (code, params) => i18n.message(code, params, 'ru');

// The template copy runs only from an installed project: every require of the shared code (the script
// itself and the checks/ registry) is built for the install depth and converges on one root <__dirname/../..>.
// No install - an intelligible exit on an engine's copy instead of a MODULE_NOT_FOUND stack.
const ROOT = path.resolve(__dirname, '../..');
const checksLib = ['.forma/dashboard/lib/checks.cjs', 'dashboard/lib/checks.cjs']
  .map((rel) => path.join(ROOT, rel))
  .find((abs) => fs.existsSync(abs));
if (!checksLib) {
  process.stderr.write(msg('sync-engines.template_copy_only'));
  process.exit(1);
}
const { runChecks } = require(checksLib);
const CHECKS = require('./checks/index.cjs');
const { cleanOwn, inCleanZone, scanCleanFile } = require('./checks/support/clean-zone.cjs');
const parity = require('./checks/support/role-parity.cjs');
const geminiGen = require('./checks/support/gen-gemini-roles.cjs');

const NL = String.fromCharCode(10);

// The checks the reconciliation runs in a circle - in checks/index.cjs. The info notes (not violations) a check lays
// into ctx.info as ready lines, in the registry's order. The labels below are read by the dashboard (.forma/dashboard/data/law.cjs) - the order and the words hold.

// --- The third environment: Codex -------------------------------------------------
// The codex check (checks/codex.cjs): Codex reads the canonical Claude text by reference - the referential
// construction is checked, not the edit time. Findings are info notes, not violations.

// --- The core and the adapters ------------------------------------------------------
// The core is one for all engines: the law, the manual, the economy module with its conformance test. An engine's
// adapter is checked by its own economy-contract conformance test (ECONOMY.md).

/** One file (the hook): a trace in a clean zone - into the output, exit 0 always; outside the zone - silence. */
function checkOneFile(fileArg) {
  const abs = path.resolve(fileArg || '');
  const rel = path.relative(ROOT, abs).split(path.sep).join('/');
  if (!rel.startsWith('..') && fs.existsSync(abs) && inCleanZone(rel, cleanOwn(ROOT))) {
    const found = scanCleanFile(rel, fs.readFileSync(abs, 'utf8'));
    if (found.length) console.log(found.join(NL));
  }
  process.exit(0);
}

/** The "Root rules" line: the wording depends on the Claude side's construction - an import from the root, or §8 served by a hook. */
function rootRulesOk() {
  const claudeNative = !fs.existsSync(path.join(ROOT, 'CLAUDE.md'));
  return claudeNative
    ? msg('sync-engines.root_rules_native')
    : msg('sync-engines.root_rules_wrappers');
}

function printReport({ problems, info, results, isDiff }) {
  const hasDrift = problems.length > 0;
  const rule = '='.repeat(70);
  console.log(rule);
  console.log(msg('sync-engines.report_header'));
  console.log(rule + '\n');

  if (!hasDrift) {
    console.log(rootRulesOk());
  } else {
    console.log(msg('sync-engines.root_rules_broken'));
    for (const problem of problems) console.log(`    — ${problem}`);
    console.log('');
  }

  console.log(msg('sync-engines.core_and_adapters'));
  for (const l of info) console.log(l);
  console.log('');
  for (const l of parity.parityTable(results)) console.log(l);
  console.log('\n' + parity.RULE);

  if (!hasDrift) { console.log(msg('sync-engines.all_ok')); return; }
  console.log(msg('sync-engines.failure_line'));
  if (results.some(({ res }) => res.status !== 'synced' && res.status !== 'own')) console.log(msg('sync-engines.drift_hint'));
  if (isDiff) for (const l of parity.driftDetails(results)) console.log(l);
  else console.log(msg('sync-engines.diff_hint'));
}

/** `--apply`: the roles mirror generation, separate from the law/core reconciliation below. */
function runApply(args) {
  const dryRun = args.includes('--dry-run');
  const { written, unchanged, problems } = geminiGen.applyAll(ROOT, { dryRun });
  const rule = '='.repeat(70);
  console.log(rule);
  console.log('  ' + (dryRun ? msg('sync-engines.apply_dry_header') : msg('sync-engines.apply_header')) + msg('sync-engines.apply_target'));
  console.log(rule + '\n');
  if (written.length) {
    console.log((dryRun ? msg('sync-engines.would_write') : msg('sync-engines.wrote')) + `: ${written.length}`);
    for (const w of written) console.log(`  — ${w.relFile} (${w.was})`);
  } else {
    console.log(msg('sync-engines.no_changes'));
  }
  console.log(msg('sync-engines.unchanged_line', { count: unchanged.length }));
  if (problems.length) {
    console.log(msg('sync-engines.problems_header', { count: problems.length }));
    for (const p of problems) console.log(`  — ${p.relFile}: ${p.reason}`);
  }
  process.exit(problems.length ? 1 : 0);
}

/** `--selftest`: the self-test of the registry checks that carry one; each one's rigs - in an OS temp directory. */
function runSelftest() {
  const withSelftest = CHECKS.filter((c) => typeof c.selftest === 'function');
  if (!withSelftest.length) {
    console.log(msg('sync-engines.no_selftest'));
    process.exit(1);
  }
  let bad = 0;
  for (const c of withSelftest) {
    try {
      const st = c.selftest();
      if (!st || typeof st.ok !== 'boolean') { bad += 1; console.log(`\u2717 ${c.id}: ` + msg('sync-engines.selftest_bad_shape')); continue; }
      if (!st.ok) bad += 1;
      console.log((st.ok ? '\u2713 ' : '\u2717 ') + c.id + ': ' + st.note);
    } catch (e) {
      bad += 1;
      console.log(`\u2717 ${c.id}: ` + msg('sync-engines.selftest_failed', { error: String((e && e.message) || e) }));
    }
  }
  process.exit(bad ? 1 : 0);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--selftest')) runSelftest();
  if (args.includes('--apply')) runApply(args);
  const fi = args.indexOf('--file');
  if (fi >= 0) checkOneFile(args[fi + 1]);

  const info = [];
  const problems = runChecks(CHECKS, { root: ROOT, info });
  const hasDrift = problems.length > 0;

  if (args.includes('--quiet')) {
    if (hasDrift) console.log(msg('sync-engines.quiet_drift', { count: problems.length }));
    else console.log(msg('sync-engines.quiet_ok'));
    process.exit(hasDrift ? 1 : 0);
  }

  printReport({ problems, info, results: parity.compareRoles(ROOT), isDiff: args.includes('--diff') });
  process.exit(hasDrift ? 1 : 0);
}

main();
