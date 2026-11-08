'use strict';
// node .claude/scripts/plumb-run.test.cjs — reads the real Plumb row of project/config/PROJECT.md.
// PLUMB_RUN=<file> points the test at another copy of the driver (to show it fails on old code).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const driver = process.env.PLUMB_RUN ? path.resolve(process.env.PLUMB_RUN) : path.join(root, '.forma', 'plumb', 'plumb-run.cjs');
const { readThresholds, plumbLine, readModel } = require(driver);

assert.strictEqual(typeof readThresholds, 'function', 'readThresholds exported');
assert.strictEqual(typeof plumbLine, 'function', 'plumbLine exported');

// Real row: jev has all four thresholds, none null.
const jev = readThresholds(root, 'jev');
assert.ok(jev, 'jev thresholds read');
assert.deepStrictEqual(jev, { leader: 70, gap: 20, noul: 70, clarity: 3 });
for (const v of Object.values(jev)) assert.notStrictEqual(v, null);

// haiku: leader and gap only; noul and clarity may be null.
const haiku = readThresholds(root, 'haiku');
assert.ok(haiku, 'haiku thresholds read');
assert.strictEqual(haiku.leader, 60);
assert.strictEqual(haiku.gap, 20);
assert.ok(haiku.noul == null && haiku.clarity == null);

// Legacy form (thresholds as text inside the Plumb row): three spellings of the gap key give one value.
const legacy = (key) => '| Plumb `plumb` | `jev`. haiku: \u043b\u0438\u0434\u0435\u0440 ≥ 60 %, ' + key + ' ≥ 20 \u043f.\u043f.; jev: \u043b\u0438\u0434\u0435\u0440 ≥ 70 %, ' + key + ' ≥ 20 \u043f.\u043f., noul \u043b\u0438\u0434\u0435\u0440\u0430 ≥ 70 %, \u044f\u0441\u043d\u043e\u0441\u0442\u044c ≥ 3 \u0438\u0437 4 |\n';
for (const key of ['\u043e\u0442\u0440\u044b\u0432 \u043e\u0442 \u0432\u0442\u043e\u0440\u043e\u0433\u043e', '\u0437\u0430\u0437\u043e\u0440', 'gap']) { // the ru keys are the legacy spellings the driver parses (data)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plumbrow-'));
  fs.mkdirSync(path.join(tmp, 'project', 'config'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'project', 'config', 'PROJECT.md'), legacy(key));
  const t = readThresholds(tmp, 'jev');
  assert.ok(t && t.gap === 20 && t.leader === 70, `gap key "${key}"`);
}

// Real PROJECT.md keeps the thresholds as anchored table rows (plumb.jev.gap …): rows win over the legacy text.
assert.ok(/k:plumb\.jev\.gap/.test(fs.readFileSync(path.join(root, 'project', 'config', 'PROJECT.md'), 'utf8')), 'anchored threshold rows');

// One scale: noul as a share 0..1 against a threshold in percent.
function result(noulValue) {
  return {
    choice: { role: 'r1', probabilities: { r1: 91, r2: 5 }, confidence: 90 },
    score: { clarity: 3, confidence: 80 },
    noul: { r1: noulValue },
    meta: { executor: 'jev', model_requested: 'm', id: 'x', usage: {}, cost_usd: 0, duration_ms: 1 },
  };
}
const low = plumbLine(result(0.5), root);
const high = plumbLine(result(0.9), root);
assert.ok(/\u043d\u0438\u0436\u0435 \u043f\u043e\u0440\u043e\u0433\u0430/.test(low) && /noul/.test(low), low); // the driver's ru output pinned byte-exact
assert.ok(/\u043f\u043e\u0440\u043e\u0433\u0438 \u043f\u0440\u043e\u0439\u0434\u0435\u043d\u044b/.test(high), high);
assert.ok(!/\u043d\u0435 \u043f\u0440\u043e\u0447\u0438\u0442\u0430\u043d\u044b/.test(low) && !/\u043d\u0435 \u043f\u0440\u043e\u0447\u0438\u0442\u0430\u043d\u044b/.test(high));

// Model name comes from PROJECT.md (routes.plumb_model); a missing file falls back to the constant.
assert.strictEqual(typeof readModel, 'function', 'readModel exported');
const projectMd = fs.readFileSync(path.join(root, 'project', 'config', 'PROJECT.md'), 'utf8');
const wantModel = /routes\.plumb_model -->[^|]*\|[^`]*`([\w.-]+\/[\w.:-]+)`/.exec(projectMd)[1];
assert.strictEqual(readModel(root), wantModel);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plumb-model-'));
fs.mkdirSync(path.join(tmp, 'project', 'config'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'project', 'config', 'PROJECT.md'), '| x <!-- k:routes.plumb_model --> | model `acme/test-9.9`; |\n');
assert.strictEqual(readModel(tmp), 'acme/test-9.9');
fs.rmSync(tmp, { recursive: true, force: true });
assert.strictEqual(readModel(path.join(os.tmpdir(), 'no-such-root-xyz')), 'typesafe/jev-1.14');

console.log('plumb-run.test: ok');
