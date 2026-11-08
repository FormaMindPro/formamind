#!/usr/bin/env node
'use strict';
// Gate: the push-verdict rule present in run/kit/intent of every engine mirror
// of this project and in the protocol template source; no machine or service traces
// in the role texts. Exit 0 = green. Facts to stdout. On require: side-effect-free
// (checks-registry requires every checker; the scan runs only on direct execution).
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const PROTO = path.join(ROOT, '.forma', 'protocol');

const MARK = {
  run: 'A push is finished by the remote\'s verdict',
  kit: 'Remote checks in `Tool`',
  intent: 'A push is reported by the remote\'s verdict',
};
const CONCEPT = 'checks of the pushed commit';

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
  facts.push(`зеркала движков проекта: ${zones.join(', ') || 'НЕТ'}`);
  if (zones.length === 0) problems.push('не найдено ни одного зеркала движков');
  for (const z of zones) {
    const run = read(path.join(ROOT, z, 'agents', 'run.md'));
    const kit = read(path.join(ROOT, z, 'agents', 'kit.md'));
    const intent = read(path.join(ROOT, z, 'agents', 'intent.md'));
    if (!run || !run.includes(MARK.run) || !run.includes(CONCEPT)) problems.push(`${z}/agents/run.md: нет маркера правила вердикта пуша`);
    if (!kit || !kit.includes(MARK.kit) || !kit.includes(CONCEPT)) problems.push(`${z}/agents/kit.md: нет маркера правила вердикта пуша`);
    if (!intent || !intent.includes(MARK.intent)) problems.push(`${z}/agents/intent.md: нет правила отчёта по вердикту пуша`);
  }

  // 2. Template source: every adapter role file (any nesting) carries the markers; at least 3 adapters with run.md.
  const adaptersDir = path.join(PROTO, 'skills', 'forma', 'adapters');
  let adaptersWithRun = 0;
  if (!fs.existsSync(adaptersDir)) {
    problems.push('шаблон: skills/forma/adapters не найден');
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
        if (!src.includes(MARK.run) || !src.includes(CONCEPT)) problems.push(`шаблон ${rel}: нет маркера правила вердикта пуша`);
      }
      if (name === 'kit.md' && (!src.includes(MARK.kit) || !src.includes(CONCEPT))) problems.push(`шаблон ${rel}: нет маркера правила вердикта пуша`);
      if (name === 'intent.md' && !src.includes(MARK.intent)) problems.push(`шаблон ${rel}: нет правила отчёта по вердикту пуша`);
    }
    facts.push(`шаблон: адаптеров с run.md — ${adaptersWithRun} (${[...adapters].join(', ')})`);
    if (adaptersWithRun < 3) problems.push(`шаблон: ожидается минимум 3 адаптера с run.md, найдено ${adaptersWithRun}`);
  }

  // 3. Machine and service traces forbidden in role texts (clean zones, prohibition 16):
  // the rule is written for any machine and any repository host, so a concrete service's
  // command surface has no place in the law text.
  const tracePatterns = [/[A-Za-z]:\\/, /OSFMount|ImDisk/i, /forma-ramdisk/i, /gh run|GITHUB_TOKEN|github\.com|gitlab/i];
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
      if (re.test(src)) problems.push(`${path.relative(ROOT, f)}: машинный след ${re} в тексте роли`);
    }
  }

  console.log(facts.join('\n'));
  if (problems.length) {
    console.log('ПРОБЛЕМЫ:\n' + problems.map((p) => '  - ' + p).join('\n'));
    process.exit(1);
  }
  console.log('Push-verify rule: все проверки зелёные');
  process.exit(0);
}

module.exports = { runGate };

if (require.main === module) runGate();
