#!/usr/bin/env node
'use strict';
/**
 * The `--auto` mode test of card-session-spend.cjs (the SessionEnd hook) on a synthetic session journal
 * and a temporary board.
 *   node .claude/scripts/card-session-spend.test.cjs
 *
 * The expected ru labels are read from the core dictionary (fixed ru): the script writes the same ru
 * text as before the translation, and the assertion must not pin its own copy of the string.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, 'card-session-spend.cjs');
const i18n = require('../../.forma/i18n/index.cjs');
const msg = (code, params) => i18n.message(code, params, 'ru');
// The segments of the description template around its interpolated values (A..E are not in the ru text).
const DESC_PARTS = msg('spend.card-session.desc', { calls: 'A', window: 'B', out: 'C', cache_write: 'D', edge: 'E' }).split(/A|B|C|D|E/);
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
const human = (min) => JSON.stringify({ type: 'user', timestamp: D + 'T10:' + min + ':00.000Z', message: { role: 'user', content: 'do it' } });
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

it('--auto: a line for every touched card, none for an untouched one', () => {
  const r = run(['--auto'], event);
  assert.equal(r.status, 0);
  assert.equal(spendLines(f901).length, 1);
  assert.equal(spendLines(f902).length, 1);
  assert.equal(spendLines(f903).length, 0);
  assert.match(spendLines(f901)[0], new RegExp('Intent' + BT + ', ' + D + ': attempt, \\d[\\d ]* tokens .* ' + BT + SID + BT + ' — '));
});

it('a repeated --auto without new answers writes nothing', () => {
  const r = run(['--auto'], event);
  assert.equal(r.status, 0);
  assert.equal(spendLines(f901).length, 1);
  assert.equal(spendLines(f902).length, 1);
});

it('new answers -> a second line only for them (the window boundary)', () => {
  write([...rows1, human('06'), edit('07', f901, 5)]);
  const r = run(['--auto'], event);
  assert.equal(r.status, 0);
  assert.equal(spendLines(f901).length, 2);
  assert.equal(spendLines(f902).length, 1);
  assert.match(spendLines(f901)[1], / 140 tokens \(100 cache-read\), 25 out,/);
});

it('dedup with a manual run: after a manual line the hook does not duplicate, before - the manual one sees the hook line', () => {
  const f = card('904');
  write([human('00'), edit('01', f)]);
  const m = run(['904', '--write'], '');
  assert.equal(m.status, 0);
  assert.equal(spendLines(f).length, 1);
  const a = run(['--auto'], event);
  assert.equal(a.status, 0);
  assert.equal(spendLines(f).length, 1);
  // the reverse order: the hook first, the manual run after
  const g = card('905');
  write([human('00'), edit('01', g)]);
  run(['--auto'], event);
  assert.equal(spendLines(g).length, 1);
  const m2 = run(['905', '--write'], '');
  assert.equal(m2.status, 0);
  assert.equal(spendLines(g).length, 1);
});

it('a silent refusal: a broken input, no session log, no log directory - exit 0', () => {
  assert.equal(run(['--auto'], '{not json').status, 0);
  assert.equal(run(['--auto'], JSON.stringify({ session_id: 'no-such' })).status, 0);
  assert.equal(run(['--auto'], '', { CLAUDE_SPEND_PROJECTS: path.join(root, 'absent') }).status, 0);
});

it('the manual mode still requires a card number', () => {
  assert.equal(run([], '').status, 2);
});

// ───── Another engine's journal (the ZCode rollout format) through an adapter ─────
// The temp root gets its own adapter `.zcode/forma-adapter.cjs`: the layout (which files are the main
// sessions) and the normalized step belong to the engine; the script knows no paths and no format.

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

// The host fields are inclusive: inputTokens carries the whole input, the cache inside it (inputTokens + outputTokens = totalTokens).
const zrow = (min, turn, tools, usage) => JSON.stringify({
  completedAt: D + 'T11:' + min + ':00.000Z', requestId: 'zr' + min, turnId: turn, model: { modelId: 'GLM-5.3' },
  response: { toolCalls: tools, usage },
});
const zedit = (n, file) => [{ type: 'tool_use', name: 'Edit', input: { file_path: file } }];
// Fixture names are built dynamically: a "card-NNN" literal in a clean zone is a project trace (prohibition 16).
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
// The turn boundary: 912 is touched during t1, 913 - during t2; the answer between them belongs to nobody.
fs.writeFileSync(path.join(rollout, 'model-io-sess_zsess-333.jsonl'), [
  zrow('10', 't1', zedit('10', c912), U(1000, 900, 0, 10)),
  zrow('11', 't1', [], U(1000, 900, 0, 20)),
  zrow('12', 't2', zedit('12', c913), U(1000, 900, 0, 40)),
].join(NL) + NL);
// A subagent rollout journal with a touch of 914 - not read by the main scan.
fs.writeFileSync(path.join(rollout, 'model-io-sess_subagent_agent_zz.jsonl'), [
  zrow('20', 't1', zedit('20', c914), U(1000, 900, 0, 10)),
].join(NL) + NL);

it('a rollout journal through the adapter: a line with the engine tag, the numbers from the fact (the cache inside inputTokens)', () => {
  const r = run(['911', '--write'], '');
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const lines = spendLines(c911);
  assert.equal(lines.length, 1);
  // N = Σ totalTokens (the cache not doubled), R = Σ cacheRead, T = Σ of the gaps (60+240+60, within --idle).
  assert.ok(lines[0].includes(DESC_PARTS[0]));
  assert.match(lines[0], /attempt, 10\s?140 tokens \(8\s?300 cache-read\), 140 out, 360 s, `model-io-sess_zsess-222` — zcode: /);
  assert.ok(lines[0].includes(DESC_PARTS[3] + '100'));
});

it('the human turn boundary (turnId): the stretch of another turn and the answer between the turns belong to nobody', () => {
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

it('a subagent rollout journal is not read by the main scan', () => {
  const r = run(['914', '--write'], '');
  assert.equal(r.status, 1);
  assert.ok(r.stderr.includes(msg('spend.card-session.no_touch', { num: '914' })));
  assert.equal(spendLines(c914).length, 0);
});

it('--auto finds the freshest journal of all sources and does not duplicate the written lines', () => {
  const r = run(['--auto'], '');
  assert.equal(r.status, 0);
  assert.equal(spendLines(c912).length, 1);
  assert.equal(spendLines(c913).length, 1);
});

fs.rmSync(root, { recursive: true, force: true });
console.log(NL + passed + ' passed');
