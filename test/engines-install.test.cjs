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
    '.agents/rules/gemini-8.md', '.agents/forma-adapter.cjs', '.agents/verify-profile.cjs',
    '.agents/plugins/forma/plugin.json', '.agents/plugins/forma/agents/kit.md', '.agents/plugins/forma/mcp_config.json',
  ]) assert.ok(fs.existsSync(path.join(dir, f)), f);
  assert.ok(!fs.existsSync(path.join(dir, '.codex')), 'Codex sleeps - .codex/ is not installed');
  assert.match(r.stdout, /Gemini \(Antigravity\)/);
  assert.doesNotMatch(r.stdout, /Codex/);
  assert.doesNotMatch(r.stdout, /not verified/);
  assert.match(r.stdout, /install is intact/);
  const m = JSON.parse(fs.readFileSync(path.join(dir, '.forma', 'install-manifest.json'), 'utf8'));
  const gemini = (m.engines || []).find((e) => e.id === 'gemini');
  assert.ok(gemini && gemini.profile === '.agents/verify-profile.cjs', 'manifest declares gemini profile');
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
  // The zcode verify profile is declared and shipped: the note is gone, the mirror parity is checked at every install.
  assert.doesNotMatch(r.stdout, /not verified/);
  assert.ok(fs.existsSync(path.join(dir, '.zcode', 'verify-profile.cjs')), '.zcode/verify-profile.cjs installed');
  const m7 = JSON.parse(fs.readFileSync(path.join(dir, '.forma', 'install-manifest.json'), 'utf8'));
  const zrow = (m7.engines || []).find((e) => e.id === 'zcode');
  assert.ok(zrow && zrow.profile === '.zcode/verify-profile.cjs', 'manifest declares zcode profile');
  assert.equal(zrow.expect && zrow.expect.mirrorFrom, '.claude/agents', 'manifest records the mirror reference');
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

// The menu itself (piped stdin stands in for a TTY): Claude Code is shown as the frozen
// default and stays installed even when the human's numbers name only other engines.
test('the menu: Claude Code is the frozen default, another number only adds to it', () => {
  const d7 = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-menu-'));
  try {
    // "3" adds ZCode; the installer asks nothing else (the compact question moved to project-setup)
    const r = spawnSync(process.execPath, [FORMA, 'init', '--dir', d7, '--template', 'none', '--board', 'skip', '--lang', 'en'],
      { encoding: 'utf8', input: '3\n' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /selected by default/);
    assert.match(r.stdout, /✓ default — the core, always installed/);
    assert.ok(fs.existsSync(path.join(d7, '.claude', 'rules')), 'the frozen default (claude) is not installed');
    assert.ok(fs.existsSync(path.join(d7, '.zcode', 'forma-adapter.cjs')), 'the picked engine (zcode) is not installed');
  } finally { fs.rmSync(d7, { recursive: true, force: true }); }
});

// The template ships whole (v0.0.10): the template's own SKILL.md and its mcp.json lie down into
// .claude/skills/<name>/ (mcp.json connects nothing by itself), the template's Run roles into
// .claude/agents/run/ with the names recorded in .claude/project-layer.txt.
const TEMPLATE = 'forma-wordpress-novamira';

test('the template ships whole: SKILL.md, mcp.json, the run roles, project-layer.txt', () => {
  const d5 = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-template-'));
  try {
    const r = spawnSync(process.execPath, [FORMA, 'init', '--dir', d5, '--engines', 'claude', '--template', TEMPLATE, '--board', 'skip', '--yes'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const skill = path.join(d5, '.claude', 'skills', TEMPLATE);
    assert.ok(fs.existsSync(path.join(skill, 'SKILL.md')), 'the template SKILL.md in .claude/skills/<name>/');
    assert.ok(fs.existsSync(path.join(skill, 'mcp.json')), 'the template mcp.json next to the skill');
    const shipped = fs.readdirSync(path.resolve(__dirname, '..', 'templates', TEMPLATE, 'skills', TEMPLATE, 'template', 'agents', 'run')).filter((f) => /\.md$/.test(f));
    assert.ok(shipped.length >= 8, 'the template carries its run roles in the source (got ' + shipped.length + ')');
    const layer = fs.readFileSync(path.join(d5, '.claude', 'project-layer.txt'), 'utf8');
    for (const f of shipped) {
      assert.ok(fs.existsSync(path.join(d5, '.claude', 'agents', 'run', f)), f + ' installed into .claude/agents/run/');
      assert.ok(layer.includes('.claude/agents/run/' + f), f + ' recorded in project-layer.txt');
    }
    assert.match(r.stdout, /run roles written: /);
  } finally { fs.rmSync(d5, { recursive: true, force: true }); }
});

test('the template run roles: an existing profile is kept and named in the report', () => {
  const d6 = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-template2-'));
  try {
    const first = spawnSync(process.execPath, [FORMA, 'init', '--dir', d6, '--engines', 'claude', '--template', TEMPLATE, '--board', 'skip', '--yes'], { encoding: 'utf8' });
    assert.equal(first.status, 0, first.stdout + first.stderr);
    const role = path.join(d6, '.claude', 'agents', 'run', 'run-site-upload.md');
    assert.ok(fs.existsSync(role), 'the role file from the first install');
    fs.writeFileSync(role, '# the project edited this profile\n');
    const layer = path.join(d6, '.claude', 'project-layer.txt');
    const layerBefore = fs.readFileSync(layer, 'utf8');
    const second = spawnSync(process.execPath, [FORMA, 'init', '--dir', d6, '--engines', 'claude', '--template', TEMPLATE, '--board', 'skip', '--yes'], { encoding: 'utf8' });
    assert.equal(second.status, 0, second.stdout + second.stderr);
    assert.equal(fs.readFileSync(role, 'utf8'), '# the project edited this profile\n', 'an existing profile is not overwritten');
    assert.equal(fs.readFileSync(layer, 'utf8'), layerBefore, 'project-layer.txt carries no duplicate lines');
    assert.match(second.stdout, /run roles kept \(an existing profile is not overwritten\): .*run-site-upload\.md/);
  } finally { fs.rmSync(d6, { recursive: true, force: true }); }
});

// The regression: engines (with the zcode mirror rebuild) ran before the template, so the run roles the
// template wrote landed in .claude/agents/run/ after the mirror was built — a first install with zcode
// ended "install is broken" (the mirror had 24 roles against 31 in .claude/agents/run).
test('zcode + template: the roles the template wrote land in the mirror too — the install stays intact', () => {
  const d8 = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-templ-roles-'));
  try {
    const r = spawnSync(process.execPath, [FORMA, 'init', '--dir', d8, '--engines', 'claude,zcode', '--template', TEMPLATE, '--board', 'skip', '--lang', 'en', '--yes'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /install is intact/);
    assert.match(r.stdout, /run roles written: /);
    assert.doesNotMatch(r.stdout, /not verified/);
    // the adapter conformance with the mirror, as the installed project runs it
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'zcode-home-'));
    fs.mkdirSync(path.join(home, 'cli', 'rollout'), { recursive: true });
    try {
      const t = spawnSync(process.execPath, [path.join(d8, '.zcode', 'tests', 'test-zcode-adapter.cjs')],
        { encoding: 'utf8', cwd: d8, env: { ...process.env, ZCODE_HOME: home } });
      assert.equal(t.status, 0, t.stdout + t.stderr);
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  } finally { fs.rmSync(d8, { recursive: true, force: true }); }
});

// The profile's value over the hashes: a role the reference gains after the install (the template or the
// human adds one) moves no hash - only a regeneration sees the mirror lag. The zcode row names it with the
// address and the fix; the red verdict itself belongs to the main layer - with claude always installed,
// the core's parity checks (check-ready, sync-engines) catch the same drift and turn the install red.
test('zcode profile: a role new to the reference is named with its address and the fix, the red verdict stays the main layer\'s', () => {
  const d9 = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-zdrift-'));
  try {
    const r = spawnSync(process.execPath, [FORMA, 'init', '--dir', d9, '--engines', 'claude,zcode', '--board', 'skip', '--lang', 'en', '--yes'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    fs.writeFileSync(path.join(d9, '.claude', 'agents', 'zz-drift-probe.md'), '# drift probe\n');
    const v = spawnSync(process.execPath, [path.join(d9, '.forma', 'verify', 'verify-install.cjs')], { cwd: d9, encoding: 'utf8' });
    assert.equal(v.status, 1, 'the drift turns the install red on the main layer: ' + v.stdout);
    assert.match(v.stdout, /! warning: .*zcode\/agents/);
    assert.match(v.stdout, /gen-roles --check/);
    assert.match(v.stdout, /zz-drift-probe/);
  } finally { fs.rmSync(d9, { recursive: true, force: true }); }
});
