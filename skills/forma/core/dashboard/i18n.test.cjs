#!/usr/bin/env node
'use strict';
/**
 * The dashboard localization: the translation core, the languages list, the en and ru dictionaries.
 *   node .forma/dashboard/i18n.test.cjs
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const core = require('./web/js/i18n.js');
const i18n = require('./lib/i18n.cjs');

let passed = 0;
const it = (name, fn) => { fn(); passed += 1; console.log('ok  ' + name); };

it('substitutions {name}; an unknown substitution stays as is', () => {
  assert.equal(core.translate({ en: { k: 'Hello, {name} {x}' } }, 'en', 'k', { name: 'Ann' }), 'Hello, Ann {x}');
});

it('no key in the language - en is taken; no key anywhere - the key itself', () => {
  const d = { en: { a: 'A', b: 'B' }, ru: { a: '\u0410' } };
  assert.equal(core.translate(d, 'ru', 'a'), '\u0410');
  assert.equal(core.translate(d, 'ru', 'b'), 'B');
  assert.equal(core.translate(d, 'ru', 'zzz'), 'zzz');
  assert.equal(core.translate(d, 'de', 'a'), 'A');
});

it('plural forms: en one/other, ru one/few/many', () => {
  const d = {
    en: { c: { one: '{n} card', other: '{n} cards' } },
    ru: { c: { one: '{n} \u043a\u0430\u0440\u0442\u043e\u0447\u043a\u0430', few: '{n} \u043a\u0430\u0440\u0442\u043e\u0447\u043a\u0438', many: '{n} \u043a\u0430\u0440\u0442\u043e\u0447\u0435\u043a', other: '{n} \u043a\u0430\u0440\u0442\u043e\u0447\u043a\u0438' } },
  };
  assert.deepEqual([1, 2, 5].map((n) => core.translate(d, 'en', 'c', { n })), ['1 card', '2 cards', '5 cards']);
  assert.deepEqual([1, 2, 5, 21].map((n) => core.translate(d, 'ru', 'c', { n })), ['1 \u043a\u0430\u0440\u0442\u043e\u0447\u043a\u0430', '2 \u043a\u0430\u0440\u0442\u043e\u0447\u043a\u0438', '5 \u043a\u0430\u0440\u0442\u043e\u0447\u0435\u043a', '21 \u043a\u0430\u0440\u0442\u043e\u0447\u043a\u0430']);
});

it('the languages list: en first, names from _meta.name, odd files are skipped', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-locales-'));
  fs.writeFileSync(path.join(dir, 'ru.json'), '{"_meta.name":"\u0420\u0443\u0441\u0441\u043a\u0438\u0439"}');
  fs.writeFileSync(path.join(dir, 'en.json'), '{"_meta.name":"English"}');
  fs.writeFileSync(path.join(dir, 'de.json'), '{}');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
  assert.deepEqual(i18n.listLocales(dir), [{ code: 'en', name: 'English' }, { code: 'de', name: 'de' }, { code: 'ru', name: '\u0420\u0443\u0441\u0441\u043a\u0438\u0439' }]);
});

it('the dashboard dictionaries: en and ru exist, the keys match', () => {
  const codes = i18n.listLocales().map((l) => l.code);
  assert.ok(codes.includes('en') && codes.includes('ru'));
  assert.deepEqual(Object.keys(i18n.readDict('ru')).sort(), Object.keys(i18n.readDict('en')).sort());
});

it('the server tr: the language and the en fallback', () => {
  assert.equal(i18n.tr('ru', 'tab.economy'), '\u042d\u043a\u043e\u043d\u043e\u043c\u0438\u043a\u0430');
  assert.equal(i18n.tr('en', 'tab.economy'), 'Economy');
  assert.equal(i18n.tr('xx', 'tab.economy'), 'Economy');
});

it('the dashboard count captions: en 1/2/5 cards, ru 1/2/5/21 card forms', () => {
  const d = { en: i18n.readDict('en'), ru: i18n.readDict('ru') };
  const tr = (lang, n) => core.translate(d, lang, 'count.cards', { n, num: String(n) });
  assert.deepEqual([1, 2, 5].map((n) => tr('en', n)), ['1 card', '2 cards', '5 cards']);
  assert.deepEqual([1, 2, 5, 21].map((n) => tr('ru', n)), ['1 \u043a\u0430\u0440\u0442\u043e\u0447\u043a\u0430', '2 \u043a\u0430\u0440\u0442\u043e\u0447\u043a\u0438', '5 \u043a\u0430\u0440\u0442\u043e\u0447\u0435\u043a', '21 \u043a\u0430\u0440\u0442\u043e\u0447\u043a\u0430']);
});

it('common.js: fmt and relTime go through Intl by the language, no russian forms in the code', () => {
  const vm = require('node:vm');
  const src = fs.readFileSync(path.join(__dirname, 'web/js/common.js'), 'utf8');
  const all = fs.readdirSync(path.join(__dirname, 'web/js')).filter((f) => f.endsWith('.js') && f !== 'law.js').map((f) => fs.readFileSync(path.join(__dirname, 'web/js', f), 'utf8')).join(' ');
  assert.ok(!/toLocaleString\('ru|ru-RU|plural\(|\u043d\u0430\u0437\u0430\u0434/.test(all));
  for (const [lang, num, ago] of [['en', '1,234', '5 minutes ago'], ['ru', '1 234', '5 \u043c\u0438\u043d\u0443\u0442 \u043d\u0430\u0437\u0430\u0434']]) {
    const ctx = { i18nLang: () => lang, t: () => '', Intl, Date, Math, Number, String, document: {} };
    vm.runInNewContext(src + '\nthis.out = { f: fmt(1234), r: relTime(5) };', ctx);
    assert.equal(ctx.out.f, num);
    assert.equal(ctx.out.r, ago);
  }
});

// The browser part: the file runs in a sandbox with fake window, document, fetch and localStorage.
function browser(store = {}) {
  const events = [];
  const win = {};
  const document = { documentElement: {}, title: '', querySelectorAll: () => [], getElementById: () => null, dispatchEvent: (e) => events.push(e.detail) };
  const ctx = {
    window: win, globalThis: win, document, Intl,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } },
    fetch: (url) => {
      if (url === 'locales.json') return Promise.resolve({ ok: true, json: () => Promise.resolve({ locales: i18n.listLocales() }) });
      const f = path.join(__dirname, url);
      return Promise.resolve(fs.existsSync(f) ? { ok: true, json: () => Promise.resolve(JSON.parse(fs.readFileSync(f, 'utf8'))) } : { ok: false });
    },
  };
  require('node:vm').runInNewContext(fs.readFileSync(path.join(__dirname, 'web/js/i18n.js'), 'utf8'), ctx);
  return { win, store, events };
}

(async () => {
  let b = browser();
  await b.win.i18nInit();
  assert.equal(b.win.i18nLang(), 'en');
  assert.equal(b.win.t('tab.economy'), 'Economy');
  await b.win.i18nSet('ru');
  assert.equal(b.win.t('tab.economy'), '\u042d\u043a\u043e\u043d\u043e\u043c\u0438\u043a\u0430');
  assert.equal(b.store['forma.lang'], 'ru');
  assert.deepEqual(b.events, ['en', 'ru']);
  passed += 1; console.log('ok  browser: en by default, the switch to ru, the choice is remembered, the i18n event');

  b = browser({ 'forma.lang': 'ru' });
  await b.win.i18nInit();
  assert.equal(b.win.t('tab.board'), '\u041a\u0430\u043d\u0431\u0430\u043d');
  b = browser({ 'forma.lang': 'xx' });
  await b.win.i18nInit();
  assert.equal(b.win.i18nLang(), 'en');
  passed += 1; console.log('ok  browser: the saved language applies; an unknown code - en');

  console.log(`\n${passed} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
