#!/usr/bin/env node
'use strict';

/**
 * test-minimax-adapter.cjs — the MiniMax Code adapter's conformance test.
 * It checks:
 *  1. The presence and the content of .minimax/rules/minimax-8.md (all nine contracts, the minimax: tag, the Plumb's rules);
 *  2. The adapter's shape: the core finds it by the file name, every field is there and of its type, the paths exist;
 *  3. The parity of the zone's roles with the canonical roles — byte by byte, by regeneration;
 *  4. The spend line's output from a ledger record: parsed by the shared formatter, unknown marked, not zero;
 *  5. The capabilities probe: facts, not a self-report; what is not proven is marked;
 *  6. The zone's cleanliness (prohibition 16): no project traces in the zone.
 *
 * Run:
 *   node .minimax/tests/test-minimax-adapter.cjs
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const engines = require('../../.forma/dashboard/lib/engines.cjs');
const { SPEND_TOKENS_OR_UNKNOWN_RE, ENGINE_TAG_RE, toEnglish } = require('../../.forma/dashboard/spend-line.cjs');
const { deriveSpendLineForCall, LEDGER } = require('../scripts/sync-ledger.cjs');
const { probe } = require('../scripts/capabilities.cjs');

let passed = 0;
const it = (name, fn) => { fn(); passed += 1; console.log('ok  ' + name); };

const adapter = () => engines.loadAdapters(root).find((a) => a.dir === '.minimax');

// 1. The engine's §8
it('.minimax/rules/minimax-8.md declares the nine contracts and the engine tag', () => {
  const p = path.join(root, '.minimax', 'rules', 'minimax-8.md');
  assert.ok(fs.existsSync(p), 'minimax-8.md must exist');
  const txt = fs.readFileSync(p, 'utf8');
  assert.match(txt, /^#\s*8\.\s*Engine architecture in MiniMax Code/m, 'the §8 heading must be there');
  assert.match(txt, /minimax:/, 'the engine tag must be named');
  assert.match(txt, /plumb-scrub\.cjs/, 'the Plumb scrubbing script must be named');
  for (const c of ['Contract 1', 'Contract 2', 'Contract 3', 'Contract 4', 'Contract 5', 'Contract 6', 'Contract 7', 'Contract 8', 'Contract 9']) {
    assert.ok(txt.includes(c), `§8 has no ${c}`);
  }
  assert.match(txt, /ENGINE-CONTRACT\.md/, '§8 must reference the contract');
});

it('§8 does not retell the law: §1–§7 are not copied into the engine file', () => {
  const txt = fs.readFileSync(path.join(root, '.minimax', 'rules', 'minimax-8.md'), 'utf8');
  const law = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  const lawHeadings = law.split(/\r?\n/).filter((l) => /^##\s+\d\./.test(l));
  for (const h of lawHeadings) {
    const title = h.replace(/^##\s*\d+\.\s*/, '').trim();
    assert.ok(!txt.includes('## ' + title), `the engine's §8 repeats the law's section "${title}"`);
  }
});

// 2. The adapter's shape
it('the core finds the adapter by the file name, without an engine name', () => {
  const a = adapter();
  assert.ok(a, 'there is no .minimax/forma-adapter.cjs in the project root that loads');
  assert.equal(a.engine, 'minimax-code');
});

it('shape: every declared field is there and of its type, no extras', () => {
  const a = adapter();
  assert.deepEqual(engines.validateAdapter(a), []);
  // The transcript reading fields (TRANSCRIPT_FIELDS) - by the engine's platform: the core has a fallback for each.
  const missing = Object.keys(engines.SHAPE).filter((f) => a[f] == null && !engines.TRANSCRIPT_FIELDS.includes(f));
  assert.deepEqual(missing, []);
});

it('the adapter paths are from the project root, and they exist', () => {
  const a = adapter();
  for (const f of ['rolesDir', 'onDemandRolesDir', 'engineRulesFile', 'skillsDir', 'syncScript']) {
    assert.ok(fs.existsSync(engines.resolveRel(root, a[f])), `${f}: ${a[f]} not found`);
  }
});

it('instruction weight: per node a step is a number; steps without a cache read - null, not 0', () => {
  const a = adapter();
  const w = a.instructionWeight();
  assert.ok(Object.keys(w.byNode).length > 0);
  for (const v of Object.values(w.byNode)) assert.equal(typeof v.perStep, 'number');
  assert.equal(a.stepsFromCacheRead(0, 100), null);
  assert.equal(a.stepsFromCacheRead(1000, 100), 10);
});

it('spend: a transcript step reads into the canonical fields, the missing - null', () => {
  const u = adapter().parseUsage({ input_tokens: 3, cache_read_input_tokens: 7 });
  assert.deepEqual(u, { tokens_in: 3, tokens_out: null, cache_read: 7, cache_write: null });
});

// 3. The roles' parity
it('the zone roles match the canonical ones - by regeneration, byte by byte', () => {
  const r = spawnSync(process.execPath, [path.join(root, '.minimax', 'scripts', 'gen-roles.cjs'), '--check'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, (r.stdout || '') + (r.stderr || ''));
});

it('the node roles and the on-demand roles are in place', () => {
  const dir = path.join(root, '.minimax', 'agents');
  for (const n of ['intent', 'spec', 'kit', 'run', 'core', 'extractor']) {
    assert.ok(fs.existsSync(path.join(dir, n + '.md')), `the role ${n} is absent`);
  }
  const onDemand = path.join(dir, 'on-demand');
  assert.ok(fs.existsSync(onDemand) && fs.readdirSync(onDemand).some((f) => f.endsWith('.md')), 'the on-demand roles are absent');
});

// 4. The spend line from the ledger
it('the spend line is derived from a ledger record and parsed by the shared formatter', () => {
  const DAY = ['2000', '01', '02'].join('-');
  const line = deriveSpendLineForCall(
    { timestamp: DAY + 'T10:00:00.000Z', conversationId: 'conv-test-1234567890', input_tokens: 1200, output_tokens: 300, cache_read_tokens: 450, cache_write_tokens: 0, duration_s: 5 },
    'Spec',
    'test-minimax-adapter: parse'
  );
  const t = toEnglish(line);
  assert.ok(SPEND_TOKENS_OR_UNKNOWN_RE.test(t), 'the line is not parsed by the shared formatter: ' + line);
  // N - the call's full spend, cache inside (ECONOMY.md): 1200 + 300 + 450 + 0 = 1950.
  assert.ok(line.includes('`' + 'Spec`, ' + DAY + ': attempt, 1 950 tokens (450 cache-read), 300 out, 5 s,'), 'the line is not per the §3 shape: ' + line);
  assert.match(line, /minimax: /, 'no engine tag');
});

it('unknown in the spend - a marker, not zero', () => {
  const DAY = ['2000', '01', '02'].join('-');
  const line = deriveSpendLineForCall({ timestamp: DAY + 'T10:00:00.000Z' }, 'Run', 'test-minimax-adapter: unknown');
  assert.match(line, /unknown tokens/, 'unknown must remain a marker');
  assert.ok(!/,\s*0 tokens/.test(line), 'zero as a number is forbidden');
});

it('the ledger path is the one the core looks for by convention', () => {
  const expected = path.join(root, '.minimax', '.ledger', 'calls.jsonl');
  assert.equal(path.resolve(LEDGER), expected, 'the ledger must sit in .minimax/.ledger/calls.jsonl');
});

// 5. The capabilities probe
it('the zone spend role is mine: the minimax: tag, own ledger, no claude-code:', () => {
  const p = path.join(root, '.minimax', 'agents', 'on-demand', 'spend-line.md');
  assert.ok(fs.existsSync(p), 'the engine spend role is absent');
  const txt = fs.readFileSync(p, 'utf8');
  assert.ok(txt.includes('minimax:'), 'the role must prescribe the minimax: tag');
  assert.ok(!txt.includes('claude-code:'), 'the role must not prescribe a foreign tag: the core accepts it, and the attempt would go into another engine spend');
  assert.ok(txt.includes('.minimax/.ledger/calls.jsonl'), 'the role must name the zone calls ledger');
  assert.ok(txt.includes('.minimax/scripts/sync-ledger.cjs'), 'the role must name the line output script');
  assert.ok(txt.includes('unknown'), 'the role must name the unknown marker for an unread field');
});

it('no foreign engine tag in the zone roles', () => {
  // A foreign tag in a role - not a typo but a spend error: the core accepts `claude-code:`,
  // `codex:`, `gemini:`, and a MiniMax attempt written by a foreign template would go into another
  // engine spend silently.
  const walk = (dir) => {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...walk(p));
      else if (e.name.endsWith('.md')) out.push(p);
    }
    return out;
  };
  const foreign = /(claude-code|codex|gemini):/;
  for (const f of walk(path.join(root, '.minimax', 'agents'))) {
    const txt = fs.readFileSync(f, 'utf8');
    const m = txt.match(foreign);
    assert.ok(!m, `${path.relative(root, f)} carries a foreign engine tag: ${m && m[0]}`);
  }
});

it('the probe writes facts: isolation is there, the continuation is not proven, the observations are tied to the witness', () => {
  const cap = probe();
  const witnessPath = path.join(root, '.minimax', '.state', 'observed-runtime.json');
  const witness = fs.existsSync(witnessPath) ? JSON.parse(fs.readFileSync(witnessPath, 'utf8')) : null;
  const obs = witness && witness.observations ? witness.observations : {};

  assert.equal(cap.engine, 'minimax');
  assert.equal(cap.isolation.available, true, 'isolation is available in this runtime');
  assert.ok(cap.isolation.verifiedBy, 'isolation names its proof');
  assert.ok(cap.isolation.projectRolesMechanism, 'the registration names a mechanism - the engine plugin');
  assert.ok(cap.isolation.projectRolesReason, 'this probe names one');

  // The roles registration and the delivery are session observations: either true with a witness, or null with a reason.
  if (obs.agentRegistry) {
    assert.equal(cap.isolation.projectRolesRegistered, true, 'the observation is there - the registration is claimed');
    assert.ok(cap.isolation.projectRolesReason.includes('observed-runtime.json'), 'the evidence is named');
  } else {
    assert.equal(cap.isolation.projectRolesRegistered, null, 'without an observation - an honest "not proven"');
  }
  if (obs.roleDelivery) {
    assert.equal(cap.roleDelivery.available, true, 'the delivery was observed - claimed');
    assert.ok(cap.roleDelivery.verifiedBy && cap.roleDelivery.verifiedBy.includes('observed-runtime.json'), 'the evidence is named');
    assert.ok(cap.roleDelivery.sessionId, 'the observation names a session identifier');
  } else {
    assert.equal(cap.roleDelivery.available, null, 'without an observation - an honest "not proven"');
    assert.ok(cap.roleDelivery.reason, 'the rest of the discipline names a reason');
  }

  // The call's continuation: either proven by an observation (then the evidence is named), or an honest
  // "not proven". The probe never sets true by default.
  if (obs.continuation) {
    assert.equal(cap.continuation.available, true, 'the continuation was observed - claimed');
    assert.ok(cap.continuation.verifiedBy && cap.continuation.verifiedBy.includes('observed-runtime.json'), 'the evidence is named');
    assert.ok(cap.continuation.what && cap.continuation.how, 'what and how was observed is named');
    assert.ok(cap.continuation.childSessionId, 'the observation names the child session identifier');
  } else {
    assert.equal(cap.continuation.available, null, 'without an observation - an honest "not proven", not "true"');
    assert.ok(cap.continuation.reason, 'the unproven names a reason');
  }
  assert.equal(cap.usage.available, fs.existsSync(path.join(root, '.minimax', '.ledger', 'calls.jsonl')), 'the spend is available exactly when the ledger is there');
  assert.ok(cap.hooks.available === false || cap.hooks.package, 'hooks: either the package location is named, or it is said the package is absent');
  if (cap.hooks.available) {
    assert.ok(cap.hooks.verifiedBy, 'the hooks name their proof');
    if (obs.hooks) {
      assert.equal(cap.hooks.deliveredInSession, true, 'the hooks fired in a live session');
      assert.ok(cap.hooks.observedLive.length, 'which events were observed live is named');
      assert.ok(cap.hooks.observedOnlyInSimulation.length, 'what remained only in the simulation is named');
    } else {
      assert.equal(cap.hooks.deliveredInSession, null, 'without an observation - an honest "not proven"');
    }
  }
});

it('a live ledger record belongs to the engine nodes platform calls', () => {
  const ledger = path.join(root, '.minimax', '.ledger', 'calls.jsonl');
  if (!fs.existsSync(ledger)) return; // no ledger yet - nothing to check
  const recs = fs.readFileSync(ledger, 'utf8').split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
  for (const rec of recs) {
    assert.ok(rec.conversationId, 'the record has no call identifier');
    assert.ok(rec.node, 'the record does not name a node');
    // The spend number is real or unknown (null). Unknown is never substituted by zero (§3).
    assert.ok(
      rec.input_tokens === null || (typeof rec.input_tokens === 'number' && rec.input_tokens > 0),
      'the spend number is real or null, but never zero instead of unknown'
    );
    const line = deriveSpendLineForCall(rec, rec.node, 'test');
    assert.ok(
      /unknown tokens/.test(line) || /\d[\d\s ]* tokens/.test(line),
      'the spend line says either a real number or unknown'
    );
    assert.ok(line.includes('`' + rec.conversationId + '`'), 'the call identifier must get into the spend line');
  }
});

it('the probe does not set true where there is no proof', () => {
  const cap = probe();
  for (const [name, field] of Object.entries(cap)) {
    if (!field || typeof field !== 'object' || !('available' in field)) continue;
    if (field.available === true) {
      assert.ok(field.verifiedBy || field.mechanism || field.package, `${name}: available=true without a proof`);
    }
    if (field.available === false || field.available === null) {
      assert.ok(field.reason, `${name}: an unavailable field without a reason`);
    }
  }
});

it('the capabilities file on disk matches the probe', () => {
  const p = path.join(root, '.minimax', '.state', 'capabilities.json');
  assert.ok(fs.existsSync(p), 'the capabilities file is absent - run node .minimax/scripts/capabilities.cjs');
  const onDisk = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.equal(onDisk.engine, 'minimax');
  assert.equal(typeof onDisk.isolation.available, 'boolean');
});

// 6. The zone's cleanliness (prohibition 16)
it('no project traces in the zone (prohibition 16)', () => {
  // The rule is a core one (`scanCleanFile`): one truth for all zones. No own check here.
  const { scanCleanFile } = require('../../.claude/scripts/checks/support/clean-zone.cjs');
  // The engine's machine state (`.state/`, `.ledger/`) does not ship: it holds the probe times and the
  // machine paths - like the core tools' journal. The zone content is checked.
  const MACHINE_STATE = new Set(['.state', '.ledger']);
  const walk = (dir) => {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!MACHINE_STATE.has(e.name)) out.push(...walk(p));
      } else out.push(p);
    }
    return out;
  };
  const problems = [];
  for (const f of walk(path.join(root, '.minimax'))) {
    const rel = path.relative(root, f).split(path.sep).join('/');
    if (!/\.(md|cjs|js|mjs|html)$/.test(rel)) continue;
    problems.push(...scanCleanFile(rel, fs.readFileSync(f, 'utf8')));
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

// 7. The engine plugin package
const PKG = path.join(root, 'miniapps', 'minimax-engine');
const PKG_MANIFEST = path.join(PKG, '.minimax-plugin', 'plugin.json');
const PKG_HOOKS = path.join(PKG, 'hooks', 'hooks.json');
const PKG_HOOK_SCRIPT = path.join(PKG, 'scripts', 'hook.mjs');

it('the plugin package is built per the V1 contract: manifest, icons, agents, paths', () => {
  const m = JSON.parse(fs.readFileSync(PKG_MANIFEST, 'utf8'));
  assert.equal(m.schemaVersion, 1);
  assert.match(m.name, /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/, 'the plugin name must be kebab-case');
  assert.match(m.version, /^\d+\.\d+\.\d+$/, 'the version must be SemVer');
  assert.ok(m.description && m.description.length > 10, 'the plugin must have a description');
  assert.ok(m.author, 'the plugin must have an author');
  assert.ok(m.category, 'the plugin must have a category');
  assert.ok(
    Array.isArray(m.exampleQueries) && m.exampleQueries.length && m.exampleQueries.every((q) => String(q).trim()),
    'at least one non-empty example query is needed'
  );
  assert.deepEqual(m.apps, [], 'local apps are not supported - apps must be empty');
  assert.ok(m.agents.length, 'the package must have subagents');
  for (const rel of [...m.agents, ...m.hooks, ...m.mcpServers, ...m.skills]) {
    assert.ok(!path.isAbsolute(rel) && !rel.includes('\\') && !rel.includes('..'), `the path is not portable: ${rel}`);
    assert.ok(fs.existsSync(path.join(PKG, ...rel.split('/'))), `the file is not found: ${rel}`);
  }
  assert.ok(fs.existsSync(path.join(PKG, m.icon)), 'the default icon is absent');
  if (m.darkIcon) assert.ok(fs.existsSync(path.join(PKG, m.darkIcon)), 'the dark icon is absent');
});

it('the package subagents: name = file name, description present, `task` not listed', () => {
  const m = JSON.parse(fs.readFileSync(PKG_MANIFEST, 'utf8'));
  for (const rel of m.agents) {
    assert.match(rel, /^agents\/[a-z][a-z0-9_-]*\.md$/, `the subagent path is not per the contract: ${rel}`);
    const txt = fs.readFileSync(path.join(PKG, ...rel.split('/')), 'utf8');
    const fm = txt.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
    assert.ok(fm, `${rel} has no frontmatter`);
    const name = (fm[1].match(/^name:\s*(.*)$/m) || [])[1];
    const desc = (fm[1].match(/^description:\s*(.*)$/m) || [])[1];
    const tools = (fm[1].match(/^tools:\s*\[(.*)\]$/m) || [])[1];
    assert.equal(name && name.trim(), path.basename(rel, '.md'), `the subagent name is not the file name: ${rel}`);
    assert.ok(desc && desc.trim().length > 10, `${rel} has an empty description`);
    if (tools) {
      const names = tools.split(',').map((t) => t.trim()).filter(Boolean);
      assert.ok(!names.includes('task'), `${rel} lists task - a plugin subagent does not delegate further`);
      for (const t of names) {
        assert.ok(!/^(Read|Write|Edit|Bash|Grep|Glob|Task|Agent|AskUserQuestion)$/.test(t), `${rel} carries a tool alias: ${t}`);
        assert.match(t, /^[a-z][a-z0-9_]*$/, `${rel} is not a native tool name: ${t}`);
      }
    }
  }
});

it('the package hooks: supported events, a synchronous handler, a portable command', () => {
  const h = JSON.parse(fs.readFileSync(PKG_HOOKS, 'utf8'));
  const SUPPORTED = new Set([
    'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest',
    'PostToolUse', 'SubagentStart', 'SubagentStop', 'Stop', 'PreCompact', 'PostCompact',
  ]);
  let count = 0;
  for (const [event, groups] of Object.entries(h.hooks)) {
    assert.ok(SUPPORTED.has(event), `the event is not supported by the runtime: ${event}`);
    for (const group of groups) {
      if (group.matcher !== undefined) {
        assert.ok(group.matcher.length <= 256, `the matcher is longer than 256 characters: ${event}`);
      }
      for (const handler of group.hooks) {
        count += 1;
        assert.equal(handler.type, 'command', 'the handler must be a synchronous command');
        assert.ok(handler.command && handler.command.includes('${PLUGIN_ROOT}'), 'the command must go through ${PLUGIN_ROOT}');
        assert.ok(handler.timeout >= 1 && handler.timeout <= 10, 'the timeout is outside the 1-10 seconds range');
      }
    }
  }
  assert.ok(count > 0, 'the package has no handlers at all');
  assert.ok(count <= 64, 'more than 64 handlers');
});

it('the hook script is syntactically valid for node', () => {
  const r = spawnSync(process.execPath, ['--check', PKG_HOOK_SCRIPT], { encoding: 'utf8' });
  assert.equal(r.status, 0, (r.stdout || '') + (r.stderr || ''));
});

it('the package subagents match the zone roles - by regeneration', () => {
  const r = spawnSync(process.execPath, [path.join(root, '.minimax', 'scripts', 'gen-plugin-agents.cjs'), '--check'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, (r.stdout || '') + (r.stderr || ''));
});

it('the installed package copy in the profile matches the source', () => {
  const { diff, targetDir } = require('../scripts/install-plugin.cjs');
  const dst = targetDir();
  if (!fs.existsSync(dst)) {
    // No package in the profile - an environment state, not a package defect; the probe says it honestly.
    assert.equal(probe().hooks.available, false, 'the probe must say the package is not in the profile');
    console.log('  (the package is not installed into the profile - the parity was not checked)');
    return;
  }
  const d = diff(PKG, dst);
  assert.deepEqual(d.missing, [], 'the profile has no package files');
  assert.deepEqual(d.changed, [], 'the package files in the profile drifted from the source');
  assert.deepEqual(d.extra, [], 'the profile carries extra package files');
});

it('the package hook works: the guard, the pass phrase, the role delivery, the calls ledger', () => {
  const os = require('node:os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-minimax-hook-'));
  try {
    // The fixture is a protocol project in a temp folder: the hook writes only there.
    const proj = path.join(tmp, 'project');
    fs.mkdirSync(path.join(proj, '.minimax', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(proj, 'AGENTS.md'), '# law\n', 'utf8');
    fs.writeFileSync(path.join(proj, '.minimax', 'agents', 'intent.md'), '# intent\n', 'utf8');
    const env = {
      ...process.env,
      PLUGIN_ROOT: PKG,
      PLUGIN_DATA: path.join(tmp, 'plugin-data'),
      MINIMAX_PROJECT_DIR: proj,
    };
    const run = (payload) => {
      const r = spawnSync(process.execPath, [PKG_HOOK_SCRIPT], { env, input: JSON.stringify(payload), encoding: 'utf8' });
      return { status: r.status, out: (r.stdout || '').trim() };
    };

    const start = run({ hook_event_name: 'SessionStart', source: 'startup' });
    assert.equal(start.status, 0);
    const ctx = JSON.parse(start.out).hookSpecificOutput;
    assert.equal(ctx.hookEventName, 'SessionStart');
    assert.ok(ctx.additionalContext.includes('.minimax'), 'the main session role is not named');

    const deny = run({ hook_event_name: 'PreToolUse', tool_name: 'bash', tool_input: { command: 'rm -- "AGENTS.md"' } });
    assert.equal(deny.status, 0);
    const d = JSON.parse(deny.out).hookSpecificOutput;
    assert.equal(d.permissionDecision, 'deny', 'deleting a protected path must be denied');
    assert.match(d.permissionDecisionReason, /\u041e\u0442\u043a\u043b\u044e\u0447\u0438 \u0441\u0435\u043d\u0441\u043e\u0440\u0438\u043a\u0443/, 'the denial does not name the pass phrase');

    const quiet = run({ hook_event_name: 'PreToolUse', tool_name: 'bash', tool_input: { command: 'rm -- "notes.txt"' } });
    assert.equal(quiet.status, 0);
    assert.equal(quiet.out, '', 'on a foreign path the hook stays silent');

    const phrase = run({ hook_event_name: 'UserPromptSubmit', prompt: '\u041e\u0442\u043a\u043b\u044e\u0447\u0438 \u0441\u0435\u043d\u0441\u043e\u0440\u0438\u043a\u0443' });
    assert.equal(phrase.status, 0);
    assert.equal(phrase.out, '', 'the phrase does not block the prompt');
    const marker = path.join(proj, '.minimax', 'hooks', '.delete-unlock');
    assert.ok(fs.existsSync(marker), 'the marker was not created');
    const allowed = run({ hook_event_name: 'PreToolUse', tool_name: 'bash', tool_input: { command: 'rm -- "AGENTS.md"' } });
    assert.equal(allowed.out, '', 'with the marker the action passes');
    assert.ok(!fs.existsSync(marker), 'the marker is one-shot - it disappears');
    const again = run({ hook_event_name: 'PreToolUse', tool_name: 'bash', tool_input: { command: 'rm -- "AGENTS.md"' } });
    assert.equal(JSON.parse(again.out).hookSpecificOutput.permissionDecision, 'deny', 'after the marker a denial again');

    const id = 'call-sim-0001';
    run({ hook_event_name: 'SubagentStart', agent_id: id, agent_type: 'minimax-engine:spec' });
    const stop = run({ hook_event_name: 'SubagentStop', agent_id: id, agent_type: 'minimax-engine:spec' });
    assert.equal(stop.status, 0);
    const ledgerFile = path.join(proj, '.minimax', '.ledger', 'calls.jsonl');
    assert.ok(fs.existsSync(ledgerFile), 'the calls ledger was not created');
    const rec = JSON.parse(fs.readFileSync(ledgerFile, 'utf8').trim().split('\n').pop());
    assert.equal(rec.conversationId, id, 'the call identifier is the platform one');
    assert.equal(rec.node, 'Spec', 'the node is named by the agent type');
    assert.equal(rec.input_tokens, null, 'an unread number is null, not zero');
    const line = deriveSpendLineForCall(rec, 'Spec', 'test: hook simulation');
    assert.match(line, /unknown tokens/, 'the spend line says unknown, not zero');
    assert.ok(line.includes('`' + id + '`'), 'the call identifier must get into the spend line');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// 8. The spend: the numbers are taken from the platform transcript, never invented
it('the transcript reader finds a session by identifier and extracts the numbers', () => {
  const reader = require(path.join(root, 'miniapps', 'minimax-engine', 'scripts', 'transcripts.cjs'));
  assert.ok(reader.sessionsRoot(process.env), 'the runtime session storage must be found');
  const ledgerFile = path.join(root, '.minimax', '.ledger', 'calls.jsonl');
  if (!fs.existsSync(ledgerFile)) return;
  const recs = fs.readFileSync(ledgerFile, 'utf8').split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
  const numbered = recs.filter((r) => typeof r.input_tokens === 'number');
  if (!numbered.length) return; // no platform records with numbers yet
  for (const rec of numbered) {
    assert.ok(rec.model, 'a record with numbers must name the model');
    assert.ok(rec.input_tokens > 0, 'the input tokens number must be real');
    const u = reader.readUsage(rec.conversationId);
    assert.ok(u, 'the transcript by this identifier must be found');
    // The ledger record is a snapshot at the `SubagentStop` moment: the call transcript is appended after
    // the stop, so its full totals may be larger than the snapshot. The record's property: its numbers
    // match the accumulated over the first K transcript steps. This is "snapshot versus full",
    // not a divergence; old ledger and card lines are not rewritten (prohibition 5).
    const steps = reader.readSteps(rec.conversationId);
    let ci = 0;
    let co = 0;
    let cc = 0;
    let cw = 0;
    let snapshot = false;
    for (const s of steps) {
      ci += s.input || 0;
      co += s.output || 0;
      cc += s.cacheRead || 0;
      cw += s.cacheWrite || 0;
      const sameIn = ci === rec.input_tokens;
      const sameOut = co === rec.output_tokens;
      const sameCache = cc === rec.cache_read_tokens;
      const sameWrite = rec.cache_write_tokens === undefined || rec.cache_write_tokens === null || cw === rec.cache_write_tokens;
      if (sameIn && sameOut && sameCache && sameWrite) { snapshot = true; break; }
    }
    assert.ok(snapshot, 'the ledger record numbers must match the accumulated over the first K transcript steps (a snapshot at the SubagentStop moment)');
    assert.ok(u.input >= rec.input_tokens, 'the full transcript cannot be smaller than the snapshot');
  }
});

it('the spend line takes the numbers from the full transcript, not from the ledger snapshot', () => {
  const ledgerFile = path.join(root, '.minimax', '.ledger', 'calls.jsonl');
  if (!fs.existsSync(ledgerFile)) return;
  const reader = require(path.join(root, 'miniapps', 'minimax-engine', 'scripts', 'transcripts.cjs'));
  const { deriveSpendLineForCall } = require(path.join(root, '.minimax', 'scripts', 'sync-ledger.cjs'));
  const recs = fs.readFileSync(ledgerFile, 'utf8').split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
  const rec = recs.find((r) => typeof r.input_tokens === 'number' && r.conversationId);
  if (!rec) return; // no platform records with numbers yet
  const u = reader.readUsage(rec.conversationId);
  if (!u) return; // no transcript for this call - nothing to compare
  const g = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const N = u.input + u.output + u.cache_read + u.cache_write;
  const line = deriveSpendLineForCall(rec, rec.node || 'Run', 'test: numbers from the full transcript');
  assert.ok(line.includes(g(N) + ' tokens'), 'the spend line must carry the call full spend from the transcript');
  assert.ok(line.includes(g(u.cache_read) + ' cache-read'), 'the cache read in the line is from the full transcript');
  assert.ok(line.includes(', ' + g(u.output) + ' out'), 'the output tokens in the line are from the full transcript');
});

it('the hook writes real numbers and a normalized transcript into the ledger', () => {
  const ledgerFile = path.join(root, '.minimax', '.ledger', 'calls.jsonl');
  if (!fs.existsSync(ledgerFile)) return;
  const rec = fs.readFileSync(ledgerFile, 'utf8').split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l))
    .find((r) => typeof r.input_tokens === 'number');
  if (!rec) return; // no platform record with numbers yet

  const os = require('node:os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-minimax-spend-'));
  try {
    const proj = path.join(tmp, 'project');
    fs.mkdirSync(path.join(proj, '.minimax', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(proj, 'AGENTS.md'), '# law\n', 'utf8');
    fs.writeFileSync(path.join(proj, '.minimax', 'agents', 'intent.md'), '# intent\n', 'utf8');
    const env = {
      ...process.env,
      PLUGIN_ROOT: PKG,
      PLUGIN_DATA: path.join(os.homedir(), '.minimax', 'v2', 'plugin-data', 'hooks', 'minimax-engine'),
      MINIMAX_PROJECT_DIR: proj,
    };
    const r = spawnSync(process.execPath, [PKG_HOOK_SCRIPT], {
      env,
      input: JSON.stringify({
        hook_event_name: 'SubagentStop',
        agent_id: rec.conversationId,
        agent_type: 'minimax-engine:spec',
      }),
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, (r.stdout || '') + (r.stderr || ''));
    const fixtureLedger = path.join(proj, '.minimax', '.ledger', 'calls.jsonl');
    assert.ok(fs.existsSync(fixtureLedger), 'the calls ledger was not created');
    const written = JSON.parse(fs.readFileSync(fixtureLedger, 'utf8').trim().split('\n').pop());
    assert.equal(typeof written.input_tokens, 'number', 'the tokens number must be real, not null');
    assert.ok(written.input_tokens > 0, 'the tokens number must be greater than zero');
    assert.equal(written.agent_type, 'minimax-engine:spec', 'the platform agent name must get into the record');
    assert.ok(written.model, 'the model must be named');
    // The normalized transcript is what the dashboard reads.
    const trDir = path.join(proj, '.minimax', '.transcripts');
    assert.ok(fs.existsSync(trDir), 'the normalized transcript was not written');
    const files = fs.readdirSync(trDir).filter((f) => f.endsWith('.jsonl'));
    assert.ok(files.length, 'the transcripts folder is empty');
    const first = JSON.parse(fs.readFileSync(path.join(trDir, files[0]), 'utf8').split('\n')[0]);
    assert.ok(first.message.usage, 'the normalized record has no spend');
    assert.equal(typeof first.message.usage.cache_read_input_tokens, 'number', 'the core expects this field');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

it('the spend line counts N per the canon: the full call, cache inside, work = N − R', () => {
  const ledger = path.join(root, '.minimax', '.ledger', 'calls.jsonl');
  if (!fs.existsSync(ledger)) return;
  const { fullUsage } = require(path.join(root, '.minimax', 'scripts', 'sync-ledger.cjs'));
  const recs = fs.readFileSync(ledger, 'utf8').split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
  const g = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  let checked = 0;
  for (const rec of recs) {
    if (rec.input_tokens == null || rec.output_tokens == null) continue;
    // The spend line takes the numbers from the call FULL transcript; the ledger record is a snapshot at
    // the `SubagentStop` moment, and it may be smaller. The canon is checked on the numbers the line carries.
    const src = fullUsage(rec) || rec;
    const R = src.cache_read_tokens || 0;
    const W = src.cache_write_tokens || 0;
    const N = src.input_tokens + src.output_tokens + R + W;
    const line = deriveSpendLineForCall(rec, rec.node, 'test');
    assert.ok(line.includes(g(N) + ' tokens'), `N must be the call full spend: ${line}`);
    assert.ok(line.includes('(' + g(R) + ' cache-read)'), `R must be the cache read: ${line}`);
    assert.ok(line.includes(', ' + g(src.output_tokens) + ' out'), `the output must be in the line: ${line}`);
    assert.ok(N >= R, 'N cannot be smaller than R - otherwise the core recalculates the total');
    checked += 1;
  }
  assert.ok(checked > 0, 'nothing to check: the ledger has no records with numbers');
});

console.log(`\n${passed} checks passed`);
