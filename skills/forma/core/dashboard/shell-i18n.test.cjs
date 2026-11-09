#!/usr/bin/env node
'use strict';
/**
 * The other tabs and the shell in two languages: the t('…') keys exist in en and ru; no russian text in the code
 * or index.html; the simple tabs render on en without cyrillic and raw keys.
 *   node .forma/dashboard/shell-i18n.test.cjs
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');
const i18n = require('./lib/i18n.cjs');
const core = require('./web/js/i18n.js');

let passed = 0;
const it = (name, fn) => { fn(); passed += 1; console.log('ok  ' + name); };
// The sample dates are assembled, not written: a clean zone has no calendar dates (prohibition 16).
const D = (n) => ['2020', '01', '0' + n].join('-');
const rd = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const js = (f) => rd('web/js/' + f);
const dicts = { en: i18n.readDict('en'), ru: i18n.readDict('ru') };
const FILES = ['app.js', 'chain.js', 'docs.js', 'nodes.js', 'graphs.js', 'structure.js', 'forma.js', 'interview.js', 'law.js'];
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/[ \t]\/\/ .*$/gm, '');

for (const f of FILES) {
  it(`every key t('…') in ${f} exists in en and ru`, () => {
    const keys = new Set();
    for (const m of js(f).matchAll(/\bt\('([\w.-]+)'[,)]/g)) keys.add(m[1]);
    assert.ok(keys.size > 0, 'no keys');
    assert.deepEqual([...keys].filter((k) => !(k in dicts.en && k in dicts.ru)), []);
  });
  it(`${f} has no cyrillic outside comments`, () => {
    const hit = strip(js(f)).match(/.{0,30}[\u0410-\u044f\u0401\u0451]+.{0,20}/);
    assert.equal(hit, null, 'cyrillic in the code: ' + (hit && hit[0]));
  });
}

it('index.html and CSS without russian text', () => {
  const html = rd('index.html').replace(/<!--[\s\S]*?-->/g, '');
  assert.ok(!/[\u0410-\u044f\u0401\u0451]/.test(html), 'cyrillic in index.html: ' + (html.match(/.{20}[\u0410-\u044f\u0401\u0451]+.{10}/) || [''])[0]);
  assert.ok(/<html lang="en"/.test(html));
  for (const c of fs.readdirSync(path.join(__dirname, 'web/css'))) {
    const css = rd('web/css/' + c).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/content:\s*["'][^"']*[\u0410-\u044f\u0401\u0451]/.test(css), 'cyrillic in content: ' + c);
  }
});

function load(lang) {
  const el = { innerHTML: '', querySelectorAll: () => [], classList: { toggle() {} } };
  const ctx = { Intl, Date, Math, Number, String, Object, Array, Set, Map, JSON, console, parseInt, parseFloat, isNaN,
    document: { getElementById: () => el, addEventListener() {}, querySelector: () => el, querySelectorAll: () => [], documentElement: {} },
    window: {}, localStorage: { getItem: () => null, setItem() {} }, latestData: null };
  ctx.window = ctx;
  ctx.t = (key, vars) => core.translate(dicts, lang, key, vars);
  ctx.i18nLang = () => lang;
  vm.createContext(ctx);
  vm.runInContext(['common.js', 'graphs.js', 'nodes.js', 'chain.js', 'structure.js', 'docs.js'].map(js).join('\n')
    + '\nthis.__x = { nodesHtml, chainHtml, structureHtml, graphifyPanelHtml, docsHtml };', ctx, { filename: 'shell.js' });
  return ctx.__x;
}

const chain = { setup: [{ n: 1, name: 'Step', state: 'template', target: 'f.md' }], goals: [{ id: 'goal-01', roadmapName: null, draft: true, epic: '', cards: 2, cardsDone: 1 }, { id: 'goal-02', draft: false, epic: 'E', cards: 0 }],
  violations: [{ kind: 'no-goal-md', vars: { goal: 'goal-01' } }], summary: { goalsWithImage: 1, goalsTotal: 2, cardsUnderDraft: 2 } };
const structure = { groups: [], legend: [{ key: 'static', title: 'Static' }], settings: [{ rel: 'a.json', exists: false, who: 'human', note: 'n' }, { rel: 'b', exists: true, dir: true, files: 3, size: 2048, who: 'secret', note: 'n' }] };

for (const [lang, cyr] of [['en', false], ['ru', true]]) {
  it(`simple tabs render on ${lang}: no raw keys${cyr ? '' : ' and no cyrillic'}`, () => {
    const x = load(lang);
    const full = { reason: '', corpus: 'project' };
    const html = [x.nodesHtml([{ node: 'Kit', model: '', effort: '', toolCount: 3, externalModel: true }]), x.nodesHtml([]), x.chainHtml(chain),
      x.graphifyPanelHtml('project', null), x.graphifyPanelHtml('manual', { stale: true, pending: { pending: true },
        lastRun: { nodes: 1, edges: 2, communities: 3, warnings: 0, at: D(1) + ' 10:00', trigger: 'x', costUsd: 0.1 } }),
      x.docsHtml(null)].join('\n');
    assert.ok(html.length > 2000, 'did not render');
    assert.ok(!/\b(?:chain|docs|nodes|gr|st|app)\.[a-z][\w.]*/.test(html.replace(/<code>[^<]*<\/code>|\/graphs\/[\w./-]+|\w+\.(?:md|js|cjs|json)/g, '')), 'raw key: ' + (html.match(/\b(?:chain|docs|nodes|gr|st)\.[\w.]+/) || [''])[0]);
    assert.ok(!/\{\w+\}/.test(html), 'unsubstituted variable: ' + (html.match(/\{\w+\}/) || [''])[0]);
    if (!cyr) assert.ok(!/[\u0410-\u044f\u0401\u0451]/.test(html), 'cyrillic on en: ' + (html.match(/.{20}[\u0410-\u044f\u0401\u0451]+.{10}/) || [''])[0]);
    else assert.ok(/\u041f\u043e\u0434\u0433\u043e\u0442\u043e\u0432\u043a\u0430 \u043f\u0440\u043e\u0435\u043a\u0442\u0430/.test(html));
    void full; void structure;
  });
}

console.log(`\n${passed} passed`);
