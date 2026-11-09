// Unit tests of dashboard/lib/cli.cjs: the four ways to read argv.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeCli, parseOptions, parseKnown, parseLong } = require('../skills/forma/core/dashboard/lib/cli.cjs');

test('makeCli.flag: the flag is there or not', () => {
  const c = makeCli(['--dry', 'x']);
  assert.equal(c.flag('dry'), true);
  assert.equal(c.flag('wet'), false);
});

test('makeCli.arg: the value after the flag; no value or a next flag - the fallback', () => {
  const c = makeCli(['--kind', 'protocol', '--bare', '--after', '--x']);
  assert.equal(c.arg('kind'), 'protocol');
  assert.equal(c.arg('bare', 'd'), 'd');
  assert.equal(c.arg('after', 'd'), 'd');
  assert.equal(c.arg('nope', 'd'), 'd');
});

test('makeCli.value: the raw next word; a last flag - undefined; no flag - the fallback', () => {
  const c = makeCli(['--a', '--b', '--last']);
  assert.equal(c.value('a'), '--b');
  assert.equal(c.value('last', 'd'), undefined);
  assert.equal(c.value('nope', 'd'), 'd');
});

test('makeCli.values: all values of a repeatable flag', () => {
  assert.deepEqual(makeCli(['--over', '1', '--x', '--over', '2']).values('over'), ['1', '2']);
});

test('makeCli.eq: the --name=value form; the value - the whole tail after the first "="', () => {
  const c = makeCli(['--only=board', '--q=a=b']);
  assert.equal(c.eq('only', ''), 'board');
  assert.equal(c.eq('q'), 'a=b');
  assert.equal(c.eq('nope', 'd'), 'd');
});

test('makeCli.positional: the words without "--"', () => {
  assert.deepEqual(makeCli(['record', '--a', 'b', 'c']).positional(), ['record', 'b', 'c']);
});

test('makeCli.die: a prefixed message in stderr, code 2', () => {
  const realExit = process.exit, realErr = console.error;
  let code, msg;
  process.exit = (c) => { code = c; };
  console.error = (m) => { msg = m; };
  try { makeCli([]).die('tool')('bad'); } finally { process.exit = realExit; console.error = realErr; }
  assert.equal(code, 2);
  assert.equal(msg, 'tool: bad');
});

test('parseOptions: a valueless flag - true, and it does not eat the neighboring flag', () => {
  assert.deepEqual(parseOptions(['--from-transcript', '--card', '143', '--end']), { 'from-transcript': true, card: '143', end: true });
});

test('parseOptions greedy: the next word is always a value', () => {
  assert.deepEqual(parseOptions(['--a', '--b', 'c'], { greedy: true }), { a: '--b' });
  assert.deepEqual(parseOptions(['--last'], { greedy: true }), { last: undefined });
});

test('parseKnown: only known flags, with a transform, over the seed', () => {
  const int = (v) => parseInt(v, 10);
  const spec = { '--prompt': 'prompt', '--max-tokens': ['maxTokens', int] };
  const out = parseKnown(['--prompt', 'hi', '--unknown', 'z', '--max-tokens', '42'], spec, { maxTokens: 8192 });
  assert.deepEqual(out, { maxTokens: 42, prompt: 'hi' });
  assert.deepEqual(parseKnown(['--toString', 'x'], spec, {}), {}, 'Object.prototype names are not taken for flags');
});

test('parseLong: --key=value, --key value, booleans and the rest', () => {
  const { opts, rest } = parseLong(['init', '--dir=/p', '--engines', 'claude', '--yes', 'tail'], ['yes']);
  assert.deepEqual(opts, { dir: '/p', engines: 'claude', yes: true });
  assert.deepEqual(rest, ['init', 'tail']);
  assert.deepEqual(parseLong(['--last']).opts, { last: undefined });
});
