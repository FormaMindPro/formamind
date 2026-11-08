'use strict';

// The engine's contract (ENGINE-CONTRACT.md) on the real adapter: every clause of `engines.cjs check`, own
// sources in their own folder, the spend tag, the node-model-effort table, not a single path from a foreign folder.
//   node .minimax/tests/test-contract.cjs

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const E = require('../../.forma/dashboard/lib/engines.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const DIR = '.minimax';
const a = E.loadAdapters(ROOT).find((x) => x.dir === DIR);
assert.ok(a, 'the adapter ' + DIR + ' was not found by the core');

const bad = E.checkAdapter(a, ROOT).filter((r) => !r.ok);
assert.deepStrictEqual(bad, [], 'contract clauses failed: ' + JSON.stringify(bad));

const src = E.sourcesOf(a);
assert.ok(src.scriptsDir.startsWith(DIR + '/'), 'scriptsDir is outside its own folder: ' + src.scriptsDir);
assert.ok(src.rolesDir.startsWith(DIR + '/'), 'rolesDir is outside its own folder: ' + src.rolesDir);
assert.ok(src.packageManifest && fs.existsSync(path.join(ROOT, ...src.packageManifest.split('/'))), 'packageManifest is not declared or the file is absent');
assert.ok(a.spendTag && E.spendTags(ROOT).includes(a.spendTag), 'the spendTag is not visible to the core');
assert.strictEqual(E.engineTags(ROOT).find((t) => t.aliases.includes(a.spendTag)).tag, a.spendTag, 'the main spend tag diverges from the spendTag');
assert.strictEqual(E.modeOf(a), E.MODE_FULL);
console.log('ok  the engine contract ' + DIR + ': sources, spend tag, node-model-effort table');
