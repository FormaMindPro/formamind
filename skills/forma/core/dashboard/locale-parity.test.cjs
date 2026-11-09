#!/usr/bin/env node
'use strict';
/**
 * The locale-parity check: red on the samples of spoilage (an extra key, a missed translation, an unused key,
 * a key from the code without a dictionary, cyrillic in web/js and index.html), green on clean code; the dashboard build on en and ru.
 *   node .forma/dashboard/locale-parity.test.cjs
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const check = require('./checks/locale-parity.cjs');
const i18n = require('./lib/i18n.cjs');

let passed = 0;
const it = (name, fn) => { fn(); passed += 1; console.log('ok  ' + name); };

// The sample: a tiny "dashboard" in a temporary root.
function sample(mutate) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'locale-parity-'));
  const d = path.join(root, '.forma/dashboard');
  fs.mkdirSync(path.join(d, 'locales'), { recursive: true });
  fs.mkdirSync(path.join(d, 'web/js'), { recursive: true });
  fs.mkdirSync(path.join(d, 'web/css'), { recursive: true });
  const w = (rel, text) => fs.writeFileSync(path.join(d, rel), text);
  w('locales/en.json', JSON.stringify({ '_meta.name': 'English', 'a.title': 'A', 'a.kind.x': 'X' }));
  w('locales/ru.json', JSON.stringify({ '_meta.name': '\u0420\u0443\u0441\u0441\u043a\u0438\u0439', 'a.title': '\u0410', 'a.kind.x': '\u0418\u043a\u0441' }));
  w('web/js/a.js', "// \u043a\u043e\u043c\u043c\u0435\u043d\u0442\u0430\u0440\u0438\u0439 \u043f\u043e-\u0440\u0443\u0441\u0441\u043a\u0438 — \u043c\u043e\u0436\u043d\u043e\nconst a = t('a.title'); const b = t('a.kind.' + k);\n");
  w('web/css/base.css', '.x::before{content:"▶"}\n');
  w('index.html', '<html lang="en"><!-- \u043c\u043e\u0436\u043d\u043e --><h1 data-i18n="a.title"></h1></html>\n');
  if (mutate) mutate(w, d);
  return { root, run: () => check.run({ root }) };
}
const has = (problems, re) => assert.ok(problems.some((p) => re.test(p)), 'no finding ' + re + ' in ' + JSON.stringify(problems));

it('the clean sample - no findings', () => assert.deepEqual(sample().run(), []));
it('a missed translation (the key only in en)', () => has(sample((w) => w('locales/en.json', JSON.stringify({ '_meta.name': 'E', 'a.title': 'A', 'a.kind.x': 'X', 'a.more': 'M' }))).run(), /\u043a\u043b\u044e\u0447\u0430 «a\.more» \u043d\u0435\u0442 \u0432 ru\.json/));
it('an extra key only in ru', () => has(sample((w) => w('locales/ru.json', JSON.stringify({ '_meta.name': '\u0420', 'a.title': '\u0410', 'a.kind.x': '\u0418', 'a.extra': '\u042d' }))).run(), /\u043a\u043b\u044e\u0447\u0430 «a\.extra» \u043d\u0435\u0442 \u0432 en\.json/));
it('an unused key', () => {
  const both = (w) => { for (const l of ['en', 'ru']) w(`locales/${l}.json`, JSON.stringify({ '_meta.name': l, 'a.title': 'A', 'a.kind.x': 'X', 'z.dead': 'D' })); };
  has(sample(both).run(), /«z\.dead» \u043d\u0438\u0433\u0434\u0435 \u043d\u0435 \u0438\u0441\u043f\u043e\u043b\u044c\u0437\u0443\u0435\u0442\u0441\u044f/);
});
it('a key from the code without a dictionary entry', () => has(sample((w) => w('web/js/a.js', "const a = t('a.title'); const c = t('a.missing');\n")).run(), /\u043a\u043b\u044e\u0447 «a\.missing» \u0438\u0437 \u043a\u043e\u0434\u0430/));
it('a key from the markup without a dictionary entry', () => has(sample((w) => w('index.html', '<html lang="en"><h1 data-i18n="a.title"></h1><p data-i18n="a.nope"></p></html>')).run(), /\u043a\u043b\u044e\u0447 «a\.nope» \u0438\u0437 \u0440\u0430\u0437\u043c\u0435\u0442\u043a\u0438/));
it('cyrillic in web/js', () => has(sample((w) => w('web/js/a.js', "const a = t('a.title'); const b = t('a.kind.' + k); const s = '\u041f\u0440\u0438\u0432\u0435\u0442';\n")).run(), /a\.js: \u043a\u0438\u0440\u0438\u043b\u043b\u0438\u0446\u0430 \u0432\u043d\u0435 \u0441\u043b\u043e\u0432\u0430\u0440\u0435\u0439/));
it('cyrillic in index.html', () => has(sample((w) => w('index.html', '<html lang="en"><h1 data-i18n="a.title">\u0417\u0430\u0433\u043e\u043b\u043e\u0432\u043e\u043a</h1></html>')).run(), /index\.html: \u043a\u0438\u0440\u0438\u043b\u043b\u0438\u0446\u0430/));
it('cyrillic in css content', () => has(sample((w) => w('web/css/base.css', '.x::before{content:"▶ \u0417\u0434\u0435\u0441\u044c"}\n')).run(), /base\.css: \u043a\u0438\u0440\u0438\u043b\u043b\u0438\u0446\u0430 \u0432 content/));
it('the i18n-keep mark allows data', () => assert.deepEqual(sample((w) => w('web/js/a.js', "const a = t('a.title'); const b = t('a.kind.' + k); const f = '\u0420\u043e\u043b\u044c'; // i18n-keep\n")).run(), []));
it('no locales directory - the check stays silent', () => assert.deepEqual(check.run({ root: fs.mkdtempSync(path.join(os.tmpdir(), 'lp-')) }), []));
it('the real dashboard is clean', () => assert.deepEqual(check.run({ root: path.join(__dirname, '../..') }), []));
it('the dictionary build: en and ru read, the keys are equal in number', () => {
  const en = i18n.readDict('en'), ru = i18n.readDict('ru');
  assert.equal(Object.keys(en).length, Object.keys(ru).length);
  assert.deepEqual(i18n.listLocales().map((l) => l.code).sort(), ['en', 'ru']);
});
console.log(`\n${passed} passed`);
