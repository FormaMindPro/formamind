#!/usr/bin/env node
'use strict';

/**
 * test-qoder-roles.cjs - the Qoder role catalog and Intent delivery test.
 * It checks:
 *  1. The catalog .qoder/engine/agents carries the five node roles, the run roles and the on-demand set;
 *  2. gen-roles --check: the catalog matches the canonical .claude/agents, the node frontmatter
 *     carrying the engine's models (or the catalog is kept when the source is absent);
 *  3. The adapter's sources point at .qoder/engine/agents, not at a second roles directory;
 *  4. The five node roles carry the adapter's `nodeModels` (model and effort), a run craft carries Run's,
 *     and the Plumb executor takes the cheapest family model;
 *  5. session-start --dry-run delivers a fresh nonce, the Intent role and the session-start file;
 *  6. The forbidden native surfaces and the stale roles/ directory are absent;
 *  7. The zone self-test is green.
 *
 * Run:
 *   node .qoder/tests/test-qoder-roles.cjs
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function findRoot(start) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, 'AGENTS.md'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return path.resolve(start);
    dir = up;
  }
}

const root = findRoot(__dirname);
const CATALOG = path.join(root, '.qoder', 'engine', 'agents');
const engines = require(path.join(root, '.forma', 'dashboard', 'lib', 'engines.cjs'));

let passed = 0;
const it = (name, fn) => { fn(); passed += 1; console.log('ok  ' + name); };

const adapter = () => engines.loadAdapters(root).find((a) => a.dir === '.qoder');
const exists = (rel) => fs.existsSync(path.join(CATALOG, rel));

it('the catalog carries the five node roles, the run roles and the on-demand set', () => {
  for (const rel of ['intent.md', 'spec.md', 'kit.md', 'run.md', 'core.md', 'on-demand/intent-session-start.md']) {
    assert.ok(exists(rel), 'the catalog lacks ' + rel);
  }
  const runDir = path.join(CATALOG, 'run');
  assert.ok(fs.existsSync(runDir), 'the catalog lacks the run/ directory');
  assert.ok(fs.readdirSync(runDir).some((name) => name.endsWith('.md')), 'the run/ directory holds no roles');
});

it('gen-roles --check reports the catalog in parity with .claude/agents', () => {
  const r = spawnSync(process.execPath, [path.join(root, '.qoder', 'engine', 'scripts', 'gen-roles.cjs'), '--check'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, 'gen-roles --check is red:\n' + (r.stderr || r.stdout));
});

it('the catalog carries no project-layer roles (frontmatter layer: project)', () => {
  for (const rel of ['run/run-site-build.md', 'run/run-site-php.md', 'run/run-site-upload.md', 'run/run-pillow-translate.md']) {
    assert.ok(!exists(rel), 'a project-layer role reached the catalog: ' + rel);
  }
  const marked = fs.readFileSync(path.join(root, '.claude', 'agents', 'run', 'run-site-build.md'), 'utf8');
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(marked);
  assert.ok(fm && /^layer:\s*project\s*$/m.test(fm[1]), 'a project role must carry layer: project');
});

it('the adapter sources point at .qoder/engine/agents', () => {
  const a = adapter();
  assert.ok(a, 'the .qoder adapter was not found by the core');
  assert.equal(a.sources.rolesDir, '.qoder/engine/agents');
  assert.equal(a.sources.onDemandRolesDir, '.qoder/engine/agents/on-demand');
  assert.equal(a.sources.runRolesDir, '.qoder/engine/agents/run');
});

const frontmatterOf = (rel) => {
  const text = fs.readFileSync(path.join(CATALOG, rel), 'utf8');
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const out = {};
  if (!m) return out;
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i === -1) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
};

it('the five node roles carry the adapter nodeModels, a run craft carries Run, and Plumb takes the cheapest model', () => {
  const a = adapter();
  assert.ok(a && a.nodeModels, 'the .qoder adapter declares no nodeModels');
  for (const [node, role] of [['Intent', 'intent.md'], ['Spec', 'spec.md'], ['Kit', 'kit.md'], ['Run', 'run.md'], ['Core', 'core.md']]) {
    const want = a.nodeModels[node];
    assert.ok(want, 'nodeModels lacks ' + node);
    const fm = frontmatterOf(role);
    assert.equal(fm.model, want.model, role + ' model differs from nodeModels.' + node);
    assert.equal(fm.effort, want.effort, role + ' effort differs from nodeModels.' + node);
  }
  const craft = fs.readdirSync(path.join(CATALOG, 'run')).filter((n) => n.endsWith('.md'))[0];
  const fm = frontmatterOf('run/' + craft);
  assert.equal(fm.model, a.nodeModels.Run.model, 'run/' + craft + ' does not carry Run model');
  assert.equal(fm.effort, a.nodeModels.Run.effort, 'run/' + craft + ' does not carry Run effort');
  const plumb = frontmatterOf('plumb-haiku.md');
  assert.equal(plumb.model, 'qwen-3.8-flash', 'the Plumb executor does not carry the cheapest family model');
  assert.equal(plumb.effort, 'low', 'the Plumb executor does not carry the low effort');
});

it('session-start --dry-run delivers a fresh nonce, the Intent role and the session-start file', () => {
  const run = () => spawnSync(process.execPath, [path.join(root, '.qoder', 'engine', 'hooks', 'session-start.cjs'), '--dry-run'], { cwd: root, encoding: 'utf8' });
  const first = run();
  assert.equal(first.status, 0, 'session-start --dry-run failed:\n' + (first.stderr || first.stdout));
  const second = run();
  const nonceRe = /\[sled\] session-start nonce=([0-9a-f]{12})\b/;
  const n1 = (first.stdout.match(nonceRe) || [])[1];
  const n2 = (second.stdout.match(nonceRe) || [])[1];
  assert.ok(n1, 'the output carries no fresh nonce');
  assert.notEqual(n1, n2, 'two starts printed the same nonce');
  assert.ok(first.stdout.includes('[sled] role Intent begin (.qoder/engine/agents/intent.md)'), 'the Intent role was not delivered');
  assert.ok(first.stdout.includes('You hold the end-image'), 'the Intent role text is incomplete');
  assert.ok(first.stdout.includes('[sled] role Intent session start begin (.qoder/engine/agents/on-demand/intent-session-start.md)'), 'the session-start file was not delivered');
  assert.ok(first.stdout.includes('The dashboard link comes first'), 'the session-start text is incomplete');
  assert.ok(first.stdout.includes('[sled] role Intent end'), 'the Intent role has no end marker');
});

it('the forbidden native surfaces and the stale roles/ directory are absent', () => {
  for (const rel of ['.qoder/rules', '.qoder/agents', '.qoder/home.md', '.qoder/engine/roles']) {
    assert.ok(!fs.existsSync(path.join(root, rel)), 'unexpected surface present: ' + rel);
  }
});

it('the zone self-test is green when the project ships one', () => {
  const file = path.join(root, '.qoder', 'engine', 'checks', 'selftest.cjs');
  if (!fs.existsSync(file)) return; // a clean install ships the adapter without the project's selftest
  const r = spawnSync(process.execPath, [file], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, 'selftest failed:\n' + (r.stderr || r.stdout));
});

console.log(`\npassed: ${passed}`);
