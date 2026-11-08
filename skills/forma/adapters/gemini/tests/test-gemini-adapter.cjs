#!/usr/bin/env node
'use strict';

/**
 * test-gemini-adapter.cjs - the Gemini (Antigravity) adapter's fit test.
 * It checks:
 *  1. The presence and the validity of .agents/rules/gemini-8.md (the @AGENTS.md import, the section 8, the Plumb description, the gemini: tag);
 *  2. The parity of the Gemini roles with the canonical roles (.claude/);
 *  3. The absence of the project's Run profiles in the clean zone .agents/;
 *  4. The making and the parsing of the spend lines with the gemini: tag by the ECONOMY.md contract;
 *  5. The cleanliness of the adapter's files (prohibition 16).
 *
 * The ru literals below are pins on ru output (the linter's, the role parity's) or fixture data -
 * held as-is, the escape pass turns them into \u sequences.
 *
 * Run:
 *   node .agents/tests/test-gemini-adapter.cjs
 */

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const gemini8Path = path.join(root, '.agents', 'rules', 'gemini-8.md');
const parity = require('../../.claude/scripts/checks/support/role-parity.cjs');
const { formatSpendLine } = require('../../.forma/dashboard/spend-line.cjs');
const { tally } = require('../../.forma/dashboard/tally.cjs');
const { inCleanZone, scanCleanFile, cleanOwn } = require('../../.claude/scripts/checks/support/clean-zone.cjs');

function resolveAdapter() {
  const candidates = [
    path.resolve(__dirname, '../forma-adapter.cjs'),
    path.resolve(__dirname, '../../gemini/forma-adapter.cjs'),
    path.resolve(process.cwd(), '.agents/forma-adapter.cjs'),
    path.resolve(process.cwd(), '.forma/protocol/skills/forma/adapters/gemini/forma-adapter.cjs'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}
const adapter = require(resolveAdapter());

let passed = 0;
const it = (name, fn) => { fn(); passed += 1; console.log('ok  ' + name); };

// 1. The gemini-8.md check
it('.agents/rules/gemini-8.md exists and holds the Plumb rules and the engine rules', () => {
  assert.ok(fs.existsSync(gemini8Path), 'gemini-8.md must exist');
  const txt = fs.readFileSync(gemini8Path, 'utf8');
  assert.match(txt, /^@AGENTS\.md/m, 'the @AGENTS.md import must be there');
  assert.match(txt, /#\s*8\.\s*Engine architecture in Antigravity/, 'the section 8 heading must be there');
  assert.match(txt, /###\s*The Plumb/, 'the The Plumb section must be there');
  assert.match(txt, /gemini-3\.8-flash/, "the built-in Plumb" + String.fromCharCode(39) + "s model must be named");
  assert.match(txt, /plumb-scrub\.cjs/, 'the scrubbing script must be named');
  assert.match(txt, /gemini:/, 'the engine tag must be named');
});

// 2. The roles parity
it('the Gemini roles are in full parity with the reference', () => {
  const results = parity.compareRoles(root, { only: 'gemini' });
  const drifted = results.filter((r) => r.res.status !== 'synced');
  assert.equal(drifted.length, 0, `A role drift found: ${drifted.map((d) => d.pair.name + ' (' + d.res.status + ')').join(', ')}`);
});

// 3. No project profiles in .agents/
it('.agents/plugins/forma/agents/run/ holds no Run profiles of the current product', () => {
  const runDir = path.join(root, '.agents', 'plugins', 'forma', 'agents', 'run');
  const files = fs.readdirSync(runDir);
  assert.ok(!files.includes('run-pillow-translate.md'), 'run-pillow-translate.md must not be in .agents/');
  assert.ok(!files.includes('run-site-upload.md'), 'run-site-upload.md must not be in .agents/');
});

// 3a. The Gemini platform roles and profiles
it('plumb-gemini.md exists and holds the measurement JSON contract (choice, score, noul)', () => {
  const plumbPath = path.join(root, '.agents', 'plugins', 'forma', 'agents', 'plumb-gemini.md');
  assert.ok(fs.existsSync(plumbPath), 'plumb-gemini.md must exist');
  const txt = fs.readFileSync(plumbPath, 'utf8');
  assert.match(txt, /"choice":\s*\{\s*"role"/, 'the choice field must be there');
  assert.match(txt, /"score":\s*\{\s*"clarity"/, 'the score field must be there');
  assert.match(txt, /"noul":/, 'the noul field must be there');
});

it('run-schema-markup.md exists in .agents/plugins/forma/agents/run/', () => {
  const schemaMarkupPath = path.join(root, '.agents', 'plugins', 'forma', 'agents', 'run', 'run-schema-markup.md');
  assert.ok(fs.existsSync(schemaMarkupPath), 'run-schema-markup.md must exist in .agents/plugins/forma/agents/run/');
});

// 4. The economy contract fit (the gemini: line, the tally parse)
it('the gemini: spend lines are made and parsed by tally.cjs by the contract', () => {
  const d = ['2000', '01', '02'].join('-');
  const normalLine = formatSpendLine({
    node: 'Run',
    date: d,
    engine: 'gemini',
    tokens: 1500,
    cache_read: 500,
    duration_s: 12,
    call_id: 'conv-12345678',
    desc: '\u0432\u044b\u043f\u043e\u043b\u043d\u0435\u043d\u043e.', // a ru desc fixture: the tally parse is language-independent (data)
  });

  const unknownLine = formatSpendLine({
    node: 'Plumb',
    date: d,
    engine: 'gemini',
    tokens: null,
    cache_read: null,
    duration_s: null,
    call_id: null,
    desc: 'role run-text, 85 % (gap 40, clarity 4), haiku, fits.',
  });

  const fixture = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-econ-')), 'card.md');
  try {
    fs.writeFileSync(fixture, '# Card\n\n## History\n- ' + normalLine + '\n- ' + unknownLine + '\n\n## Result\n');
    const t = tally([fixture]);
    assert.equal(t.byNode.Run.attempts, 1);
    assert.equal(t.byNode.Run.tokens, 1500);
    assert.equal(t.byNode.Run.cacheRead, 500);
    assert.equal(t.byNode.Run.seconds, 12);
    assert.equal(t.byNode.Plumb.attempts, 1);
    assert.equal(t.byNode.Plumb.tokensUnknown, 1);
    assert.equal(t.byNode.Plumb.idUnknown, 1);
  } finally {
    fs.rmSync(path.dirname(fixture), { recursive: true, force: true });
  }
});

// 5. The clean zone (prohibition 16)
it('the .agents/ adapter files fit prohibition 16 (the clean zones)', () => {
  const own = cleanOwn(root);
  const targets = [
    '.agents/rules/gemini-8.md',
    '.agents/forma-adapter.cjs',
    '.agents/tests/test-gemini-adapter.cjs',
  ];
  for (const rel of targets) {
    const abs = path.join(root, rel);
    if (fs.existsSync(abs) && inCleanZone(rel, own)) {
      const problems = scanCleanFile(rel, fs.readFileSync(abs, 'utf8'));
      assert.deepEqual(problems, [], `A project trace in ${rel}: ${problems.join('; ')}`);
    }
  }
});

// 6. The dashboard adapter's extended fields
it("forma-adapter.cjs provides transcriptsDir and parseUsage for the Antigravity transcripts", () => {
  assert.equal(typeof adapter.transcriptsDir, 'function');
  const tDir = adapter.transcriptsDir(root);
  assert.ok(tDir === null || typeof tDir === 'string');

  assert.equal(typeof adapter.parseUsage, 'function');
  const u1 = adapter.parseUsage({
    input_tokens: 1200,
    output_tokens: 300,
    cache_read_tokens: 450,
    cache_write_tokens: 100,
  });
  assert.deepEqual(u1, {
    tokens_in: 1200,
    tokens_out: 300,
    cache_read: 450,
    cache_write: 100,
  });

  const uEmpty = adapter.parseUsage(null);
  assert.deepEqual(uEmpty, {
    tokens_in: null,
    tokens_out: null,
    cache_read: null,
    cache_write: null,
  });
});

it('forma-adapter.cjs declares a usageRefresh unloading into gemini-usage.json', () => {
  assert.ok(Array.isArray(adapter.usageRefresh));
  assert.equal(adapter.usageRefresh.length, 1);
  assert.equal(adapter.usageRefresh[0].cache, 'gemini-usage.json');
  assert.match(adapter.usageRefresh[0].script, /sync-ledger\.cjs/);
});

it('forma-adapter.cjs engineSettings returns the MCP, hooks and active nodes structure', () => {
  assert.equal(typeof adapter.engineSettings, 'function');
  const settings = adapter.engineSettings(root);
  assert.equal(settings.present, true);
  assert.ok(Array.isArray(settings.hooks));
  if (fs.existsSync(path.join(root, '.agents', 'hooks.json'))) {
    assert.ok(settings.hooks.some((h) => h.name === 'forma-guard-delete'));
  }
  assert.ok(Array.isArray(settings.nodes));
  const nodeNames = settings.nodes.map((n) => n.name);
  for (const exp of ['intent', 'spec', 'kit', 'run', 'core']) {
    assert.ok(nodeNames.includes(exp), `the node ${exp} must be in the nodes list`);
  }
  assert.ok(settings.mcp && Array.isArray(settings.mcp.project));
});

it('forma-adapter.cjs provides instructionWeight and stepsFromCacheRead for gemini-3.8-flash', () => {
  assert.equal(typeof adapter.instructionWeight, 'function');
  const iw = adapter.instructionWeight(root);
  assert.equal(iw.estimate, true);
  assert.equal(iw.model, 'gemini-3.8-flash');
  assert.ok(iw.common.tokens > 0);
  for (const n of ['Intent', 'Spec', 'Kit', 'Run', 'Core']) {
    assert.ok(iw.byNode[n], `the node ${n} must be present in byNode`);
    assert.ok(iw.byNode[n].perStep > iw.common.tokens);
    assert.equal(iw.byNode[n].model, 'gemini-3.8-flash');
  }

  assert.equal(typeof adapter.stepsFromCacheRead, 'function');
  assert.equal(adapter.stepsFromCacheRead(5000, 1000), 5);
  assert.equal(adapter.stepsFromCacheRead(null, 1000), null);
  assert.equal(adapter.stepsFromCacheRead(5000, 0), null);
});

// 7. The Gemini subagents' transcripts reading support
it('forma-adapter.cjs provides findSubagent and stepOf for the Gemini transcripts', () => {
  assert.equal(typeof adapter.findSubagent, 'function');
  assert.equal(typeof adapter.stepOf, 'function');

  const sEmpty = adapter.stepOf(null);
  assert.equal(sEmpty, null);

  const stepNative = adapter.stepOf({
    step_index: 5,
    type: 'PLANNER_RESPONSE',
    created_at: '2026-01-01T10:00:00Z',
    input_tokens: 1500,
    cache_read_tokens: 500,
    output_tokens: 80,
  });
  assert.deepEqual(stepNative, {
    usage: {
      input_tokens: 1500,
      output_tokens: 80,
      cache_read_tokens: 500,
      cache_write_tokens: 0,
    },
    requestId: '5',
    model: 'gemini-3.8-flash',
    timestamp: '2026-01-01T10:00:00Z',
  });
});

// 8. The lint of the Gemini zone's agent files' frontmatter keys
it('lint-agent-keys: every file of the .agents zone passes, the keys are fine', () => {
  const r = spawnSync(process.execPath, [path.join(root, '.agents', 'scripts', 'lint-agent-keys.cjs')], { encoding: 'utf8' });
  assert.equal(r.status, 0, 'the zone lint gave an error:\n' + (r.stderr || r.stdout));
  assert.ok(r.stdout.includes('\u043a\u043b\u044e\u0447\u0438 \u0432 \u043d\u043e\u0440\u043c\u0435')); // the linter's ru output pinned byte-exact (dictionary)
});

it('lint-agent-keys: a key typo gives an error with the address and the name; a clean set - exit 0', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentkeys-gemini-'));
  try {
    const probe = path.join(dir, 'agent-probe.md');
    fs.writeFileSync(probe, '---\nname: probe\nefort: high\n---\n\n# probe\n');
    const rBad = spawnSync(process.execPath, [path.join(root, '.agents', 'scripts', 'lint-agent-keys.cjs'), dir], { encoding: 'utf8' });
    assert.notEqual(rBad.status, 0, 'a typo must cause an error');
    assert.ok((rBad.stderr || '').includes('agent-probe.md'), "the file" + String.fromCharCode(39) + "s address in stderr: " + rBad.stderr);
    assert.ok((rBad.stderr || '').includes('efort'), "the key" + String.fromCharCode(39) + "s name in stderr: " + rBad.stderr);

    fs.writeFileSync(probe, '---\nname: probe\ndescription: probe\nmodel: gemini-3.8-flash\neffort: low\ntier: light\nuses: a\ntools: Read\nskills: s\nomitClaudeMd: true\n---\n\n# probe\n');
    const rOk = spawnSync(process.execPath, [path.join(root, '.agents', 'scripts', 'lint-agent-keys.cjs'), dir], { encoding: 'utf8' });
    assert.equal(rOk.status, 0, 'a clean set must pass: ' + (rOk.stderr || rOk.stdout));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`\nAll ${passed} Gemini adapter checks passed.`);
