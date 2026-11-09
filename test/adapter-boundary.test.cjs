// The core-adapter boundary (dashboard/lib/engines.cjs): the dashboard on a project without an adapter
// assembles, and everything only the engine knows arrives as `unknown`. The test falls if the core takes
// engine data past the interface: the fixture keeps the `.claude/agents`, `.claude/scripts`,
// `.claude/settings.json` directories, and only `forma-adapter.cjs` itself is switched off - a direct
// read would return the real data.
// The ru labels below ('core'/'project' skill rows, tally's report lines) are the dashboard's own literal
// output: byte-identical from ASCII source through unicode escapes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeFixture, runNode } = require('./helpers/fixture.cjs');
const { buildDataRaw } = require('./helpers/snapshot.cjs');
const D = {
  core: '\u044f\u0434\u0440\u043e',
  project: '\u043f\u0440\u043e\u0435\u043a\u0442',
  dash: '\u2014',
  own: '\u0441\u0432\u043e\u0451',
  broken: '\u0430\u0434\u0430\u043f\u0442\u0435\u0440 \u0441\u043b\u043e\u043c\u0430\u043d',
  unavailable: '\u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u0435\u043d \u2014 \u043f\u043e\u043b \u043d\u0435 \u043d\u0430\u0437\u0432\u0430\u043d, \u0438 \u044d\u0442\u043e \u043d\u0435 \u043d\u043e\u043b\u044c',
  commonPart: '\u0418\u0437 \u043d\u0438\u0445 \u043e\u0431\u0449\u0430\u044f \u0447\u0430\u0441\u0442\u044c'
};

const ADAPTER = ['.claude', 'forma-adapter.cjs'];
let fx;
const adapterFile = () => path.join(fx.root, ...ADAPTER);
const exists = (...p) => fs.existsSync(path.join(fx.root, ...p));

test.before(() => { fx = makeFixture(); });
test.after(() => { if (fx) fx.cleanup(); });

// The spend nodes by engines: the step weight and the step count live there.
const engineNodes = (d) => Object.values(d.economy.engines).flatMap((e) => e.byNode);

// What only the engine itself knows: what must vanish from the data together with the adapter.
function engineFacts(d) {
  return {
    instruction: d.economy.instruction,
    perStep: [...new Set(engineNodes(d).map((n) => n.instructionPerStep))],
    settings: d.settings.engine,
    bortSource: d.bort.source,
    servers: d.bort.servers.length + d.bort.mcpScanned.length,
    nodeConfig: d.nodeConfig.length,
    law: { engine: d.board.law.engine, roles: d.board.law.roles.length, checks: d.board.law.checks.length },
    skillDirs: d.settings.project.skillDirs,
    skills: Object.keys(d.board.skills).length,
    groups: d.structure.groups.map((g) => g.key),
  };
}

test('with the adapter the core gets the engine data (the control half)', () => {
  assert.ok(exists(...ADAPTER), 'the installer did not install forma-adapter.cjs');
  const d = buildDataRaw(fx);
  const f = engineFacts(d);
  assert.equal(typeof f.instruction, 'object');
  assert.ok(f.settings.present && f.settings.nodes.length > 0);
  assert.ok(f.nodeConfig > 0 && f.law.roles > 0 && f.law.checks > 0 && f.law.engine.length > 0);
  assert.equal(typeof f.skillDirs, 'number');
  assert.ok(f.groups.includes('model'));
  // The skills sign: everything the installer installed is core; "project" - only for a skill the
  // template did not ship.
  const rows = d.settings.project.skills.rows;
  assert.ok(rows.length > 0 && rows.every((r) => r[1] === D.core), JSON.stringify(rows.map((r) => r.slice(0, 2))));
  const own = path.join(fx.root, '.claude', 'skills', 'own-skill');
  fs.mkdirSync(own, { recursive: true });
  fs.writeFileSync(path.join(own, 'SKILL.md'), `---\nname: own-skill\ndescription: ${D.own}\n---\n`);
  const after = buildDataRaw(fx).settings.project.skills.rows;
  assert.deepEqual(after.find((r) => r[0] === 'own-skill').slice(0, 2), ['own-skill', D.project]);
  fs.rmSync(own, { recursive: true, force: true });
});

test('without the adapter: the build goes on, engine fields unknown or empty, zero and null do not take their place', () => {
  fs.renameSync(adapterFile(), adapterFile() + '.off');
  // The engine data is on disk in place - a direct read by the core would have found it.
  assert.ok(exists('.claude', 'agents', 'kit.md') && exists('.claude', 'settings.json') && exists('.claude', 'scripts', 'instruction-weight.cjs'));
  const d = buildDataRaw(fx);
  const f = engineFacts(d);
  assert.equal(f.instruction, 'unknown');
  assert.deepEqual(f.perStep, ['unknown']);
  assert.ok(engineNodes(d).length > 0 && engineNodes(d).every((n) => n.avgSteps === 'unknown'));
  assert.equal(f.settings.present, false);
  assert.equal(f.settings.engine, 'unknown');
  assert.deepEqual([f.settings.hooks, f.settings.nodes, f.settings.skills, f.settings.env], [[], [], [], []]);
  assert.equal(f.bortSource, null);
  assert.equal(f.servers, 0);
  assert.equal(f.nodeConfig, 0);
  assert.deepEqual(f.law, { engine: '', roles: 0, checks: 0 });
  assert.equal(f.skillDirs, 'unknown');
  assert.equal(f.skills, 0);
  assert.ok(!f.groups.includes('model'));
});

test('without the adapter tally calls the half unavailable, not zero', () => {
  const cards = path.join(fx.root, '.devtool', 'features');
  const r = runNode(fx, [path.join(fx.root, '.forma', 'dashboard', 'tally.cjs'), '--report', cards]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(D.unavailable));
  assert.doesNotMatch(r.stdout, new RegExp(D.commonPart));
});

test('an adapter that throws on load is not an adapter: the build goes on, the fields unknown', () => {
  fs.writeFileSync(adapterFile(), `throw new Error('${D.broken}');\n`);
  const f = engineFacts(buildDataRaw(fx));
  assert.equal(f.instruction, 'unknown');
  assert.equal(f.settings.present, false);
});

test('an adapter declared not everything: the missing field - unknown, the rest works', () => {
  fs.writeFileSync(adapterFile(), "module.exports = { engine: 'test-engine', skillsDir: '.claude/skills' };\n");
  const d = buildDataRaw(fx);
  const f = engineFacts(d);
  assert.equal(f.instruction, 'unknown');
  assert.equal(typeof f.skillDirs, 'number');
  assert.equal(f.settings.engine, 'test-engine');
  assert.equal(f.settings.present, false);
  // The template skill list is absent - the sign is "-", not a silent "project".
  const rows = d.settings.project.skills.rows;
  assert.ok(rows.length > 0 && rows.every((r) => r[1] === D.dash));
});
