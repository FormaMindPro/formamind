// The dashboard frame: index.html - markup only, the styles and scripts live in dashboard/web/ and are served as statics.
// A refactoring safety net: an inlined <style>/<script> back, a grown page, a lost file or the server serving a style
// with the wrong type - the test falls. The install (forma init) is taken from the fixture: it is installed by it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { makeFixture } = require('./helpers/fixture.cjs');
const { startServer, request } = require('./helpers/serve.cjs');

const MAX_INDEX_LINES = 200;
const TYPES = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

let fx;
let server;
let html;
let assets;
const dash = (...p) => path.join(fx.root, '.forma', 'dashboard', ...p);

test.before(async () => {
  fx = makeFixture();
  html = fs.readFileSync(dash('index.html'), 'utf8');
  // Only own files: external ones (CDN, fonts) start with a scheme.
  assets = [...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^":]+)"/g)].map((m) => m[1]);
  server = await startServer(fx);
});

test.after(async () => {
  if (server) await server.stop();
  if (fx) fx.cleanup();
});

test('index.html - the frame only: up to 200 lines, no inlined styles or scripts', () => {
  assert.ok(html.split('\n').length <= MAX_INDEX_LINES, `lines: ${html.split('\n').length}`);
  assert.ok(!/<style[\s>]/i.test(html), 'an inlined <style>');
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    assert.match(m[1], /\bsrc=/, 'an inlined <script> without src: ' + m[2].trim().slice(0, 60));
    assert.equal(m[2].trim(), '', 'a <script src> has a body');
  }
});

test('the install lays every file index.html references, and no extra one in web/', () => {
  assert.ok(assets.some((a) => a.endsWith('.css')) && assets.some((a) => a.endsWith('.js')), assets.join(', '));
  for (const a of assets) assert.ok(fs.existsSync(dash(a)), 'no file ' + a);
  const onDisk = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : onDisk.push(path.relative(dash(), path.join(d, e.name)).replace(/\\/g, '/'))));
  walk(dash('web'));
  assert.deepEqual(onDisk.sort(), [...assets].sort(), 'the web/ files and the index.html references diverge');
});

test('the scripts parse as classic (no modules) and run in order: i18n first, common second, app last', () => {
  const js = assets.filter((a) => a.endsWith('.js'));
  assert.deepEqual(js.slice(0, 2).map((a) => path.basename(a)), ['i18n.js', 'common.js']);
  assert.equal(path.basename(js[js.length - 1]), 'app.js');
  for (const a of js) assert.doesNotThrow(() => new vm.Script(fs.readFileSync(dash(a), 'utf8'), { filename: a }), a);
});

test('the server serves the styles and scripts as statics with the right type and no cache', async () => {
  for (const a of assets) {
    const r = await request(server.port, 'GET', '/' + a);
    assert.equal(r.status, 200, a);
    assert.equal(r.headers['content-type'], TYPES[path.extname(a)], a);
    assert.equal(r.headers['cache-control'], 'no-store, must-revalidate', a);
    assert.equal(r.body, fs.readFileSync(dash(a), 'utf8'), a);
  }
});

test('the server serves the language list and the en and ru catalogs', async () => {
  const r = await request(server.port, 'GET', '/locales.json');
  assert.equal(r.status, 200);
  const j = JSON.parse(r.body);
  assert.equal(j.default, 'en');
  assert.deepEqual(j.locales.map((l) => l.code), ['en', 'ru']);
  for (const code of ['en', 'ru']) assert.equal((await request(server.port, 'GET', `/locales/${code}.json`)).status, 200);
});
