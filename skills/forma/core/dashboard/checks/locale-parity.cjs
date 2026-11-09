'use strict';

// The dashboard's localization: the `locales/en.json` and `ru.json` dictionaries match by keys; every key from
// the code and the markup is in the dictionaries; no unused keys in the dictionaries; no cyrillic outside comments
// in `web/` (js, html, css `content`). A core check; the engines' sync puts it into the registry. Dynamic keys
// (`t('chain.v.' + kind)`) are covered by a prefix.

const fs = require('fs');
const path = require('path');
const { walk } = require('../lib/fs.cjs');
// The findings' canonical ru strings live in the core dictionary; the language is fixed.
const { message: coreMessage } = require('../../i18n/index.cjs');
const ruMsg = (key, params) => coreMessage(key, params, 'ru');

const CYR = /[\u0410-\u042f\u0430-\u044f\u0401\u0451]/;
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/[ \t]\/\/ .*$/gm, '');
const stripHtml = (s) => s.replace(/<!--[\s\S]*?-->/g, '');
const rd = (f) => fs.readFileSync(f, 'utf8');
// A line with the `i18n-keep` mark - cyrillic as data (a card field's name, a language's native name): not a violation.
const dropKept = (s) => s.split('\n').filter((l) => !l.includes('i18n-keep')).join('\n');

function readDict(dir, lang) {
  try { return JSON.parse(rd(path.join(dir, 'locales', lang + '.json'))); } catch (e) { return { __error: e.message }; }
}

function run({ root }) {
  const dir = path.join(root, '.forma/dashboard');
  const rel = (f) => '.forma/dashboard/' + path.relative(dir, f).split(path.sep).join('/');
  if (!fs.existsSync(path.join(dir, 'locales'))) return [];
  const problems = [];
  const en = readDict(dir, 'en'), ru = readDict(dir, 'ru');
  for (const [l, d] of [['en', en], ['ru', ru]]) if (d.__error) problems.push(ruMsg('locale_parity.dict_unreadable', { lang: l, reason: d.__error }));
  if (en.__error || ru.__error) return problems;

  for (const k of Object.keys(en)) if (!(k in ru)) problems.push(ruMsg('locale_parity.key_missing_ru', { key: k }));
  for (const k of Object.keys(ru)) if (!(k in en)) problems.push(ruMsg('locale_parity.key_missing_en', { key: k }));

  const web = walk(path.join(dir, 'web'), { abs: true, tolerant: true }).filter((f) => /\.(js|css)$/.test(f));
  const all = [...web, path.join(dir, 'index.html')].filter((f) => fs.existsSync(f));
  const code = walk(dir, { abs: true, tolerant: true, skip: (e) => e.isDirectory() && /^(node_modules|locales|test)$/.test(e.name) })
    .filter((f) => /\.(js|cjs|html)$/.test(f) && !/\.test\.cjs$/.test(f));

  const used = new Set(), prefixes = new Set();
  for (const f of code) {
    const text = rd(f);
    for (const m of text.matchAll(/\b(?:t|cnt|tr)\(\s*(?:[a-z]+,\s*)?'([\w.\/-]+)'\s*([,)+])/g)) (m[2] === '+' ? prefixes : used).add(m[1]);
    for (const m of text.matchAll(/\b(?:t|cnt)\(\s*`([\w.\/-]+)\$\{/g)) prefixes.add(m[1]);
    for (const m of text.matchAll(/data-i18n(?:-ph|-title)?="([\w.\/-]+)"/g)) used.add(m[1]);
    for (const m of text.matchAll(/key:\s*'([\w.\/-]+)'/g)) used.add(m[1]);
    for (const m of text.matchAll(/'((?:[a-z]+\.)+[\w.\/-]*)'\s*\+/g)) prefixes.add(m[1]);
    for (const m of text.matchAll(/['"]([a-z]+(?:\.[\w-]+)+\.?)['"]/g)) (m[1].endsWith('.') ? prefixes : used).add(m[1]);
    for (const m of text.matchAll(/stTr\('([gk])'/g)) prefixes.add('st.' + m[1] + '.');
  }
  const isUsed = (k) => used.has(k) || [...prefixes].some((p) => k.startsWith(p));
  for (const f of code) {
    const text = rd(f);
    for (const m of text.matchAll(/\b(?:t|cnt)\(\s*'([\w.-]+)'\s*[,)]/g)) if (!(m[1] in en)) problems.push(ruMsg('locale_parity.key_from_code', { file: rel(f), key: m[1] }));
    for (const m of text.matchAll(/data-i18n(?:-ph|-title)?="([\w.-]+)"/g)) if (!(m[1] in en)) problems.push(ruMsg('locale_parity.key_from_markup', { file: rel(f), key: m[1] }));
  }
  for (const k of Object.keys(en)) if (k in ru && !k.startsWith('_meta.') && !isUsed(k)) problems.push(ruMsg('locale_parity.key_unused', { key: k }));

  for (const f of all) {
    let s = rd(f);
    if (f.endsWith('.css')) { const hit = s.replace(/\/\*[\s\S]*?\*\//g, '').match(/content:\s*["'][^"']*[\u0410-\u042f\u0430-\u044f\u0401\u0451][^"']*/); if (hit) problems.push(`${rel(f)}: \u043a\u0438\u0440\u0438\u043b\u043b\u0438\u0446\u0430 \u0432 content — ${hit[0].slice(0, 60)}`); continue; }
    s = dropKept(s); s = f.endsWith('.html') ? stripHtml(s) : stripJs(s);
    const hit = s.match(/.{0,25}[\u0410-\u042f\u0430-\u044f\u0401\u0451]+.{0,15}/);
    if (hit && CYR.test(hit[0])) problems.push(ruMsg('locale_parity.cyr_outside', { file: rel(f), hit: hit[0].trim() }));
  }
  return problems;
}

module.exports = { id: 'locale-parity', since: null, run };
