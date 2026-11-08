#!/usr/bin/env node
'use strict';
// Gate: RAM-disk rule present in run/kit/intent of every engine mirror of this project
// and in the protocol template source; no machine traces in the role texts.
// Exit 0 = green. Facts to stdout. On require: side-effect-free (checks-registry
// requires every checker; the scan runs only on direct execution).
const fs = require('node:fs');
const path = require('node:path');
const i18n = require('../../i18n/index.cjs');
const msg = (key, params) => i18n.message(key, params, 'ru');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const PROTO = path.join(ROOT, '.forma', 'protocol');

function read(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

function runGate() {
  const problems = [];
  const facts = [];

  // 1. Project mirrors: every root-level engine zone with agents/run.md carries the markers.
  const zones = fs.readdirSync(ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith('.') && read(path.join(ROOT, e.name, 'agents', 'run.md')) !== null)
    .map((e) => e.name);
  facts.push(msg('board.ram-disk-rule.mirrors', { zones: zones.join(', ') || msg('board.ram-disk-rule.none') }));
  if (zones.length === 0) problems.push(msg('board.ram-disk-rule.no_mirrors'));
  for (const z of zones) {
    const run = read(path.join(ROOT, z, 'agents', 'run.md'));
    const kit = read(path.join(ROOT, z, 'agents', 'kit.md'));
    const intent = read(path.join(ROOT, z, 'agents', 'intent.md'));
    if (!run || !run.includes('FORMA_TEST_TMP') || !run.includes('RAM disk')) problems.push(msg('board.ram-disk-rule.no_ram_marker', { f: z + '/agents/run.md' }));
    if (!run || !run.includes('Surgical testing')) problems.push(msg('board.ram-disk-rule.no_surgical', { f: z + '/agents/run.md' }));
    if (!kit || !kit.includes('FORMA_TEST_TMP')) problems.push(msg('board.ram-disk-rule.no_ram_marker', { f: z + '/agents/kit.md' }));
    if (!kit || !kit.includes('Surgical testing in Tool')) problems.push(msg('board.ram-disk-rule.no_surgical', { f: z + '/agents/kit.md' }));
    if (!intent || !intent.includes('RAM disk')) problems.push(msg('board.ram-disk-rule.no_ram_start', { f: z + '/agents/intent.md' }));
  }

  // 2. Template source: every adapter role file (any nesting) carries the markers; at least 3 adapters with run.md.
  const adaptersDir = path.join(PROTO, 'skills', 'forma', 'adapters');
  let adaptersWithRun = 0;
  if (!fs.existsSync(adaptersDir)) {
    problems.push(msg('board.push-verify-rule.no_adapters_dir'));
  } else {
    const roleFiles = [];
    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory() && e.name !== 'node_modules' && e.name !== 'tests') walk(full);
        else if (e.isFile() && /^(run|kit|intent)\.md$/.test(e.name) && full.split(path.sep).includes('agents')) roleFiles.push(full);
      }
    })(adaptersDir);
    const adapters = new Set(roleFiles.map((f) => path.relative(adaptersDir, f).split(path.sep)[0]));
    for (const f of roleFiles) {
      const rel = path.relative(PROTO, f);
      const name = path.basename(f);
      const src = read(f);
      if (name === 'run.md') {
        adaptersWithRun += 1;
        if (!src.includes('FORMA_TEST_TMP') || !src.includes('RAM disk')) problems.push(msg('board.ram-disk-rule.template_no_ram', { rel }));
        if (!src.includes('Surgical testing')) problems.push(msg('board.ram-disk-rule.template_no_surgical', { rel }));
      }
      if (name === 'kit.md' && (!src.includes('FORMA_TEST_TMP') || !src.includes('Surgical testing in Tool'))) problems.push(msg('board.ram-disk-rule.template_no_markers', { rel }));
      if (name === 'intent.md' && !src.includes('RAM disk')) problems.push(msg('board.ram-disk-rule.template_no_ram_start', { rel }));
    }
    facts.push(msg('board.push-verify-rule.adapters', { n: adaptersWithRun, list: [...adapters].join(', ') }));
    if (adaptersWithRun < 3) problems.push(msg('board.push-verify-rule.too_few', { n: adaptersWithRun }));
  }

  // 3. Machine traces forbidden in role texts (clean zones, prohibition 16).
  const tracePatterns = [/[A-Za-z]:\\/, /OSFMount|ImDisk/i, /forma-ramdisk/i];
  const traceTargets = [];
  for (const z of zones) ['run.md', 'kit.md', 'intent.md'].forEach((n) => traceTargets.push(path.join(ROOT, z, 'agents', n)));
  if (fs.existsSync(adaptersDir)) {
    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory() && e.name !== 'node_modules' && e.name !== 'tests') walk(full);
        else if (e.isFile() && /^(run|kit|intent)\.md$/.test(e.name) && full.split(path.sep).includes('agents')) traceTargets.push(full);
      }
    })(adaptersDir);
  }
  for (const f of traceTargets) {
    const src = read(f);
    if (!src) continue;
    for (const re of tracePatterns) {
      if (re.test(src)) problems.push(msg('board.push-verify-rule.machine_trace', { f: path.relative(ROOT, f), re }));
    }
  }

  // 4. Runner and setup notes exist in the template.
  const runner = read(path.join(PROTO, 'scripts', 'test-runner.cjs'));
  if (!runner || !runner.includes('FORMA_TEST_TMP') || !runner.includes('test-concurrency')) problems.push(msg('board.ram-disk-rule.no_runner_markers'));
  if (!runner || !runner.includes('PROJECT_SLUG')) problems.push(msg('board.ram-disk-rule.no_project_slug'));
  const setup = read(path.join(PROTO, 'SETUP.md'));
  if (!setup || !setup.includes('RAM disk')) problems.push(msg('board.ram-disk-rule.no_setup_note'));
  const envExample = read(path.join(PROTO, '.env.example'));
  if (!envExample || !envExample.includes('FORMA_TEST_TMP')) problems.push(msg('board.ram-disk-rule.no_env_example'));

  console.log(facts.join('\n'));
  if (problems.length) {
    console.log(msg('board.push-verify-rule.problems') + problems.map((p) => '  - ' + p).join('\n'));
    process.exit(1);
  }
  console.log(msg('board.ram-disk-rule.green'));
  process.exit(0);
}

module.exports = { runGate };

if (require.main === module) runGate();
