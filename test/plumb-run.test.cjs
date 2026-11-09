'use strict';

// plumb-run.cjs: the verdict in the Plumb history line follows the actual check against the PROJECT.md
// thresholds. The driver is required from the training install (bin/forma.cjs init): the protocol source
// copy has no sibling scrubber/bridge of its own, the install does. The threshold rows are synthetic
// PROJECT.md fixtures: the live spelling (a fraction noul followed by a list comma) is pinned - that
// spelling used to parse as NaN and the line said "thresholds passed" on noul 0.67 against 0.75 - and so
// are the percent spelling, the decimal-comma spelling and the anchored-row shape. The Russian fragments
// of the driver's own output are asserted through the dictionary values, never through a pinned copy.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { makeFixture } = require('./helpers/fixture.cjs');
const RU = require('../skills/forma/core/i18n/messages/ru.json');

// The temp base: FORMA_TEST_TMP when the path is alive, then the RAM disk, then the system fallback
// (the rule of the RAM disk). A dead FORMA_TEST_TMP falls through - the variable is never trusted blindly.
function tmpBase() {
  const env = process.env.FORMA_TEST_TMP;
  if (env && fs.existsSync(env)) return env;
  if (process.platform === 'win32' && fs.existsSync('R:\\')) return 'R:\\forma-tmp';
  if (process.platform !== 'win32' && fs.existsSync('/dev/shm')) return '/dev/shm';
  return os.tmpdir();
}

const ru = (code, parts = {}) => String(RU[code]).replace(/\{(\w+)\}/g, (m, k) => (k in parts ? parts[k] : m));

// The live spelling of the thresholds row: the Russian labels the driver parses by the keys.json aliases,
// written by escapes (the gate guards this file too). Punctuation is the point: the list comma right
// after the decimal "0.75," is the spelling that used to poison the parse.
const LEGACY = '| \u041E\u0442\u0432\u0435\u0441 `plumb` | `jev`. \u041F\u043E\u0440\u043E\u0433\u0438: '
  + '\u043B\u0438\u0434\u0435\u0440 ≥ 80, \u0437\u0430\u0437\u043E\u0440 \u0434\u043E \u0432\u0442\u043E\u0440\u043E\u0433\u043E ≥ 40, '
  + 'noul \u043B\u0438\u0434\u0435\u0440\u0430 ≥ 0.75, \u044F\u0441\u043D\u043E\u0441\u0442\u044C ≥ 3 \u0438\u0437 4 |';
const LEGACY_PERCENT = LEGACY.replace('0.75', '75 %');
const LEGACY_COMMA = LEGACY.replace('0.75', '0,75');
const ANCHORED = [
  '| Leader <!-- k:plumb.jev.leader --> | 80 |',
  '| Gap <!-- k:plumb.jev.gap --> | 40 |',
  '| noul <!-- k:plumb.jev.noul --> | 0.75 |',
  '| Clarity <!-- k:plumb.jev.clarity --> | 3 |',
].join('\n');
const HAIKU_ROWS = [
  '| Leader <!-- k:plumb.haiku.leader --> | 60 |',
  '| Gap <!-- k:plumb.haiku.gap --> | 20 |',
].join('\n');

let fx, driver;
test.before(() => {
  fx = makeFixture();
  driver = require(path.join(fx.root, '.forma', 'plumb', 'plumb-run.cjs'));
});
test.after(() => { if (fx) fx.cleanup(); });

const withMd = (mdText, fn) => {
  const root = fs.mkdtempSync(path.join(tmpBase(), 'plumb-th-'));
  try {
    fs.mkdirSync(path.join(root, 'project', 'config'), { recursive: true });
    fs.writeFileSync(path.join(root, 'project', 'config', 'PROJECT.md'), mdText);
    return fn(root);
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
};
const result = ({ probs = { 'run-probe': 91, 'run-other': 4 }, clarity = 4, noul = { 'run-probe': 0.9 }, executor = 'jev' } = {}) => ({
  choice: { role: 'run-probe', probabilities: probs, confidence: 90 },
  score: { clarity, confidence: 80 },
  noul,
  meta: { executor, model_requested: 'probe/model', id: 'probe-id-1', usage: {}, cost_usd: 0, duration_ms: 1 },
});

test('plumb-run: the live row spelling parses - the list comma after a decimal does not poison the number', () => {
  withMd(LEGACY + '\n', (root) => {
    assert.deepStrictEqual(driver.readThresholds(root, 'jev'), { leader: 80, gap: 40, noul: 0.75, clarity: 3 });
  });
  withMd(LEGACY_COMMA + '\n', (root) => {
    assert.deepStrictEqual(driver.readThresholds(root, 'jev'), { leader: 80, gap: 40, noul: 0.75, clarity: 3 }, 'decimal comma 0,75');
  });
  withMd(LEGACY_PERCENT + '\n', (root) => {
    assert.deepStrictEqual(driver.readThresholds(root, 'jev'), { leader: 80, gap: 40, noul: 75, clarity: 3 }, 'percent spelling');
  });
});

test('plumb-run: anchored threshold rows win, haiku reads leader and gap only', () => {
  withMd(ANCHORED + '\n', (root) => {
    assert.deepStrictEqual(driver.readThresholds(root, 'jev'), { leader: 80, gap: 40, noul: 0.75, clarity: 3 });
  });
  withMd(HAIKU_ROWS + '\n', (root) => {
    assert.deepStrictEqual(driver.readThresholds(root, 'haiku'), { leader: 60, gap: 20, noul: null, clarity: null });
  });
});

test('plumb-run: no thresholds row - the verdict says unread, never "passed"', () => {
  withMd('# probe\n\nno thresholds on this page\n', (root) => {
    assert.equal(driver.readThresholds(root, 'jev'), null);
    const line = driver.plumbLine(result(), root);
    assert.ok(line.includes(RU['plumb.thresholds_unread']), line);
    assert.ok(!line.includes(RU['plumb.thresholds_passed']), line);
  });
});

test('plumb-run: noul below the threshold writes "below threshold" with the reason named', () => {
  withMd(LEGACY + '\n', (root) => {
    const head = String(RU['plumb.below_threshold']).split('{miss}')[0];
    const low067 = driver.plumbLine(result({ noul: { 'run-probe': 0.67 } }), root);
    assert.ok(low067.includes(head), low067);
    assert.ok(low067.includes(ru('plumb.miss_noul', { v: 0.67, t: 0.75 })), low067);
    const low026 = driver.plumbLine(result({ noul: { 'run-probe': 0.26 } }), root);
    assert.ok(low026.includes(ru('plumb.miss_noul', { v: 0.26, t: 0.75 })), low026);
  });
  withMd(LEGACY_PERCENT + '\n', (root) => {
    // the percent-written threshold (75) compares against the same fraction 0.67
    const pct = driver.plumbLine(result({ noul: { 'run-probe': 0.67 } }), root);
    assert.ok(pct.includes(ru('plumb.miss_noul', { v: 0.67, t: 0.75 })), pct);
  });
});

test('plumb-run: passing numbers write "thresholds passed"; misses name leader, gap, clarity, missing noul', () => {
  withMd(LEGACY + '\n', (root) => {
    const pass = driver.plumbLine(result(), root);
    assert.ok(pass.includes(RU['plumb.thresholds_passed']), pass);
    assert.ok(pass.startsWith(String(RU['plumb.history_line']).split('{date}')[0]), pass);
    const lead = driver.plumbLine(result({ probs: { 'run-probe': 70, 'run-other': 4 } }), root);
    assert.ok(lead.includes(ru('plumb.miss_leader', { v: 70, t: 80 })), lead);
    const gap = driver.plumbLine(result({ probs: { 'run-probe': 91, 'run-other': 60 } }), root);
    assert.ok(gap.includes(ru('plumb.miss_gap', { v: 31, t: 40 })), gap);
    const clar = driver.plumbLine(result({ clarity: 2 }), root);
    assert.ok(clar.includes(ru('plumb.miss_clarity', { v: 2, t: 3 })), clar);
    const noNoul = driver.plumbLine(result({ noul: {} }), root);
    assert.ok(noNoul.includes(ru('plumb.miss_noul_missing', { t: 0.75 })), noNoul);
  });
});
