#!/usr/bin/env node
'use strict';
/**
 * The Claude adapter's fit to the core-adapter interface shape (the header of `.forma/dashboard/lib/engines.cjs`):
 * the core finds the adapter by the file name, every declared field is there and of its type, the values read back.
 * The common economy contract - `claude-economy.test.cjs`; this one goes together with it.
 *   node .claude/scripts/forma-adapter.test.cjs
 *
 * The ru literals below are pins on the board-core lib's output (modeOf, check) or on the declared
 * data - held as \u escapes, the code file stays ASCII.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const engines = require('../../.forma/dashboard/lib/engines.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
let passed = 0;
const it = (name, fn) => { fn(); passed += 1; console.log('ok  ' + name); };
const adapter = () => engines.loadAdapters(ROOT).find((a) => a.dir === '.claude');

it('the core finds the adapter by the file name, without an engine name', () => {
  const a = adapter();
  assert.ok(a, 'no loadable .claude/forma-adapter.cjs in the project root');
  assert.equal(a.engine, 'claude-code');
});

it('the shape: every declared field is there and of its type, no extras', () => {
  const a = adapter();
  assert.deepEqual(engines.validateAdapter(a), []);
  // The reference adapter declares the whole shape: a missing field the core would silently replace with unknown.
  // The transcript-reading fields (TRANSCRIPT_FIELDS) - by the engine's platform: the core keeps a fallback for each.
  const missing = Object.keys(engines.SHAPE).filter((f) => a[f] == null && !engines.TRANSCRIPT_FIELDS.includes(f));
  assert.deepEqual(missing, []);
});

it('the shape check tells a corruption apart: the wrong type and the extra field are named', () => {
  const bad = engines.validateAdapter({ rolesDir: 5, made_up: true });
  assert.equal(bad.length, 2);
  assert.match(bad[0], /rolesDir/);
});

it("the adapter's paths - from the project root, and they exist", () => {
  const a = adapter();
  for (const f of ['rolesDir', 'onDemandRolesDir', 'engineRulesFile', 'skillsDir', 'syncScript']) {
    assert.ok(fs.existsSync(engines.resolveRel(ROOT, a[f])), `${f}: ${a[f]} not found`);
  }
  for (const r of a.usageRefresh) assert.ok(fs.existsSync(engines.resolveRel(ROOT, r.script)), `usageRefresh: ${r.script}`);
});

it("the template's skill list: matches what lies in the template (where the .forma/protocol/ clone is)", () => {
  const a = adapter();
  assert.ok(Array.isArray(a.templateSkills) && a.templateSkills.length > 0);
  const base = path.join(ROOT, '.forma/protocol', 'skills', 'forma');
  const dirs = [path.join(base, 'adapters', 'claude', 'skills'), path.join(base, 'core', 'skills')];
  if (!dirs.every((d) => fs.existsSync(d))) return; // an installed project without the clone: nothing to compare against
  const real = [...new Set(dirs.flatMap((d) => fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)))].sort(); // a skill may lie both in adapters/claude and in core
  assert.deepEqual([...a.templateSkills].sort(), real);
});

it('the instruction weight: per node a step is a number; no steps without cache-read - null, not 0', () => {
  const a = adapter();
  const w = a.instructionWeight();
  assert.ok(Object.keys(w.byNode).length > 0);
  for (const v of Object.values(w.byNode)) assert.equal(typeof v.perStep, 'number');
  assert.equal(a.stepsFromCacheRead(0, 100), null);
  assert.equal(a.stepsFromCacheRead(1000, 100), 10);
});

it('the spend: a transcript step reads into the canonical fields, what is missing - null', () => {
  const u = adapter().parseUsage({ input_tokens: 3, cache_read_input_tokens: 7 });
  assert.deepEqual(u, { tokens_in: 3, tokens_out: null, cache_read: 7, cache_write: null });
  const dir = adapter().transcriptsDir(ROOT);
  assert.ok(dir === null || typeof dir === 'string');
});

it('the tool log: the parse reads the declared and the bare tool name', () => {
  const t = adapter().toolUsage;
  assert.equal(t.baseName('Bash(node x *)'), 'Bash');
  assert.ok(t.readDeclared(engines.resolveRel(ROOT, adapter().rolesDir)) instanceof Map);
  assert.ok(fs.existsSync(engines.resolveRel(ROOT, t.source)));
});

it('the MCP configs and the engine settings: the declared shape of the entries', () => {
  const a = adapter();
  for (const c of a.mcpConfigs(ROOT)) assert.deepEqual(Object.keys(c).sort(), ['file', 'level', 'rel']);
  const s = a.engineSettings(ROOT);
  assert.deepEqual(Object.keys(s).sort(), ['check', 'env', 'hooks', 'mcp', 'nodes', 'plugins', 'present', 'skills']);
  assert.deepEqual(Object.keys(s.mcp).sort(), ['project', 'user', 'userProject']);
});

it('the roles shape: the title, the nodes and the Run roles, the plugins', () => {
  const c = adapter().formaRoles(ROOT);
  assert.ok(c.title && Array.isArray(c.nodes) && Array.isArray(c.runRoles));
  assert.ok(c.nodes.length > 0);
  assert.ok(c.plugins && typeof c.plugins.ran === 'boolean');
});

it('the structure: a group with a key, a title, the roots and the captions', () => {
  const s = adapter().structure;
  assert.ok(s.key && s.title && Array.isArray(s.roots) && s.roots.length);
  assert.equal(typeof s.notes, 'object');
});

it('the engine contract: the declared sources are given as they are, without sources - by the convention', () => {
  const claude = engines.sourcesOf(adapter());
  assert.equal(claude.rolesDir, '.claude/agents');
  assert.equal(claude.runRolesDir, '.claude/agents/run');
  // A default installation puts one engine in: gemini and the dormant minimax are checked where their adapter lies.
  const declared = (dir) => engines.loadAdapters(ROOT).find((a) => a.dir === dir);
  if (declared('.agents')) {
    const gemini = engines.sourcesOf(declared('.agents'));
    assert.equal(gemini.rolesDir, '.agents/plugins/forma/agents'); // declared, not the convention (.agents/agents)
  }
  if (declared('.minimax')) {
    const minimax = engines.sourcesOf(declared('.minimax'));
    assert.equal(minimax.rolesDir, '.minimax/agents');
  }
  const bare = engines.sourcesOf({ dir: '.demo' });
  assert.deepEqual([bare.rolesDir, bare.skillsDir, bare.packageManifest, bare.mcpConfigs], ['.demo/agents', '.demo/skills', null, []]);
  assert.equal(engines.idOf({ dir: '.demo' }), 'demo');
  assert.equal(engines.idOf({ dir: '.demo', id: 'x' }), 'x');
});

it('the engine contract: without a subagent call the mode is degraded (ru data value pinned)', () => {
  assert.equal(engines.modeOf(adapter()), '\u043f\u043e\u043b\u043d\u044b\u0439');
  assert.equal(engines.modeOf({ capabilities: { subagents: false } }), '\u0434\u0435\u0433\u0440\u0430\u0434\u0438\u0440\u043e\u0432\u0430\u043d\u043d\u044b\u0439');
  assert.equal(engines.modeOf({}), '\u0434\u0435\u0433\u0440\u0430\u0434\u0438\u0440\u043e\u0432\u0430\u043d\u043d\u044b\u0439');
});

it('the engine contract: check prints the items and exits with code 1 on a failure', () => {
  const { spawnSync } = require('child_process');
  const lib = path.join(ROOT, '.forma', 'dashboard', 'lib', 'engines.cjs');
  const ok = spawnSync(process.execPath, [lib, 'check', 'claude-code'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(ok.status, 0);
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'engine-check-'));
  fs.mkdirSync(path.join(tmp, '.bad'));
  fs.writeFileSync(path.join(tmp, '.bad', 'forma-adapter.cjs'),
    "module.exports = { engine: 'bad', sources: { rolesDir: '.bad/agents' }, writeZones: ['.other'] };");
  const bad = spawnSync(process.execPath, [lib, 'check', 'bad', '--root', tmp], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /✗ sources\.rolesDir \u0441\u0443\u0449\u0435\u0441\u0442\u0432\u0443\u0435\u0442/); // the board-core lib's ru finding pinned
  assert.match(bad.stdout, /✗ writeZones/);
  assert.equal(spawnSync(process.execPath, [lib, 'check', 'nope', '--root', tmp], { encoding: 'utf8' }).status, 2);
});

console.log(`\n${passed} checks passed`);
