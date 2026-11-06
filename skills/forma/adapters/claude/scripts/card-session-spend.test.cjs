#!/usr/bin/env node
'use strict';
/**
 * Тест режима `--auto` card-session-spend.cjs (хук SessionEnd) на синтетическом журнале сессии и временной доске.
 *   node .claude/scripts/card-session-spend.test.cjs
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, 'card-session-spend.cjs');
const D = ['2000', '01', '02'].join('-');
const NL = String.fromCharCode(10);
const BT = String.fromCharCode(96);
let passed = 0;
const it = (name, fn) => { fn(); passed += 1; console.log('ok  ' + name); };

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spend-auto-'));
const projects = path.join(root, 'journals');
const board = path.join(root, '.devtool', 'features');
fs.mkdirSync(board, { recursive: true });
fs.mkdirSync(projects, { recursive: true });
const card = (n) => {
  const f = path.join(board, 'card-' + n + '-test.md');
  fs.writeFileSync(f, ['---', 'id: "card-' + n + '-test"', 'status: "todo"', '---', '# card-' + n, '', '## Task', 'x', '', '## History',
    '- ' + BT + 'Intent' + BT + ', ' + D + ': stage kit — start.', '', '## Result', ''].join(NL));
  return f;
};
const f901 = card('901'), f902 = card('902'), f903 = card('903');
const SID = 'sess-1111';
const journal = path.join(projects, SID + '.jsonl');
let mid = 0;
const human = (min) => JSON.stringify({ type: 'user', timestamp: D + 'T10:' + min + ':00.000Z', message: { role: 'user', content: 'сделай' } });
const edit = (min, file, extra = 0) => JSON.stringify({
  type: 'assistant', timestamp: D + 'T10:' + min + ':30.000Z',
  message: { id: 'm' + (++mid), content: [{ type: 'tool_use', name: 'Edit', input: { file_path: file } }],
    usage: { input_tokens: 10, output_tokens: 20 + extra, cache_read_input_tokens: 100, cache_creation_input_tokens: 5 } },
});
const write = (rows) => fs.writeFileSync(journal, rows.join(NL) + NL);
const run = (args, input, env = {}) => spawnSync(process.execPath, [SCRIPT, ...args], {
  input, encoding: 'utf8', env: { ...process.env, CLAUDE_SPEND_ROOT: root, CLAUDE_SPEND_PROJECTS: projects, ...env },
});
const spendLines = (f) => fs.readFileSync(f, 'utf8').split(NL).filter((l) => l.includes('card-session-spend'));
const event = JSON.stringify({ session_id: SID });

const rows1 = [human('00'), edit('01', f901), human('02'), edit('03', f902), human('04'), edit('05', f901)];
write(rows1);

it('--auto: строка на каждую затронутую карточку, нетронутой — нет', () => {
  const r = run(['--auto'], event);
  assert.equal(r.status, 0);
  assert.equal(spendLines(f901).length, 1);
  assert.equal(spendLines(f902).length, 1);
  assert.equal(spendLines(f903).length, 0);
  assert.match(spendLines(f901)[0], new RegExp('Intent' + BT + ', ' + D + ': attempt, \\d[\\d ]* tokens .* ' + BT + SID + BT + ' — '));
});

it('повторный --auto без новых ответов ничего не пишет', () => {
  const r = run(['--auto'], event);
  assert.equal(r.status, 0);
  assert.equal(spendLines(f901).length, 1);
  assert.equal(spendLines(f902).length, 1);
});

it('новые ответы → вторая строка только за них (граница окна)', () => {
  write([...rows1, human('06'), edit('07', f901, 5)]);
  const r = run(['--auto'], event);
  assert.equal(r.status, 0);
  assert.equal(spendLines(f901).length, 2);
  assert.equal(spendLines(f902).length, 1);
  assert.match(spendLines(f901)[1], / 140 tokens \(100 cache-read\), 25 out,/);
});

it('дедуп с ручным запуском: после ручной строки хук не дублирует, до — ручной видит хуковую', () => {
  const f = card('904');
  write([human('00'), edit('01', f)]);
  const m = run(['904', '--write'], '');
  assert.equal(m.status, 0);
  assert.equal(spendLines(f).length, 1);
  const a = run(['--auto'], event);
  assert.equal(a.status, 0);
  assert.equal(spendLines(f).length, 1);
  // обратный порядок: хук первым, ручной после
  const g = card('905');
  write([human('00'), edit('01', g)]);
  run(['--auto'], event);
  assert.equal(spendLines(g).length, 1);
  const m2 = run(['905', '--write'], '');
  assert.equal(m2.status, 0);
  assert.equal(spendLines(g).length, 1);
});

it('тихий отказ: битый вход, нет журнала сессии, нет каталога журналов — exit 0', () => {
  assert.equal(run(['--auto'], '{не json').status, 0);
  assert.equal(run(['--auto'], JSON.stringify({ session_id: 'нет-такой' })).status, 0);
  assert.equal(run(['--auto'], '', { CLAUDE_SPEND_PROJECTS: path.join(root, 'нет') }).status, 0);
});

it('ручной режим по-прежнему требует номер карточки', () => {
  assert.equal(run([], '').status, 2);
});

// ───── Журнал другого движка (формат rollout ZCode) через адаптер ─────
// Временный корень получает свой адаптер `.zcode/forma-adapter.cjs`: раскладка (какие файлы —
// основные сессии) и нормализованный шаг принадлежат движку; скрипт путей и формата не знает.

const rollout = path.join(root, '.zcode', 'rollout');
fs.mkdirSync(rollout, { recursive: true });
fs.writeFileSync(path.join(root, '.zcode', 'forma-adapter.cjs'), [
  "'use strict';",
  "const fs = require('fs');",
  "const path = require('path');",
  'const dir = (root) => path.join(root, \'.zcode\', \'rollout\');',
  'module.exports = {',
  "  engine: 'zcode', id: 'zcode', spendTag: 'zcode',",
  '  mainSessions(root) {',
  '    const d = dir(root);',
  '    if (!fs.existsSync(d)) return [];',
  "    return fs.readdirSync(d).filter((f) => /^model-io-sess_(?!subagent_)[A-Za-z0-9_-]+\\.jsonl$/.test(f))",
  '      .map((f) => ({ id: f.slice(0, -6), file: path.join(d, f) }));',
  '  },',
  '  mainStepOf(line, prev) {',
  '    if (!line || !(line.completedAt || line.startedAt)) return null;',
  '    const response = line.response || {};',
  '    const u = response.usage && typeof response.usage === \'object\' ? response.usage : null;',
  '    const usage = u && [\'inputTokens\', \'cacheReadTokens\', \'outputTokens\', \'cacheWriteTokens\']',
  '      .some((k) => Number.isFinite(Number(u[k]))) ? u : null;',
  '    return {',
  '      ts: line.completedAt || line.startedAt,',
  '      key: line.requestId || null,',
  '      usage,',
  '      toolCalls: Array.isArray(response.toolCalls) ? response.toolCalls : [],',
  "      human: typeof line.turnId === 'string' && line.turnId !== (prev && prev.turnId || null),",
  '      model: (line.model && line.model.modelId) || null,',
  '    };',
  '  },',
  '  parseUsage(step) {',
  '    if (!step) return { tokens_in: null, tokens_out: null, cache_read: null, cache_write: null };',
  "    const u = (step.message && step.message.usage) || step.usage || step;",
  "    const num = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);",
  "    const pick = (keys) => { for (const k of keys) { const n = u ? num(u[k]) : null; if (n != null) return n; } return null; };",
  "    const cacheRead = pick(['inputCacheRead', 'cache_read', 'cacheReadTokens', 'cache_read_input_tokens']);",
  "    const cacheCreation = pick(['inputCacheCreation', 'cache_write', 'cacheWriteTokens', 'cache_creation_input_tokens']);",
  '    const hostInput = num(u && u.inputTokens);',
  '    const inputOther = hostInput != null ? hostInput - (cacheRead || 0) - (cacheCreation || 0)',
  "      : pick(['inputOther', 'tokens_in', 'input_tokens']);",
  "    return { tokens_in: inputOther, tokens_out: pick(['output', 'output_tokens', 'outputTokens']), cache_read: cacheRead, cache_write: cacheCreation };",
  '  },',
  '};',
].join(NL));

// Поля хоста включающие: inputTokens несёт весь ввод, кэш внутри него (inputTokens + outputTokens = totalTokens).
const zrow = (min, turn, tools, usage) => JSON.stringify({
  completedAt: D + 'T11:' + min + ':00.000Z', requestId: 'zr' + min, turnId: turn, model: { modelId: 'GLM-5.3' },
  response: { toolCalls: tools, usage },
});
const zedit = (n, file) => [{ type: 'tool_use', name: 'Edit', input: { file_path: file } }];
// Имена фикстур собираются динамически: литерал «card-NNN» в чистой зоне — след проекта (запрет 16).
const cf = (n) => path.join(board, 'card-' + n + '-test.md');
const c911 = cf('911'), c912 = cf('912'), c913 = cf('913'), c914 = cf('914');
card('911'); card('912'); card('913'); card('914');
const U = (inp, cr, cw, out) => ({ inputTokens: inp, cacheReadTokens: cr, cacheWriteTokens: cw, outputTokens: out, totalTokens: inp + out });
fs.writeFileSync(path.join(rollout, 'model-io-sess_zsess-222.jsonl'), [
  zrow('00', 't1', [], U(1000, 800, 0, 20)),
  zrow('01', 't1', zedit('01', c911), U(2000, 1500, 100, 30)),
  zrow('05', 't2', [], U(3000, 2500, 0, 40)),
  zrow('06', 't2', zedit('06', c911), U(4000, 3500, 0, 50)),
].join(NL) + NL);
// Граница хода: 912 тронута в ходе t1, 913 — в ходе t2; ответ между ними никому не отходит.
fs.writeFileSync(path.join(rollout, 'model-io-sess_zsess-333.jsonl'), [
  zrow('10', 't1', zedit('10', c912), U(1000, 900, 0, 10)),
  zrow('11', 't1', [], U(1000, 900, 0, 20)),
  zrow('12', 't2', zedit('12', c913), U(1000, 900, 0, 40)),
].join(NL) + NL);
// Субагентский журнал rollout с касанием 914 — основным сканом не читается.
fs.writeFileSync(path.join(rollout, 'model-io-sess_subagent_agent_zz.jsonl'), [
  zrow('20', 't1', zedit('20', c914), U(1000, 900, 0, 10)),
].join(NL) + NL);

it('rollout-журнал через адаптер: строка с тегом движка, числа из факта (кэш внутри inputTokens)', () => {
  const r = run(['911', '--write'], '');
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const lines = spendLines(c911);
  assert.equal(lines.length, 1);
  // N = Σ totalTokens (кэш не задвоен), R = Σ cacheRead, T = Σ промежутков (60+240+60, в пределах --idle).
  assert.match(lines[0], /attempt, 10\s?140 tokens \(8\s?300 cache-read\), 140 out, 360 s, `model-io-sess_zsess-222` — zcode: расход основной сессии/);
  assert.match(lines[0], /запись в кеш 100/);
});

it('граница хода человека (turnId): чужой отрезок и ответ между ходами не отходят', () => {
  const a = run(['912', '--write'], '');
  assert.equal(a.status, 0, a.stderr || a.stdout);
  const la = spendLines(c912);
  assert.equal(la.length, 1);
  assert.match(la[0], / 10 out,/);
  const b = run(['913', '--write'], '');
  assert.equal(b.status, 0, b.stderr || b.stdout);
  const lb = spendLines(c913);
  assert.equal(lb.length, 1);
  assert.match(lb[0], / 40 out,/);
});

it('субагентский журнал rollout основным сканом не читается', () => {
  const r = run(['914', '--write'], '');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /касаний не найдено/);
  assert.equal(spendLines(c914).length, 0);
});

it('--auto находит свежайший журнал всех источников и не дублирует записанные строки', () => {
  const r = run(['--auto'], '');
  assert.equal(r.status, 0);
  assert.equal(spendLines(c912).length, 1);
  assert.equal(spendLines(c913).length, 1);
});

fs.rmSync(root, { recursive: true, force: true });
console.log(NL + passed + ' passed');
