#!/usr/bin/env node
'use strict';

/**
 * test-zcode-adapter.cjs — Тест соответствия адаптера ZCode.
 * Проверяет:
 *  1. Наличие и содержание .zcode/rules/zcode-8.md (девять контрактов, тег zcode:, расхождение деградации);
 *  2. Форму адаптера: ядро находит его по имени файла, пункты контракта engines.cjs — все пройдены;
 *  3. Паритет ролей зоны с каноническими ролями — перегенерацией (gen-roles --check);
 *  4. Разбор строки расхода: synthetic-шаг и реальная форма usage хоста; тег zcode: — в стене тегов ядра;
 *  5. Вкладки ядра читают адаптер: formaRoles и engineSettings отдают данные зоны;
 *  6. Чистоту зоны (запрет 16): в текстах зоны нет следов проекта (.state — проба с метками времени,
 *     tests — приборы с образцами: вне скана, это названо здесь, а не спрятано);
 *  7. Ключи frontmatter агентов зоны — закрытый список (scripts/lint-agent-keys.cjs):
 *     опечатанный или неизвестный ключ — ошибка с адресом файла и именем ключа, не молчание.
 *
 * Запуск:
 *   node .zcode/tests/test-zcode-adapter.cjs
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const engines = require('../../.forma/dashboard/lib/engines.cjs');
const { engineTagRe } = require('../../.forma/dashboard/spend-line.cjs');

let passed = 0;
const it = (name, fn) => { fn(); passed += 1; console.log('ok  ' + name); };

const adapter = () => engines.loadAdapters(root).find((a) => a.dir === '.zcode');

// 1. §8 движка
it('.zcode/rules/zcode-8.md объявляет девять контрактов и тег движка', () => {
  const text = fs.readFileSync(path.join(root, '.zcode', 'rules', 'zcode-8.md'), 'utf8');
  for (const c of ['Contract 1', 'Contract 2', 'Contract 3', 'Contract 4', 'Contract 5', 'Contract 6', 'Contract 7', 'Contract 8', 'Contract 9']) {
    assert.ok(text.includes(c), `в §8 нет ${c}`);
  }
  assert.ok(text.includes('zcode:'), 'в §8 нет тега движка zcode:');
  assert.ok(/деградирован/i.test(text), 'в §8 не назван деградированный режим маршрута');
  assert.ok(text.includes('[STAGE:'), 'в §8 не названы метки стадий');
});

// 2. Форма адаптера: все пункты контракта ядра
it('адаптер проходит все пункты контракта engines.cjs', () => {
  const a = adapter();
  assert.ok(a, 'адаптер .zcode не найден ядром');
  const items = engines.checkAdapter(a, root);
  const bad = items.filter((x) => !x.ok);
  assert.deepEqual(bad, [], 'непройденные пункты: ' + bad.map((x) => `${x.item} (${x.detail})`).join('; '));
});

it('режим движка — «полный», id и тег — zcode', () => {
  const a = adapter();
  assert.equal(engines.idOf(a), 'zcode');
  assert.equal(engines.modeOf(a), 'полный');
  assert.equal(a.spendTag, 'zcode');
});

// 3. Паритет ролей — перегенерацией
it('зеркало ролей синхронно с .claude/agents (gen-roles --check)', () => {
  const r = spawnSync(process.execPath, [path.join(root, '.zcode', 'scripts', 'gen-roles.cjs'), '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, 'дрейф зеркала: ' + (r.stderr || r.stdout));
});

// 4. Разбор расхода
it('parseUsage читает синтетический шаг и реальную форму usage хоста', () => {
  const a = adapter();
  const flat = a.parseUsage({ tokens_out: 7 });
  assert.equal(flat.tokens_out, 7);
  const host = a.parseUsage({ usage: { inputTokens: 110827, outputTokens: 784, totalTokens: 111611, cacheReadTokens: 106944, cacheWriteTokens: 0 } });
  assert.equal(host.tokens_out, 784);
  assert.equal(host.cache_read, 106944);
  assert.equal(host.cache_write, 0);
  // Поля хоста включающие: inputTokens несёт весь ввод, кэш внутри него
  // (факт rollout: inputTokens + outputTokens = totalTokens) — прочий ввод = inputTokens − кэш,
  // и N = Σ in+write+read+out сходится в totalTokens, а не складывает кэш дважды.
  assert.equal(host.tokens_in, 110827 - 106944 - 0);
  assert.equal(host.tokens_in + host.cache_write + host.cache_read + host.tokens_out, 111611);
  const provider = a.parseUsage({ usage: { input_tokens: 3806, output_tokens: 2004, cache_read_input_tokens: 110784 } });
  assert.equal(provider.tokens_out, 2004);
  assert.equal(provider.cache_read, 110784);
});

// 5. Журнал основной сессии: раскладка и нормализованный шаг — через адаптер
it('mainSessions перечисляет основные сессии, без субагентских и записи без сессии', () => {
  const a = adapter();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rollout-'));
  const dir = path.join(home, 'cli', 'rollout');
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ['model-io-sess_aa11.jsonl', 'model-io-sess_bb22.jsonl',
    'model-io-sess_subagent_agent_cc33.jsonl', 'model-io-no-session.jsonl', 'чужой-файл.txt']) {
    fs.writeFileSync(path.join(dir, f), '{}\n');
  }
  process.env.ZCODE_HOME = home;
  try {
    const list = a.mainSessions(root);
    assert.deepEqual(list.map((s) => s.id).sort(), ['model-io-sess_aa11', 'model-io-sess_bb22']);
    for (const s of list) assert.ok(fs.existsSync(s.file), 'файл записи существует');
  } finally { delete process.env.ZCODE_HOME; fs.rmSync(home, { recursive: true, force: true }); }
});

it('mainStepOf: ключ requestId, toolCalls ответа, реплика человека — новый turnId', () => {
  const a = adapter();
  const usage = { inputTokens: 1000, outputTokens: 100, totalTokens: 1100, cacheReadTokens: 800, cacheWriteTokens: 50 };
  const first = a.mainStepOf({
    completedAt: '2026-01-01T10:00:00.000Z', requestId: 'r1', turnId: 'turn_a', model: { modelId: 'GLM-5.3' },
    response: { toolCalls: [{ id: 'c1', name: 'Edit', input: { file_path: 'x' } }], usage },
  }, null);
  assert.equal(first.key, 'r1');
  assert.equal(first.ts, '2026-01-01T10:00:00.000Z');
  assert.equal(first.model, 'GLM-5.3');
  assert.equal(first.toolCalls.length, 1);
  assert.equal(first.toolCalls[0].name, 'Edit');
  assert.equal(first.usage, usage);
  assert.equal(first.human, true, 'первая запись файла — граница хода');
  const sameTurn = a.mainStepOf({ completedAt: '2026-01-01T10:00:05.000Z', requestId: 'r2', turnId: 'turn_a', response: { toolCalls: [], usage: {} } }, { turnId: 'turn_a' });
  assert.equal(sameTurn.human, false, 'ответ на AskUserQuestion ход не открывает');
  assert.equal(sameTurn.usage, null, 'usage без расхода — null');
  assert.equal(sameTurn.key, 'r2');
  const newTurn = a.mainStepOf({ completedAt: '2026-01-01T10:01:00.000Z', requestId: 'r3', turnId: 'turn_b', response: { usage } }, { turnId: 'turn_a' });
  assert.equal(newTurn.human, true, 'новый turnId — реплика человека');
  const noTime = a.mainStepOf({ requestId: 'r4' }, null);
  assert.equal(noTime, null, 'запись без времени — не запись');
});

it('тег zcode: проходит стену тегов ядра, чужой тег — нет', () => {
  const re = engineTagRe(root);
  assert.ok(re.test(' — `Run`, 2024-01-15: attempt, 121761 tokens (cache-read unknown), 575 s, `id unknown` — zcode: сборка адаптера'));
  assert.ok(!re.test(' — `Run`, 2024-01-15: attempt, 100 tokens, 5 s, `id unknown` — bogus-tag: чужая метка'));
});

it('transcriptsDir указывает на rollout хоста', () => {
  const dir = adapter().transcriptsDir(root);
  assert.ok(dir && fs.existsSync(dir), 'каталог стенограмм не найден');
  assert.ok(/rollout/.test(dir), 'ожидали каталог rollout хоста');
});

// 5. Вкладки ядра читают адаптер
it('formaRoles и engineSettings отдают данные зоны', () => {
  const a = adapter();
  const roles = a.formaRoles(root);
  assert.ok(roles.title === 'ZCode', 'заголовок вкладки Форма');
  const four = ['intent', 'spec', 'kit', 'core'];
  for (const n of four) assert.ok(roles.nodes.some((x) => (x.file || '').includes(n)), `вкладка Форма без роли ${n}`);
  assert.ok((roles.runRoles || []).some((x) => (x.file || '').includes('run')), 'вкладка Форма без каталога Run');
  const settings = a.engineSettings(root);
  assert.equal(settings.present, true);
  assert.ok(settings.nodes.length >= 5, 'узлов на вкладке Движок меньше пяти');
  assert.ok(settings.skills.includes('grilling'), 'скиллы .agents/skills не читаются');
});

// 6. Чистота зоны (запрет 16)
it('в текстах зоны нет следов проекта', () => {
  const scanDirs = ['.zcode/agents', '.zcode/rules', '.zcode/scripts'];
  const scanRoots = ['.zcode/forma-adapter.cjs'];
  const traces = [];
  const patterns = [/\bcard-\d{3}\b/, /\b\d{4}-\d{2}-\d{2}\b/, /github\.com/i];
  const scan = (abs, rel) => {
    if (!fs.existsSync(abs)) return;
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      for (const e of fs.readdirSync(abs)) scan(path.join(abs, e), `${rel}/${e}`);
      return;
    }
    if (!/\.(md|cjs)$/.test(rel)) return;
    const text = fs.readFileSync(abs, 'utf8');
    for (const p of patterns) if (p.test(text)) traces.push(`${rel}: ${p}`);
  };
  for (const d of scanDirs) scan(path.join(root, d), d);
  for (const f of scanRoots) scan(path.join(root, f), f);
  assert.deepEqual(traces, [], 'следы проекта в чистой зоне: ' + traces.join(', '));
});

// 7. Ключи frontmatter агентов зоны — закрытый список, опечатка не молчит
it('lint-agent-keys: все агенты зоны проходят по закрытому списку ключей', () => {
  const r = spawnSync(process.execPath, [path.join(root, '.zcode', 'scripts', 'lint-agent-keys.cjs')], { encoding: 'utf8' });
  assert.equal(r.status, 0, 'нарушения линта ключей:\n' + (r.stderr || r.stdout));
});

it('lint-agent-keys: опечатанный ключ — ошибка с адресом и именем ключа; чистый набор — выход 0', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentkeys-'));
  try {
    const probe = path.join(dir, 'agent-probe.md');
    fs.writeFileSync(probe, '---\nname: probe\nefort: high\n---\n\n# probe\n');
    const rBad = spawnSync(process.execPath, [path.join(root, '.zcode', 'scripts', 'lint-agent-keys.cjs'), dir], { encoding: 'utf8' });
    assert.notEqual(rBad.status, 0, 'опечатка прошла молча');
    assert.ok((rBad.stderr || '').includes('agent-probe.md'), 'ошибка без адреса файла: ' + rBad.stderr);
    assert.ok((rBad.stderr || '').includes('efort'), 'ошибка без имени ключа: ' + rBad.stderr);
    fs.writeFileSync(probe, '---\nname: probe\ndescription: probe\nmodel: m\neffort: high\ntier: light\nuses: a\ntools: Read\n---\n\n# probe\n');
    const rOk = spawnSync(process.execPath, [path.join(root, '.zcode', 'scripts', 'lint-agent-keys.cjs'), dir], { encoding: 'utf8' });
    assert.equal(rOk.status, 0, 'чистый набор не прошёл: ' + (rOk.stderr || rOk.stdout));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

console.log(`\nпройдено: ${passed}`);
