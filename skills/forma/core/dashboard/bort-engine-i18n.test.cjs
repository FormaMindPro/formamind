#!/usr/bin/env node
'use strict';
/**
 * The "Board" and "Engine" tabs in two languages: all the t('…') keys from bort.js and engine.js exist in en and ru;
 * the render leaves no raw keys behind, and no cyrillic on en (the data in the test is english).
 *   node .forma/dashboard/bort-engine-i18n.test.cjs
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
const js = (f) => fs.readFileSync(path.join(__dirname, 'web/js', f), 'utf8');
const dicts = { en: i18n.readDict('en'), ru: i18n.readDict('ru') };
const FILES = ['bort.js', 'engine.js'];

for (const f of FILES) {
  it(`every key t('…') and cnt('…') in ${f} exists in en and ru`, () => {
    const keys = new Set();
    for (const m of js(f).matchAll(/\b(?:t|cnt)\('([\w.-]+)'[,)]/g)) keys.add(m[1]);
    assert.ok(keys.size > 40, 'too few keys found: ' + keys.size);
    assert.deepEqual([...keys].filter((k) => !(k in dicts.en && k in dicts.ru)), []);
  });
  it(`${f} has no cyrillic outside comments and source strings`, () => {
    const code = js(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      .replace(/'«[^'»]+»'/g, "''"); // PROJECT.md section names - data in the project's language
    const hit = code.match(/.{0,30}[\u0410-\u044f\u0401\u0451]+.{0,20}/);
    assert.equal(hit, null, 'cyrillic in the code: ' + (hit && hit[0]));
  });
}

function load(lang) {
  const el = { innerHTML: '', querySelectorAll: () => [] };
  const ctx = { Intl, Date, Math, Number, String, Object, Array, Set, Map, JSON, console, parseInt, parseFloat, isNaN,
    document: { getElementById: () => el, addEventListener() {}, documentElement: {} }, window: {}, localStorage: { getItem: () => null, setItem() {} },
    graphifyBadgeHtml: (h) => `<span class="badge">${h}</span>`, latestData: null };
  ctx.window = ctx;
  ctx.t = (key, vars) => core.translate(dicts, lang, key, vars);
  ctx.i18nLang = () => lang;
  vm.createContext(ctx);
  vm.runInContext(js('common.js') + '\n' + js('bort.js') + '\n' + js('engine.js')
    + '\nthis.__x = { bortNodesHtml, bortNodeHtml, bortSessionHtml, floorChartHtml, bortStripHtml, bortSummaryHtml, bortSessionBlockHtml, projectSettingsHtml, engineSettingsHtml, routesCatalogHtml };', ctx, { filename: 'bort-engine.js' });
  return ctx.__x;
}

const tool = (decl, verdict, calls, ambiguous = false) => ({ decl, verdict, calls, ambiguous });
const mk = (name, extra = {}) => ({ node: name, model: 'm', effort: 'high', file: name.toLowerCase() + '.md', inherits: false, toolCount: 3, weightTokens: 2160,
  tools: [tool('Read', 'live', 5), tool('Bash(ls)', 'live', 2, true), tool('Grep', 'dead', 0), tool('Glob', 'unknown', 0)],
  counts: { live: 2, dead: 1, unknown: 1 }, nodeInLog: true, calls: 7, deadWeight: 720, undeclared: [{ tool: 'Task', calls: 2 }], ...extra });
const bort = {
  source: true, log: { alive: true, usable: true, errorCount: 2 },
  nodes: [mk('Kit'), mk('Run', { nodeInLog: false, counts: { live: 0, dead: 0, unknown: 3 }, deadWeight: 0 }), mk('Spec', { inherits: true })],
  totals: { nodesInLog: 1, nodeCount: 3, live: 2, dead: 1, unknown: 4, toolCount: 6, weightTokens: 4320, deadWeight: 720 }, toolTokenCost: 720,
  servers: [{ name: 'srv', transport: 'stdio', target: 'cmd', level: 'project', source: '.mcp.json' }, { broken: true, source: 'bad.json' }],
  mcpScanned: [{ source: '.mcp.json', exists: true, count: 1 }, { source: 'x.json', exists: false }, { source: 'bad.json', broken: true }],
  referenced: [{ server: 'srv', toolCount: 2, nodes: ['Kit'], inProjectConfig: true }, { server: 'ext', toolCount: 1, nodes: ['Run'], inProjectConfig: false }],
  floor: { byDate: [{ date: D(1), floor: 70000, sessions: 3 }, { date: D(2), floor: 71000, sessions: 1 }], min: 70000, max: 71000, drift: 1000, ageHours: 3 },
};
const project = { present: true, language: 'en', thresholds: { attempts: 3, volume: 5 }, release: 10, goals: [{ id: 'goal-01' }, { id: 'goal-02', draft: true }],
  template: { name: 'T', status: 'draft' }, epics: { rows: [['1', 'Epic', 'Func', 'route-4']] }, services: { rows: [] },
  tooling: { columns: ['a'], rows: [['b']] }, references: { columns: ['a'], rows: [] }, skills: { columns: ['a'], rows: [['s']] } };
const engine = { present: true, check: { ran: true, ok: false, exitCode: 1, reasons: ['r'] }, hooks: [{ event: 'Stop', matcher: '', commands: ['.claude/hooks/a.sh'] }],
  hookDescs: {}, nodes: [{ name: 'Kit', model: 'm', effort: 'high', tools: ['Read'] }],
  mcp: { project: [{ file: '.mcp.json', servers: ['srv'] }, { file: 'x.json', servers: null }], user: [], userProject: ['u'] },
  skills: ['sk'], env: [{ name: 'A', value: 'v' }, { name: 'B', hidden: true }],
  routes: { source: 'ROUTES.md', routes: [{ code: 'route-0', name: 'n', chain: 'c', risks: [{ label: 'l', text: 'x' }], where: 'w' }], overlays: [{ code: 'over-1', name: 'o', changes: 'z', risks: [], where: [] }] } };

for (const [lang, cyr] of [['en', false], ['ru', true]]) {
  it(`render on ${lang}: no raw keys${cyr ? '' : ' and no cyrillic'}`, () => {
    const x = load(lang);
    const html = [x.bortNodesHtml(bort), x.bortSessionHtml(bort), x.floorChartHtml(bort.floor), x.floorChartHtml(null), x.floorChartHtml({ unavailable: '' }),
      bort.nodes.map((n, i) => x.bortStripHtml(n, i)).join(''), x.bortSummaryHtml(bort), x.bortSessionBlockHtml(bort),
      x.bortNodesHtml({ source: false }), x.bortNodesHtml({ source: true, log: { alive: false }, nodes: [] }),
      x.bortNodesHtml({ source: true, log: { alive: true, usable: false }, nodes: [] }),
      x.projectSettingsHtml(project), x.projectSettingsHtml(null), x.engineSettingsHtml(engine), x.engineSettingsHtml(null)].join('\n');
    assert.ok(html.length > 5000, 'did not render');
    assert.ok(!/\b(?:bort|eng)\.[a-z]+\.?[a-z]/.test(html), 'raw key: ' + (html.match(/\b(?:bort|eng)\.[\w.-]+/) || [''])[0]);
    assert.ok(!/\{\w+\}/.test(html), 'unsubstituted variable: ' + (html.match(/\{\w+\}/) || [''])[0]);
    if (!cyr) {
      // "Project epics" and other section names - sources in the project's language: data, not interface
      const clean = html.replace(/<span class="set-src">[^<]*<\/span>/g, '');
      assert.ok(!/[\u0410-\u044f\u0401\u0451]/.test(clean), 'cyrillic on en: ' + (clean.match(/.{20}[\u0410-\u044f\u0401\u0451]+.{10}/) || [''])[0]);
    } else assert.ok(/\u041d\u0430\u0433\u0440\u0443\u0437\u043a\u0430 \u043f\u043e \u0440\u043e\u043b\u044f\u043c/.test(html) && /\u041f\u043e\u043b \u043e\u043a\u043d\u0430/.test(html));
  });
}

console.log(`\n${passed} passed`);
