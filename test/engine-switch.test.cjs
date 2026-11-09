// The engine switch: the dormant registry is read, sleep and wake edit it, claude is not put to sleep.
// Rebuild skips an engine without an installed adapter (its zone is absent) with a marker and code 0;
// wake without an adapter fails loudly.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
// The script's ru output comes from the core dictionary: assertions match the same text by the key.
const RU = require('../skills/forma/core/i18n/messages/ru.json');
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ruSrc = (code, parts = {}) => String(RU[code]).split(/\{(\w+)\}/)
  .map((s, i) => (i % 2) ? (parts[s] || '[\\s\\S]*?') : escRe(s)).join('');
const ruRe = (code, parts) => new RegExp(ruSrc(code, parts));

const SCRIPT = path.resolve(__dirname, '..', 'skills', 'forma', 'adapters', 'claude', 'scripts', 'engine-switch.cjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-switch-'));
fs.mkdirSync(path.join(dir, '.forma'));
const registry = path.join(dir, '.forma', 'engines.json');
fs.writeFileSync(registry, '{ "dormant": ["codex"] }\n');
fs.mkdirSync(path.join(dir, '.agents', 'plugins', 'forma'), { recursive: true }); // the gemini zone - the adapter is installed
fs.mkdirSync(path.join(dir, '.claude', 'scripts'), { recursive: true });
fs.writeFileSync(path.join(dir, '.claude', 'scripts', 'sync-engines.cjs'), '');   // the gemini step passes
const sw = (...a) => spawnSync(process.execPath, [SCRIPT, ...a], { cwd: dir, encoding: 'utf8' });
const dormant = () => JSON.parse(fs.readFileSync(registry, 'utf8')).dormant;

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('status shows the sleeping and the active engines', () => {
  const r = sw('status');
  assert.equal(r.status, 0);
  assert.match(r.stdout, new RegExp('codex: ' + ruSrc('engine-switch.status_sleeping')));
  assert.match(r.stdout, new RegExp('gemini: ' + ruSrc('engine-switch.status_active')));
});

test('sleep and wake edit the registry, a repeat does not duplicate', () => {
  sw('sleep', 'gemini'); sw('sleep', 'gemini');
  assert.deepEqual(dormant(), ['codex', 'gemini']);
  sw('wake', 'gemini');
  assert.deepEqual(dormant(), ['codex']);
});

test('claude is not put to sleep, an unknown engine is rejected', () => {
  assert.equal(sw('sleep', 'claude').status, 1);
  assert.equal(sw('sleep', 'nope').status, 1);
  assert.deepEqual(dormant(), ['codex']);
});

test('wake codex without an adapter: a stop, not a silent success', () => {
  const r = sw('wake', 'codex');
  assert.equal(r.status, 1);
  assert.match(r.stderr, ruRe('engine-switch.missing_step', { step: '\\.codex\\/scripts\\/sync-codex\\.cjs' }));
});

// MiniMax: asleep by the registry, a rebuild by the REBUILD table in the given order, the sleeping one is not synced.
const MM_STEPS = ['.minimax/scripts/gen-roles.cjs', '.minimax/scripts/gen-plugin-agents.cjs', '.minimax/scripts/install-plugin.cjs', '.minimax/tests/test-minimax-adapter.cjs'];
const mmProject = (withSteps) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-switch-mm-'));
  fs.mkdirSync(path.join(d, '.forma'));
  fs.writeFileSync(path.join(d, '.forma', 'engines.json'), '{ "dormant": ["codex", "minimax"] }\n');
  fs.mkdirSync(path.join(d, '.agents', 'plugins', 'forma'), { recursive: true }); // the gemini zone - "active" in status
  if (withSteps) for (const s of MM_STEPS) {
    fs.mkdirSync(path.dirname(path.join(d, s)), { recursive: true });
    fs.writeFileSync(path.join(d, s), `require('fs').appendFileSync(${JSON.stringify(path.join(d, 'order.log'))}, ${JSON.stringify(s)} + '\\n');`);
  }
  return d;
};
const swIn = (d, ...a) => spawnSync(process.execPath, [SCRIPT, ...a], { cwd: d, encoding: 'utf8' });

test('status: minimax sleeps while it is in the registry', () => {
  const d = mmProject(false);
  try {
    const r = swIn(d, 'status');
    assert.match(r.stdout, new RegExp('minimax: ' + ruSrc('engine-switch.status_sleeping')));
    assert.match(r.stdout, new RegExp('codex: ' + ruSrc('engine-switch.status_sleeping')));
    assert.match(r.stdout, new RegExp('gemini: ' + ruSrc('engine-switch.status_active')));
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('wake minimax: the marker is lifted, the four rebuild steps run in order', () => {
  const d = mmProject(true);
  try {
    const r = swIn(d, 'wake', 'minimax');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(d, '.forma', 'engines.json'), 'utf8')).dormant, ['codex']);
    assert.deepEqual(fs.readFileSync(path.join(d, 'order.log'), 'utf8').trim().split(/\r?\n/), MM_STEPS);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('wake minimax without an adapter: a stop on the first step', () => {
  const d = mmProject(false);
  try {
    const r = swIn(d, 'wake', 'minimax');
    assert.equal(r.status, 1);
    assert.match(r.stderr, ruRe('engine-switch.missing_step', { step: '\\.minimax\\/scripts\\/gen-roles\\.cjs' }));
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('the sync reads the registry: a dormant engine is not synced (role parity and the adapter test)', () => {
  const dir = path.resolve(__dirname, '..', 'skills', 'forma', 'adapters', 'claude', 'scripts', 'checks');
  const dormantLib = require(path.join(dir, 'support', 'dormant.cjs'));
  const d = mmProject(false);
  try {
    assert.equal(dormantLib.isDormant(d, 'minimax'), true);
    fs.writeFileSync(path.join(d, '.forma', 'engines.json'), '{ "dormant": ["codex"] }\n');
    assert.equal(dormantLib.isDormant(d, 'minimax'), false);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
  assert.match(fs.readFileSync(path.join(dir, 'support', 'role-parity.cjs'), 'utf8'), /!isDormant\(root, p\.id\)/);
  assert.match(fs.readFileSync(path.join(dir, 'adapter-conformance.cjs'), 'utf8'), /id: E\.idOf\(a\)/);
});

// rebuild: all active engines by the REBUILD table, the sleeping ones untouched.
const GEM_STEP = '.claude/scripts/sync-engines.cjs';
const rbProject = (dormantList, withGemini) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-switch-rb-'));
  fs.mkdirSync(path.join(d, '.forma'));
  fs.writeFileSync(path.join(d, '.forma', 'engines.json'), JSON.stringify({ dormant: dormantList }) + '\n');
  fs.mkdirSync(path.join(d, '.agents', 'plugins', 'forma'), { recursive: true }); // the gemini zone - the adapter is installed
  if (withGemini) {
    fs.mkdirSync(path.dirname(path.join(d, GEM_STEP)), { recursive: true });
    fs.writeFileSync(path.join(d, GEM_STEP), `require('fs').appendFileSync(${JSON.stringify(path.join(d, 'order.log'))}, process.argv.slice(2).join(' ') + '\\n');`);
  }
  return d;
};

test('rebuild: the active gemini is rebuilt once, the sleeping codex, kimi and minimax untouched', () => {
  const d = rbProject(['codex', 'kimi', 'minimax'], true);
  try {
    const r = swIn(d, 'rebuild');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(fs.readFileSync(path.join(d, 'order.log'), 'utf8').trim().split(/\r?\n/), ['--apply']);
    assert.match(r.stdout, ruRe('engine-switch.rebuilt', { built: 'gemini' }));
    assert.match(r.stdout, ruRe('engine-switch.skipped_suffix', { list: 'codex, kimi, minimax' }));
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('rebuild: the gemini step fails with code 1 - the command stops, not a silent success', () => {
  const d = rbProject(['codex', 'minimax'], true);
  fs.writeFileSync(path.join(d, GEM_STEP), 'process.exit(1);');
  try {
    const r = swIn(d, 'rebuild');
    assert.equal(r.status, 1);
    assert.match(r.stderr, ruRe('engine-switch.rebuild_failed', { id: 'gemini' }));
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('rebuild: no script for an active engine step - a stop with the file name', () => {
  const d = rbProject(['codex', 'minimax'], false);
  try {
    const r = swIn(d, 'rebuild');
    assert.equal(r.status, 1);
    assert.match(r.stderr, ruRe('engine-switch.missing_step', { step: '\\.claude\\/scripts\\/sync-engines\\.cjs' }));
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('rebuild: the woken minimax joins the rebuild in the REBUILD order', () => {
  const d = rbProject(['codex', 'kimi'], true);
  for (const s of MM_STEPS) {
    fs.mkdirSync(path.dirname(path.join(d, s)), { recursive: true });
    fs.writeFileSync(path.join(d, s), `require('fs').appendFileSync(${JSON.stringify(path.join(d, 'order.log'))}, ${JSON.stringify(s)} + '\\n');`);
  }
  try {
    const r = swIn(d, 'rebuild');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(fs.readFileSync(path.join(d, 'order.log'), 'utf8').trim().split(/\r?\n/), ['--apply', ...MM_STEPS]);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

// Guard: an environment with no installed adapters - rebuild does not fall, the engines are marked skipped.
test('rebuild: an environment without adapters - skip markers, code 0', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-switch-skip-'));
  fs.mkdirSync(path.join(d, '.forma'));
  fs.writeFileSync(path.join(d, '.forma', 'engines.json'), '{ "dormant": [] }\n');
  try {
    const r = swIn(d, 'rebuild');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, ruRe('engine-switch.no_adapter_suffix', { list: 'codex, gemini, kimi, minimax, zcode' }));
    for (const e of ['codex', 'gemini', 'kimi', 'minimax', 'zcode']) {
      assert.match(r.stdout, new RegExp('^' + ruSrc('engine-switch.skipped_no_adapter', { id: e }) + '$', 'm'));
    }
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('status: an engine without an adapter - "not installed", not "active"', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-switch-st-'));
  fs.mkdirSync(path.join(d, '.forma'));
  fs.writeFileSync(path.join(d, '.forma', 'engines.json'), '{ "dormant": [] }\n');
  try {
    const r = swIn(d, 'status');
    assert.equal(r.status, 0);
    assert.match(r.stdout, new RegExp('zcode: ' + ruSrc('engine-switch.status_not_installed')));
    assert.doesNotMatch(r.stdout, new RegExp('zcode: ' + ruSrc('engine-switch.status_active')));
    assert.match(r.stdout, new RegExp('claude: ' + ruSrc('engine-switch.status_active')));
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
