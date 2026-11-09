#!/usr/bin/env node
'use strict';
/**
 * The engine tabs on the "Form": one tab per adapter with the `formaRoles` field.
 * The root is temporary, the adapters are fake.
 *   node .forma/dashboard/forma-tabs.test.cjs
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readFormaCatalog } = require('./data/forma.cjs');
const { parseToml, readTomlCatalog, readMdCatalog } = require('./lib/forma-roles.cjs');

let passed = 0;
const it = (name, fn) => { fn(); passed += 1; console.log('ok  ' + name); };

function fakeRoot(adapters) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-tabs-'));
  for (const [dir, body] of Object.entries(adapters)) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
    fs.writeFileSync(path.join(root, dir, 'forma-adapter.cjs'), body);
  }
  return root;
}
const ok = (engine, title) => `module.exports = { engine: '${engine}', formaRoles: () => ({ title: '${title}', nodes: [], runRoles: [] }) };`;

it('three adapters -> three tabs, ordered by the adapter directory, without the first by name', () => {
  const root = fakeRoot({ '.a': ok('eng-a', 'A'), '.b': ok('claude-code', 'B'), '.c': ok('eng-c', 'C') });
  const tabs = readFormaCatalog(root).engines;
  assert.deepEqual(tabs.map((t) => t.engine), ['eng-a', 'claude-code', 'eng-c']);
});

it('the adapter removed -> two tabs', () => {
  const root = fakeRoot({ '.a': ok('eng-a', 'A'), '.c': ok('eng-c', 'C') });
  assert.equal(readFormaCatalog(root).engines.length, 2);
});

it('an adapter without formaRoles gets no tab', () => {
  const root = fakeRoot({ '.a': "module.exports = { engine: 'eng-a' };" });
  assert.equal(readFormaCatalog(root).engines.length, 0);
});

it('an adapter whose formaRoles throws is skipped; the rest live on', () => {
  const root = fakeRoot({ '.a': "module.exports = { engine: 'x', formaRoles: () => { throw new Error('boom'); } };", '.c': ok('eng-c', 'C') });
  assert.deepEqual(readFormaCatalog(root).engines.map((t) => t.engine), ['eng-c']);
});

it('toml: the top-level values, a multiline string is skipped', () => {
  const { top, tables } = parseToml('name = "kit"\nmodel = "m-1" # c\nmodel_reasoning_effort = "medium"\ndeveloper_instructions = """\nmodel = "bad"\n"""\n[mcp_servers.site]\nurl = "x"\n');
  assert.equal(top.model, 'm-1');
  assert.equal(top.model_reasoning_effort, 'medium');
  assert.deepEqual(tables, ['mcp_servers.site']);
});

it('Codex: the nodes from toml, Run has one role and a note about the directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-toml-'));
  fs.mkdirSync(path.join(root, 'ag'));
  for (const n of ['kit', 'run']) fs.writeFileSync(path.join(root, 'ag', n + '.toml'), `name = "${n}"\nmodel = "m-${n}"\nmodel_reasoning_effort = "low"\n`);
  const cat = readTomlCatalog(root, { title: 'T', agentsDir: 'ag' });
  assert.deepEqual(cat.nodes.map((n) => n.name), ['Kit']);
  assert.equal(cat.runRoles.length, 1);
  assert.equal(cat.runRoles[0].model, 'm-run');
  assert.equal(cat.runNote.key, 'fm.runNote.single');
});

it('no roles directory -> rolesMissing, not a crash', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-none-'));
  assert.equal(readTomlCatalog(root, { title: 'T', agentsDir: 'x' }).rolesMissing, true);
  assert.equal(readMdCatalog(root, { title: 'T', rolesDir: 'x', mcpFiles: [] }).rolesMissing, true);
});

console.log(`\n${passed} passed`);
