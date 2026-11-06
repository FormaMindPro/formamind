#!/usr/bin/env node
'use strict';
/**
 * card-subagent-spend.cjs: строка расхода субагента в карточку — суммы из фикстуры стенограммы
 * (дедуп по requestId, тег движка-владельца), unknown-ветка с причиной и тегом из --engine,
 * идемпотентность по id вызова, без --write — только печать.
 *   node .claude/scripts/card-subagent-spend.test.cjs
 *
 * Имена файлов карточек в фикстурах собираются динамически: литерал с номером в исходнике чистой
 * зоны ловит проверка следов проекта (запрет 16).
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, 'card-subagent-spend.cjs');
const { SPEND_SOURCE } = require('../../.forma/dashboard/spend-line.cjs');
const SPEND_RE = new RegExp(SPEND_SOURCE); // SPEND_SOURCE экспортируется строкой-паттерном

let passed = 0;
const tests = [];
const it = (name, fn) => tests.push([name, fn]);
const run = (args, env) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });

const AGENT = 'a1b2c3d4e5f6';
const GHOST = '0f9e8d7c6b5a';
const step = (id, ts, u) => JSON.stringify({ requestId: id, completedAt: ts, response: { usage: u } });

/** Временная доска с одной карточкой; имя файла — динамическое. */
function boardFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cardsb-'));
  const dir = path.join(root, '.devtool', 'features');
  fs.mkdirSync(dir, { recursive: true });
  const num = String(100 + Math.floor(Math.random() * 899));
  const card = path.join(dir, `card-${num}-probe.md`);
  fs.writeFileSync(card, `---\nid: "card-${num}-probe"\nstatus: "in-progress"\n---\n# probe\n\n## Task\n\nпроба\n\n## Kit\n\n## History\n\n## Result\n`);
  return { root, card, num };
}

/** Фикстура rollout: два шага (requestId-дубль схлопывается), N = 10 550, R = 9 000, out = 150, окно 30 s. */
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

it('стенограмма найдена: строка §3 в History с каноническими суммами и тегом движка-владельца', async () => {
  const { root, card, num } = boardFixture();
  const home = rolloutFixture();
  try {
    const r = run([num, AGENT, '--node', 'Run', '--write'], { CLAUDE_SPEND_ROOT: root, ZCODE_HOME: home });
    assert.equal(r.status, 0, 'выход не 0: ' + (r.stderr || r.stdout));
    const text = fs.readFileSync(card, 'utf8');
    const line = text.split(/\r?\n/).find((l) => l.includes('attempt,'));
    assert.ok(line, 'строка расхода не в карточке');
    assert.ok(line.includes('attempt, 10 550 tokens (9 000 cache-read), 150 out, 30 s,'), 'суммы не сошлись: ' + line);
    assert.ok(line.includes('`' + AGENT + '`'), 'id вызова не в строке');
    assert.ok(line.includes('— zcode:'), 'тег движка-владельца не поставлен');
    assert.ok(SPEND_RE.test(line), 'строка не разбирается каноном §3');
    // Идемпотентность: повтор с тем же id — «уже записано», второй строки нет.
    const again = run([num, AGENT, '--node', 'Run', '--write'], { CLAUDE_SPEND_ROOT: root, ZCODE_HOME: home });
    assert.equal(again.status, 0);
    assert.ok(again.stdout.includes('уже записано'), 'повтор не распознан: ' + again.stdout);
    assert.equal((fs.readFileSync(card, 'utf8').match(/attempt,/g) || []).length, 1, 'строка задублирована');
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); }
});

it('стенограммы нет: unknown с причиной и тегом из --engine, не ноль; без --engine — выход 2', async () => {
  const { root, card, num } = boardFixture();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cardsb-empty-'));
  fs.mkdirSync(path.join(home, 'cli', 'rollout'), { recursive: true });
  try {
    const bare = run([num, GHOST], { CLAUDE_SPEND_ROOT: root, ZCODE_HOME: home });
    assert.equal(bare.status, 2, 'без --engine должно отказывать, а не писать без тега');
    const r = run([num, GHOST, '--engine', 'zcode', '--write'], { CLAUDE_SPEND_ROOT: root, ZCODE_HOME: home });
    assert.equal(r.status, 0, 'выход не 0: ' + (r.stderr || r.stdout));
    const text = fs.readFileSync(card, 'utf8');
    const line = text.split(/\r?\n/).find((l) => l.includes('attempt,'));
    assert.ok(line, 'unknown-строка не в карточке');
    assert.ok(line.includes('attempt, unknown tokens (cache-read unknown), out unknown, unknown s,'), 'маркеры unknown не канонические: ' + line);
    assert.ok(line.includes('стенограмма не найдена'), 'причина не названа: ' + line);
    assert.ok(line.includes('— zcode:'), 'тег из --engine не поставлен');
    assert.ok(!/\b0\s*tokens/.test(line), 'ноль просочился в строку');
    assert.ok(SPEND_RE.test(line), 'unknown-строка не разбирается каноном §3');
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); }
});

it('без --write строка только печатается, карточка не тронута', async () => {
  const { root, card, num } = boardFixture();
  const home = rolloutFixture();
  try {
    const r = run([num, AGENT], { CLAUDE_SPEND_ROOT: root, ZCODE_HOME: home });
    assert.equal(r.status, 0, 'выход не 0: ' + (r.stderr || r.stdout));
    assert.ok(r.stdout.includes('attempt, 10 550 tokens'), 'печати строки нет');
    assert.ok(!fs.readFileSync(card, 'utf8').includes('attempt,'), 'карточка изменена без --write');
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); }
});

/** Фикстура brain Gemini: два шага, N = 11 400, R = 5 000, out = 200, окно 25 s. */
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

it('стенограмма найдена (gemini): строка §3 в History с каноническими суммами и тегом gemini', async () => {
  const { root, card, num } = boardFixture();
  const brain = geminiBrainFixture();
  try {
    const r = run([num, AGENT, '--node', 'Run', '--write'], { CLAUDE_SPEND_ROOT: root, GEMINI_BRAIN_DIR: brain });
    assert.equal(r.status, 0, 'выход не 0: ' + (r.stderr || r.stdout));
    const text = fs.readFileSync(card, 'utf8');
    const line = text.split(/\r?\n/).find((l) => l.includes('attempt,'));
    assert.ok(line, 'строка расхода не в карточке');
    assert.ok(line.includes('attempt, 11 400 tokens (5 000 cache-read), 200 out, 25 s,'), 'суммы не сошлись: ' + line);
    assert.ok(line.includes('`' + AGENT + '`'), 'id вызова не в строке');
    assert.ok(line.includes('— gemini:'), 'тег gemini не поставлен');
    assert.ok(SPEND_RE.test(line), 'строка не разбирается каноном §3');
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(brain, { recursive: true, force: true }); }
});

(async () => {
  for (const [name, fn] of tests) {
    await fn();
    passed += 1;
    console.log('ok  ' + name);
  }
  console.log(`\n${passed} проверок пройдено`);
})().catch((e) => { console.error(e && e.message || e); process.exit(1); });
