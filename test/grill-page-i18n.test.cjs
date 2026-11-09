// The grill page's web surface (`skills/forma-grill-with-ui/page.html`): dictionaries and the
// language choice, modeled on the dashboard (locales/en+ru, data-i18n markup keys, select#lang).
// Pins: en/ru parity of the dictionaries; the embedded copy matches the locale files; every key
// from the code and the markup is in both dictionaries and no key is unused; no cyrillic outside
// the dictionaries and comments; the three adapter mirrors are byte-identical to the core;
// the language is picked (saved choice, then the client language) and switched at runtime;
// a full state renders on both languages without leftovers.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const SKILL = path.join(ROOT, 'skills', 'forma', 'core', 'skills', 'forma-grill-with-ui');
const MIRRORS = [
  path.join(ROOT, 'skills', 'forma', 'adapters', 'claude', 'skills', 'forma-grill-with-ui', 'page.html'),
  path.join(ROOT, 'skills', 'forma', 'adapters', 'codex', '.agents', 'skills', 'forma-grill-with-ui', 'page.html'),
  path.join(ROOT, 'skills', 'forma', 'adapters', 'minimax', '.minimax', 'skills', 'forma-grill-with-ui', 'page.html'),
];
const CYR = /[\u0410-\u044f\u0401\u0451]/;

const read = (f) => fs.readFileSync(f, 'utf8');
const src = read(path.join(SKILL, 'page.html'));
const en = JSON.parse(read(path.join(SKILL, 'locales', 'en.json')));
const ru = JSON.parse(read(path.join(SKILL, 'locales', 'ru.json')));

// Comments (block, html and line ones) carry explanations and stay out of the check; the
// embedded DICTS literal is the page's copy of the dictionaries, checked separately below.
const strip = (s) => s
  .replace(/const DICTS = \{[\s\S]*?\n\};/, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '')
  .replace(/[ \t]\/\/ .*$/gm, '');

test('the markup is localized: data-i18n keys exist in en and ru', () => {
  const n = (src.match(/data-i18n/g) || []).length;
  assert.ok(n > 0, 'no data-i18n in the markup');
  for (const m of src.matchAll(/data-i18n(?:-title)?="([\w.-]+)"/g)) {
    assert.ok(m[1] in en && m[1] in ru, 'markup key not in the dictionaries: ' + m[1]);
  }
});

test('the dictionaries: en and ru parity, the same key order, over a hundred keys', () => {
  assert.deepEqual(Object.keys(ru), Object.keys(en));
  assert.ok(Object.keys(en).length >= 100, 'too few keys: ' + Object.keys(en).length);
  assert.equal(en['_meta.name'], 'English');
  assert.ok(CYR.test(ru['_meta.name']));
});

test('the embedded copy of the dictionaries matches the locale files', () => {
  const m = src.match(/const DICTS = (\{[\s\S]*?\n\});/);
  assert.ok(m, 'no embedded DICTS in the page');
  const embedded = JSON.parse(m[1]);
  assert.deepEqual(Object.keys(embedded).sort(), ['en', 'ru']);
  assert.deepEqual(embedded.en, en);
  assert.deepEqual(embedded.ru, ru);
});

test('every key the code and the markup use exists in both dictionaries; no unused keys', () => {
  const used = new Set();
  for (const m of src.matchAll(/\btr\("([\w.-]+)"/g)) used.add(m[1]);
  for (const m of src.matchAll(/data-i18n(?:-title)?="([\w.-]+)"/g)) used.add(m[1]);
  for (const m of src.matchAll(/\["([\w.-]+)"\]/g)) used.add(m[1]); // DICTS[code]["_meta.name"]
  assert.ok(used.size >= Object.keys(en).length, 'used keys ' + used.size + ' < dictionary keys ' + Object.keys(en).length);
  for (const k of used) assert.ok(k in en && k in ru, 'used key missing: ' + k);
  const orphan = Object.keys(en).filter((k) => !used.has(k));
  assert.deepEqual(orphan, [], 'unused dictionary keys');
});

test('no cyrillic outside the dictionaries and comments', () => {
  const hit = strip(src).match(/.{0,30}[\u0410-\u044f\u0401\u0451]+.{0,20}/);
  assert.equal(hit, null, 'cyrillic in the page: ' + (hit && hit[0]));
});

test('the adapter mirrors are byte-identical to the core page', () => {
  const core = fs.readFileSync(path.join(SKILL, 'page.html'));
  for (const f of MIRRORS) {
    assert.ok(fs.existsSync(f), 'mirror missing: ' + path.relative(ROOT, f));
    assert.deepEqual(fs.readFileSync(f), core, 'mirror differs: ' + path.relative(ROOT, f));
  }
});

// ---- the browser part: the page script runs in a sandbox with fake window, document, fetch and localStorage ----
function makeEl() {
  return { textContent: '', innerHTML: '', title: '', hidden: false, disabled: false, className: '', value: '',
    dataset: {}, style: {}, scrollHeight: 0,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    focus() {}, scrollIntoView() {}, setAttribute() {}, removeAttribute() {}, setSelectionRange() {},
    appendChild() {}, insertAdjacentHTML() {}, querySelector: () => null };
}
function sandbox(lang, store, stateText) {
  const els = new Map();
  const doc = {
    documentElement: { lang: '' },
    body: { classList: { toggle() {}, add() {}, contains: () => false } },
    activeElement: null,
    title: '',
    addEventListener() {},
    querySelector: () => makeEl(),
    querySelectorAll: () => [],
    getElementById: (id) => { if (!els.has(id)) els.set(id, makeEl()); return els.get(id); },
  };
  const created = [];
  doc.createElement = () => { const e = makeEl(); created.push(e); return e; };
  const ctx = {
    document: doc, Intl, Date, Math, Number, String, Object, Array, Map, Set, JSON, console, Promise,
    isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent,
    navigator: { language: lang },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } },
    setTimeout: () => 0,
    fetch: () => Promise.resolve(stateText === null
      ? { ok: false, text: () => Promise.resolve('') }
      : { ok: true, text: () => Promise.resolve(stateText) }),
    CustomEvent: class { constructor(t, i) { this.type = t; this.detail = i && i.detail; } },
  };
  ctx.window = ctx;
  ctx.__created = created;
  ctx.globalThis = ctx;
  const m = src.match(/<script>\n([\s\S]*?)\n<\/script>/);
  assert.ok(m, 'no script block in the page');
  vm.runInNewContext(m[1] + '\n;this.__x = { T: () => T, tr, LANG: () => LANG, setLang, DICTS };', ctx, { filename: 'grill-page.js' });
  return ctx;
}
const settle = () => new Promise((r) => setTimeout(r, 25));

test('the language is picked: the saved choice wins, then the client language, en last', async () => {
  assert.equal(sandbox('ru-RU', {}, null).__x.LANG(), 'ru');
  assert.equal(sandbox('en-US', {}, null).__x.LANG(), 'en');
  assert.equal(sandbox('en-US', { 'forma.lang': 'ru' }, null).__x.LANG(), 'ru');
  assert.equal(sandbox('en-US', { 'forma.lang': 'xx' }, null).__x.LANG(), 'en');
  await settle();
});

test('the switch: setLang rebuilds the strings, remembers the choice, applies the markup', async () => {
  const b = sandbox('ru-RU', {}, null);
  await settle();
  assert.equal(b.__x.T().sendToAgent, ru.sendToAgent);
  assert.equal(b.document.documentElement.lang, 'ru');
  b.__x.setLang('en');
  assert.equal(b.__x.LANG(), 'en');
  assert.equal(b.__x.T().sendToAgent, en.sendToAgent);
  assert.equal(b.document.documentElement.lang, 'en');
  assert.equal(b.localStorage.getItem('forma.lang'), 'en');
  b.__x.setLang('xx');
  assert.equal(b.__x.LANG(), 'en', 'an unknown code must be ignored');
  await settle();
});

test('plurals follow the language: ru one/few/many, en one/other (forms from the dictionaries)', async () => {
  const ruForms = { 1: 'one', 2: 'few', 5: 'many', 21: 'one' };
  const enForms = { 1: 'one', 2: 'other' };
  const got = (lang, ns) => ns.map((n) => sandbox(lang, {}, null).__x.tr('message', { n }));
  assert.deepEqual(got('ru-RU', Object.keys(ruForms).map(Number)),
    Object.entries(ruForms).map(([n, f]) => ru.message[f].replace('{n}', n)));
  assert.deepEqual(got('en-US', Object.keys(enForms).map(Number)),
    Object.entries(enForms).map(([n, f]) => en.message[f].replace('{n}', n)));
  await settle();
});

const state = () => ({
  project: 'demo', created: '2026-01-01T00:00:00Z', topic: 'the plan', doc: 'plan.md',
  note: 'answer in any order',
  agent: { status: 'waiting', since: '2026-01-01T00:00:00Z', handled: 0 },
  terms: [{ term: 'grill', def: 'an interview', avoid: ['chat'] }],
  questions: [
    { id: 'q1', round: 1, status: 'open', title: 'Pick the shape', body: 'Choose a shape', deps: ['q2'], durable: true, updated: true,
      rec: { option: 'a', why: 'it fits' }, options: [{ k: 'a', text: 'Square' }, { k: 'b', text: 'Circle' }] },
    { id: 'q2', round: 1, status: 'answered', title: 'Pick the color', body: 'Choose a color',
      answer: { kind: 'option', option: 'a' }, options: [{ k: 'a', text: 'Red' }, { k: 'b', text: 'Blue' }] },
  ],
});

test('a full state renders on both languages from the dictionaries, no leftovers', async () => {
  for (const [lang, dict] of [['ru-RU', ru], ['en-US', en]]) {
    const b = sandbox(lang, {}, JSON.stringify(state()));
    await settle();
    const nav = b.__created.map((e) => e.innerHTML + e.textContent).join(''); // the nav is built via createElement
    const main = b.document.getElementById('main').innerHTML;
    const aside = b.document.getElementById('aside').innerHTML;
    const list = b.document.getElementById('staged-list').innerHTML;
    const send = b.document.getElementById('send').textContent;
    const all = nav + main + aside + list + send;
    assert.ok(all.length > 500, 'did not render');
    assert.ok(!/\{\w+\}/.test(all), 'unsubstituted variable: ' + (all.match(/\{[\w.]+\}/) || [''])[0]);
    assert.ok(nav.includes(dict.round.replace('{r}', '1')), 'no round label');
    assert.ok(main.includes(dict.crumbRound.replace('{r}', '1')), 'no crumb round label');
    assert.ok(nav.includes(dict.statusOpen), 'no open status mark');
    assert.ok(main.includes(dict.recommended), 'no recommendation tag');
    assert.ok(main.includes(dict.placeholderFreeText), 'no answer placeholder');
    assert.ok(list.includes(dict.nothingStaged), 'no footer hint');
    assert.equal(send, dict.sendToAgent, 'send button text');
    assert.equal(b.document.getElementById('terms-toggle').textContent,
      dict.termsWithCount.replace('{n}', '1'), 'terms button text');
    if (lang === 'en-US') assert.ok(!CYR.test(all), 'cyrillic on en: ' + (all.match(/.{20}[\u0410-\u044f\u0401\u0451]+.{10}/) || [''])[0]);
    else assert.ok(CYR.test(all), 'the ru page must speak russian');
  }
});
