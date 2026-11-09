// Gemini (beta) is installed by the installer; Codex and MiniMax sleep (core/engines.json) - not installed, an explicit request is rejected.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FORMA = path.resolve(__dirname, '..', 'bin', 'forma.cjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-engines-'));
const init = (engines) => spawnSync(process.execPath, [FORMA, 'init', '--dir', dir, '--engines', engines, '--board', 'skip', '--yes'], { encoding: 'utf8' });

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('claude,gemini: the Gemini adapter installed, Codex not installed, the sync intact', () => {
  const r = init('claude,gemini');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  for (const f of [
    '.forma/engines.json',
    '.agents/rules/gemini-8.md', '.agents/forma-adapter.cjs', '.agents/plugins/forma/plugin.json', '.agents/plugins/forma/agents/kit.md', '.agents/plugins/forma/mcp_config.json',
  ]) assert.ok(fs.existsSync(path.join(dir, f)), f);
  assert.ok(!fs.existsSync(path.join(dir, '.codex')), 'Codex sleeps - .codex/ is not installed');
  assert.match(r.stdout, /Gemini \(Antigravity\)/);
  assert.doesNotMatch(r.stdout, /Codex/);
  assert.match(r.stdout, /install is intact/);
});

test('a second run does not overwrite the project mcp_config.json', () => {
  const mcp = path.join(dir, '.agents', 'plugins', 'forma', 'mcp_config.json');
  fs.writeFileSync(mcp, '{"mcpServers":{"site":{}}}');
  const r = init('claude,gemini');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(fs.readFileSync(mcp, 'utf8'), /"site"/);
});

test('--engines codex: a dormant engine is rejected with code 2, nothing is installed', () => {
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-engines2-'));
  try {
    const r = spawnSync(process.execPath, [FORMA, 'init', '--dir', d2, '--engines', 'codex', '--board', 'skip', '--yes'], { encoding: 'utf8' });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /dormant/);
    assert.ok(!fs.existsSync(path.join(d2, '.codex')));
  } finally { fs.rmSync(d2, { recursive: true, force: true }); }
});

test('--engines minimax: a dormant engine is rejected with code 2, nothing is installed', () => {
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-engines3-'));
  try {
    const r = spawnSync(process.execPath, [FORMA, 'init', '--dir', d2, '--engines', 'minimax', '--board', 'skip', '--yes'], { encoding: 'utf8' });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /minimax is dormant/);
    assert.ok(!fs.existsSync(path.join(d2, '.minimax')));
    assert.ok(!fs.existsSync(path.join(d2, 'miniapps', 'minimax-engine')));
  } finally { fs.rmSync(d2, { recursive: true, force: true }); }
});

test('the --engines help does not offer minimax as a choice', () => {
  const r = spawnSync(process.execPath, [FORMA, 'init', '--help'], { encoding: 'utf8' });
  const line = r.stdout.split(String.fromCharCode(10)).find((l) => l.includes('--engines'));
  assert.match(line, /minimax are dormant/);
  assert.ok(!line.includes('claude[,minimax'));
});

test('the default install: neither .minimax/ nor miniapps/minimax-engine/', () => {
  const d3 = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-engines4-'));
  try {
    const r = spawnSync(process.execPath, [FORMA, 'init', '--dir', d3, '--board', 'skip', '--yes'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(!fs.existsSync(path.join(d3, '.minimax')));
    assert.ok(!fs.existsSync(path.join(d3, 'miniapps', 'minimax-engine')));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(d3, '.forma', 'engines.json'), 'utf8')).dormant, ['codex', 'minimax']);
  } finally { fs.rmSync(d3, { recursive: true, force: true }); }
});

test('claude,zcode: the ZCode adapter installed, .state not shipped, the skill mirror in place, the adapter intact on a fresh machine', () => {
  const r = init('claude,zcode');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  for (const f of [
    '.zcode/rules/zcode-8.md', '.zcode/forma-adapter.cjs', '.zcode/scripts/gen-roles.cjs',
    '.zcode/tests/test-zcode-adapter.cjs', '.zcode/agents/intent.md', '.agents/skills/grilling',
  ]) assert.ok(fs.existsSync(path.join(dir, f)), f);
  assert.ok(!fs.existsSync(path.join(dir, '.zcode', '.state')), 'the .state/ machine state is not shipped into someone else\'s project');
  assert.match(r.stdout, /ZCode: .*— installed/);
  assert.match(r.stdout, /gen-roles: role mirror rebuilt/);
  // The v0.0.5 red regression: the adapter conformance entirely on a fresh install. ZCODE_HOME
  // is swapped to an empty rollout - the check does not depend on whether ZCode sits on this machine.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'zcode-home-'));
  fs.mkdirSync(path.join(home, 'cli', 'rollout'), { recursive: true });
  try {
    const t = spawnSync(process.execPath, [path.join(dir, '.zcode', 'tests', 'test-zcode-adapter.cjs')],
      { encoding: 'utf8', cwd: dir, env: { ...process.env, ZCODE_HOME: home } });
    assert.equal(t.status, 0, t.stdout + t.stderr);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('--engines zcode: claude is installed by the core automatically, the skills in place', () => {
  const d4 = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-engines5-'));
  try {
    const r = spawnSync(process.execPath, [FORMA, 'init', '--dir', d4, '--engines', 'zcode', '--board', 'skip', '--yes'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(fs.existsSync(path.join(d4, '.zcode', 'forma-adapter.cjs')), '.zcode/ was not installed');
    assert.ok(fs.existsSync(path.join(d4, '.claude', 'rules')), 'claude was not installed by the core');
    assert.ok(fs.existsSync(path.join(d4, '.agents', 'skills')), 'the shared skill mirror was not installed');
    assert.ok(!fs.existsSync(path.join(d4, '.zcode', '.state')), 'the machine state is not shipped');
  } finally { fs.rmSync(d4, { recursive: true, force: true }); }
});
