#!/usr/bin/env node
'use strict';
// Gate: RAM-disk rule present in run/kit/intent of every engine mirror of this project
// and in the protocol template source; no machine traces in the role texts.
// Exit 0 = green. Facts to stdout.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const PROTO = path.join(ROOT, '.forma', 'protocol');

const problems = [];
const facts = [];

function read(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

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
  if (!run || !run.includes('FORMA_TEST_TMP') || !run.includes('RAM disk')) problems.push(`${z}/agents/run.md: нет маркера RAM-правила`);
  if (!run || !run.includes('Surgical testing')) problems.push(`${z}/agents/run.md: нет правила хирургического тестирования`);
  if (!kit || !kit.includes('FORMA_TEST_TMP')) problems.push(`${z}/agents/kit.md: нет маркера RAM-правила`);
  if (!kit || !kit.includes('Surgical testing in Tool')) problems.push(`${z}/agents/kit.md: нет правила хирургического тестирования`);
  if (!intent || !intent.includes('RAM disk')) problems.push(`${z}/agents/intent.md: нет правила RAM-диска при старте сессии`);
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
      if (!src.includes('FORMA_TEST_TMP') || !src.includes('RAM disk')) problems.push(`шаблон ${rel}: нет маркера RAM-правила`);
      if (!src.includes('Surgical testing')) problems.push(`шаблон ${rel}: нет правила хирургического тестирования`);
    }
    if (name === 'kit.md' && (!src.includes('FORMA_TEST_TMP') || !src.includes('Surgical testing in Tool'))) problems.push(`шаблон ${rel}: нет маркеров RAM-правила`);
    if (name === 'intent.md' && !src.includes('RAM disk')) problems.push(`шаблон ${rel}: нет правила RAM-диска при старте сессии`);
  }
  facts.push(`шаблон: адаптеров с run.md — ${adaptersWithRun} (${[...adapters].join(', ')})`);
  if (adaptersWithRun < 3) problems.push(`шаблон: ожидается минимум 3 адаптера с run.md, найдено ${adaptersWithRun}`);
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
    if (re.test(src)) problems.push(`${path.relative(ROOT, f)}: машинный след ${re} в тексте роли`);
  }
}

// 4. Runner and setup notes exist in the template.
const runner = read(path.join(PROTO, 'scripts', 'test-runner.cjs'));
if (!runner || !runner.includes('FORMA_TEST_TMP') || !runner.includes('test-concurrency')) problems.push('шаблон scripts/test-runner.cjs: нет маркеров раннера');
if (!runner || !runner.includes('PROJECT_SLUG')) problems.push('шаблон scripts/test-runner.cjs: нет подкаталога проекта');
const setup = read(path.join(PROTO, 'SETUP.md'));
if (!setup || !setup.includes('RAM disk')) problems.push('шаблон SETUP.md: нет рекомендации RAM-диска');
const envExample = read(path.join(PROTO, '.env.example'));
if (!envExample || !envExample.includes('FORMA_TEST_TMP')) problems.push('шаблон .env.example: нет FORMA_TEST_TMP');

console.log(facts.join('\n'));
if (problems.length) {
  console.log('ПРОБЛЕМЫ:\n' + problems.map((p) => '  - ' + p).join('\n'));
  process.exit(1);
}
console.log('RAM-disk rule: все проверки зелёные');
process.exit(0);
