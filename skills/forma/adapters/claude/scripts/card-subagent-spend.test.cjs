#!/usr/bin/env node
'use strict';
/**
 * card-subagent-spend.cjs: a subagent spend line into the card - the sums from a transcript fixture
 * (dedup by requestId, the owner engine's tag), the unknown branch with a reason and the tag from
 * --engine, idempotency by the call id, without --write - print only.
 *   node .claude/scripts/card-subagent-spend.test.cjs
 *
 * Card file names in the fixtures are built dynamically: a numbered literal in a clean-zone source
 * is caught by the project-trace check (prohibition 16).
 * The expected ru labels are read from the core dictionary (fixed ru) and from the transcript
 * reader's constant: the script under test prints the same ru text as before the translation, and
 * the assertion must not pin its own copy of the string.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, 'card-subagent-spend.cjs');
const { SPEND_SOURCE } = require('../../.forma/dashboard/spend-line.cjs');
const SPEND_RE = new RegExp(SPEND_SOURCE); // SPEND_SOURCE is exported as a pattern string
const { NO_TRANSCRIPT } = require('../../.forma/dashboard/subagent-transcript.cjs');
const i18n = require('../../.forma/i18n/index.cjs');
const msg = (code, params) => i18n.message(code, params, 'ru');

let passed = 0;
const tests = [];
const it = (name, fn) => tests.push([name, fn]);
const run = (args, env) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });

const AGENT = 'a1b2c3d4e5f6';
const GHOST = '0f9e8d7c6b5a';
const step = (id, ts, u) => JSON.stringify({ requestId: id, completedAt: ts, response: { usage: u } });

/** A temporary board with one card; the file name is dynamic. */
function boardFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cardsb-'));
  const dir = path.join(root, '.devtool', 'features');
  fs.mkdirSync(dir, { recursive: true });
  const num = String(100 + Math.floor(Math.random() * 899));
  const card = path.join(dir, `card-${num}-probe.md`);
  fs.writeFileSync(card, `---\nid: "card-${num}-probe"\nstatus: "in-progress"\n---\n# probe\n\n## Task\n\nprobe\n\n## Kit\n\n## History\n\n## Result\n`);
  return { root, card, num };
}

/** The rollout fixture: two steps (a requestId duplicate collapses), N = 10 550, R = 9 000, out = 150, window 30 s. */
function rolloutFixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cardsb-roll-'));
  const dir = path.join(home, 'cli', 'rollout');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `model-io-sess_subagent_agent_${AGENT}.jsonl`), [
    step('r1', '2026-01-01T10:00:00.000Z', { inputTokens: 6200, outputTokens: 100, cacheReadTokens: 5000, cacheWriteTokens: 200 }),
    step('r1', '2026-01-01T10:00:01.000Z', { inputTokens: 6200, outputTokens: 100, cacheReadTokens: 5000, cacheWriteTokens: 200 }),
    step('r2', '2026-01-01T10:00:30.000Z', { inputTokens: 4200, outputTokens: 50, cacheReadTokens: 4000, cacheWriteTokens: 0 }),
  ].join('\n') + '\n');
  return home;
}

it('transcript found: a §3 line in History with the canonical sums and the owner engine tag', async () => {
  const { root, card, num } = boardFixture();
  const home = rolloutFixture();
  try {
    const r = run([num, AGENT, '--node', 'Run', '--write'], { CLAUDE_SPEND_ROOT: root, ZCODE_HOME: home });
    assert.equal(r.status, 0, 'exit is not 0: ' + (r.stderr || r.stdout));
    const text = fs.readFileSync(card, 'utf8');
    const line = text.split(/\r?\n/).find((l) => l.includes('attempt,'));
    assert.ok(line, 'no spend line in the card');
    assert.ok(line.includes('attempt, 10 550 tokens (9 000 cache-read), 150 out, 30 s,'), 'the sums do not match: ' + line);
    assert.ok(line.includes('`' + AGENT + '`'), 'the call id is not in the line');
    assert.ok(line.includes('— zcode:'), 'the owner engine tag is not set');
    assert.ok(SPEND_RE.test(line), 'the line does not parse by the §3 canon');
    // Idempotency: a re-run with the same id - "already recorded", no second line.
    const again = run([num, AGENT, '--node', 'Run', '--write'], { CLAUDE_SPEND_ROOT: root, ZCODE_HOME: home });
    assert.equal(again.status, 0);
    assert.ok(again.stdout.includes(msg('spend.card-subagent.already', { id: AGENT })), 'the re-run is not recognized: ' + again.stdout);
    assert.equal((fs.readFileSync(card, 'utf8').match(/attempt,/g) || []).length, 1, 'the line is duplicated');
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); }
});

it('no transcript: unknown with a reason and the tag from --engine, not zero; without --engine - exit 2', async () => {
  const { root, card, num } = boardFixture();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cardsb-empty-'));
  fs.mkdirSync(path.join(home, 'cli', 'rollout'), { recursive: true });
  try {
    const bare = run([num, GHOST], { CLAUDE_SPEND_ROOT: root, ZCODE_HOME: home });
    assert.equal(bare.status, 2, 'without --engine it must refuse, not write without a tag');
    const r = run([num, GHOST, '--engine', 'zcode', '--write'], { CLAUDE_SPEND_ROOT: root, ZCODE_HOME: home });
    assert.equal(r.status, 0, 'exit is not 0: ' + (r.stderr || r.stdout));
    const text = fs.readFileSync(card, 'utf8');
    const line = text.split(/\r?\n/).find((l) => l.includes('attempt,'));
    assert.ok(line, 'no unknown line in the card');
    assert.ok(line.includes('attempt, unknown tokens (cache-read unknown), out unknown, unknown s,'), 'the unknown markers are not canonical: ' + line);
    assert.ok(line.includes(NO_TRANSCRIPT), 'the reason is not named: ' + line);
    assert.ok(line.includes('— zcode:'), 'the tag from --engine is not set');
    assert.ok(!/\b0\s*tokens/.test(line), 'a zero leaked into the line');
    assert.ok(SPEND_RE.test(line), 'the unknown line does not parse by the §3 canon');
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); }
});

it('without --write the line is only printed, the card is not touched', async () => {
  const { root, card, num } = boardFixture();
  const home = rolloutFixture();
  try {
    const r = run([num, AGENT], { CLAUDE_SPEND_ROOT: root, ZCODE_HOME: home });
    assert.equal(r.status, 0, 'exit is not 0: ' + (r.stderr || r.stdout));
    assert.ok(r.stdout.includes('attempt, 10 550 tokens'), 'no line printed');
    assert.ok(!fs.readFileSync(card, 'utf8').includes('attempt,'), 'the card changed without --write');
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); }
});

/** The Gemini brain fixture: two steps, N = 11 400, R = 5 000, out = 200, window 25 s. */
function geminiBrainFixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cardsb-brain-'));
  const logDir = path.join(home, AGENT, '.system_generated', 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(path.join(logDir, 'transcript.jsonl'), [
    JSON.stringify({ step_index: 1, type: 'PLANNER_RESPONSE', created_at: '2026-01-01T12:00:00.000Z', input_tokens: 4000, cache_read_tokens: 3000, output_tokens: 100 }),
    JSON.stringify({ step_index: 2, type: 'PLANNER_RESPONSE', created_at: '2026-01-01T12:00:25.000Z', input_tokens: 2200, cache_read_tokens: 2000, output_tokens: 100 }),
  ].join('\n') + '\n');
  return home;
}

it('transcript found (gemini): a §3 line in History with the canonical sums and the gemini tag', async () => {
  const { root, card, num } = boardFixture();
  const brain = geminiBrainFixture();
  try {
    const r = run([num, AGENT, '--node', 'Run', '--write'], { CLAUDE_SPEND_ROOT: root, GEMINI_BRAIN_DIR: brain });
    assert.equal(r.status, 0, 'exit is not 0: ' + (r.stderr || r.stdout));
    const text = fs.readFileSync(card, 'utf8');
    const line = text.split(/\r?\n/).find((l) => l.includes('attempt,'));
    assert.ok(line, 'no spend line in the card');
    assert.ok(line.includes('attempt, 11 400 tokens (5 000 cache-read), 200 out, 25 s,'), 'the sums do not match: ' + line);
    assert.ok(line.includes('`' + AGENT + '`'), 'the call id is not in the line');
    assert.ok(line.includes('— gemini:'), 'the gemini tag is not set');
    assert.ok(SPEND_RE.test(line), 'the line does not parse by the §3 canon');
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(brain, { recursive: true, force: true }); }
});

(async () => {
  for (const [name, fn] of tests) {
    await fn();
    passed += 1;
    console.log('ok  ' + name);
  }
  console.log(`\n${passed} checks passed`);
})().catch((e) => { console.error(e && e.message || e); process.exit(1); });
