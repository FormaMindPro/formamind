#!/usr/bin/env node
'use strict';

/**
 * names - the resolver of protocol codes into human names (AGENTS.md section 1, prohibition 20).
 * A code never goes alone in speech to the human: the address stays, the name rides beside it.
 *
 *   node .forma/i18n/names.cjs card-NNN route-8 goal-protocol prohibition-20
 *     prints "code - name" for each code; exit 1 when a code has no name.
 *
 * Sources: cards - the board headline in `.devtool/features/`; goals - the heading of
 * `project/goals/<code>/GOAL.md`; routes, overlays, law sections and prohibitions - `keys.json`.
 * Project data (card titles, goal and epic names) is read at runtime and never enters the
 * machine dictionary: clean zones, prohibition 16.
 *
 * Module: resolve(root, code, lang) -> { code, kind, name } | null;
 *         scan(root, text, lang) -> [{ code, kind, name, render }].
 */

const fs = require('node:fs');
const path = require('node:path');
const i18n = require('./index.cjs');

const KEYS = i18n.KEYS;
const BOARD = path.join('.devtool', 'features');

const CARD_RE = /^card-(\d{1,4})$/;
const ROUTE_RE = /^route-[0-8]$/;
const OVER_RE = /^over-[1-4]$/;
const LAW_RE = /^law-([1-7])$/;
const PROHIBITION_RE = /^prohibition-(\d{1,2})$/;
const GOAL_RE = /^goal-[a-z0-9]+(?:-[a-z0-9]+)*$/;

const SCAN = [
  /\bcard-\d{1,4}\b/g,
  /\broute-[0-8]\b/g,
  /\bover-[1-4]\b/g,
  /\bgoal-[a-z0-9]+(?:-[a-z0-9]+)*\b/g,
  /\bprohibition-\d{1,2}\b/g,
  /\blaw-[1-7]\b/g,
  /\u00a7\s?[1-7]\b/g,
];

const label = (entry, lang) => (entry ? entry[lang] || entry.en : null);

/** Card headline name: the part after the middle dot in `# card-NNN . Title`; closed cards live in `done/`. */
function cardName(root, n) {
  for (const lane of [BOARD, path.join(BOARD, 'done')]) {
    let files;
    try { files = fs.readdirSync(path.join(root, lane)); } catch { continue; }
    const file = files.find((f) => f.endsWith('.md') && new RegExp('^card-' + n + '(?:-|\\.md$)').test(f));
    if (!file) continue;
    let text;
    try { text = fs.readFileSync(path.join(root, lane, file), 'utf8'); } catch { continue; }
    const m = new RegExp('^#\\s+card-' + n + '\\s*\\u00b7\\s*(.+)$', 'm').exec(text);
    if (m && m[1].trim()) return m[1].trim();
  }
  return null;
}

/** Goal name: the part after the middle dot in its GOAL.md heading; the folder or the heading code names it. */
function goalName(root, code) {
  const suffix = code.startsWith('goal-') ? code.slice(5) : code;
  const dir = path.join(root, 'project', 'goals');
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const file = path.join(dir, e.name, 'GOAL.md');
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const m = /^#\s+[^\n]*?`([^`]+)`\s*\u00b7\s*(.+)$/m.exec(text);
    if (!m) continue;
    const head = m[1].trim();
    if (code === e.name || code === 'goal-' + head || suffix === head) return m[2].trim();
  }
  return null;
}

/** One code -> its human name; null when the code is unknown or the name is missing. */
function resolve(root, code, lang) {
  const c = String(code || '').trim();
  if (CARD_RE.test(c)) {
    const name = cardName(root, CARD_RE.exec(c)[1]);
    return name ? { code: c, kind: 'card', name } : null;
  }
  if (ROUTE_RE.test(c)) {
    const name = label((KEYS.routeNames || {})[c], lang);
    return name ? { code: c, kind: 'route', name } : null;
  }
  if (OVER_RE.test(c)) {
    const name = label((KEYS.routeNames || {})[c], lang);
    return name ? { code: c, kind: 'overlay', name } : null;
  }
  if (LAW_RE.test(c)) {
    const name = label((KEYS.lawSections || {})[c], lang);
    return name ? { code: c, kind: 'section', name } : null;
  }
  if (PROHIBITION_RE.test(c)) {
    const name = label((KEYS.prohibitionNames || {})[c], lang);
    return name ? { code: c, kind: 'prohibition', name } : null;
  }
  if (GOAL_RE.test(c)) {
    const name = goalName(root, c);
    return name ? { code: c, kind: 'goal', name } : null;
  }
  return null;
}

/** How the mention reads in chat: the name, the address beside it. */
function render(hit, lang) {
  const code = hit.code;
  if (hit.kind === 'card') {
    const mask = label(KEYS.cardMask, lang) || 'Card-{n} "{title}"';
    const n = CARD_RE.exec(code)[1];
    return mask.replace('{n}', n).replace('{title}', hit.name);
  }
  if (hit.kind === 'route') return i18n.message('names.route', { name: hit.name, code }, lang);
  if (hit.kind === 'overlay') return i18n.message('names.overlay', { name: hit.name, code }, lang);
  if (hit.kind === 'goal') return i18n.message('names.goal', { name: hit.name, code }, lang);
  if (hit.kind === 'section') return i18n.message('names.section', { n: LAW_RE.exec(code)[1], name: hit.name }, lang);
  return i18n.message('names.prohibition', { n: PROHIBITION_RE.exec(code)[1], name: hit.name }, lang);
}

/** Codes mentioned in `text`, in order, once each; a name-less code is left out. */
function scan(root, text, lang) {
  const found = [];
  const seen = new Set();
  for (const re of SCAN) {
    for (const m of String(text || '').matchAll(re)) {
      let code = m[0];
      if (code.startsWith('\u00a7')) code = 'law-' + code.replace(/\D/g, '');
      if (seen.has(code)) continue;
      seen.add(code);
      const hit = resolve(root, code, lang);
      if (hit) found.push({ ...hit, index: m.index, render: render(hit, lang) });
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

module.exports = { resolve, render, scan, cardName, goalName };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const rootIdx = argv.indexOf('--root');
  const root = rootIdx >= 0 ? path.resolve(argv[rootIdx + 1]) : path.resolve(__dirname, '..', '..');
  const codes = argv.slice();
  if (rootIdx >= 0) codes.splice(rootIdx, 2);
  const lang = i18n.projectLang(root);
  let red = 0;
  for (const code of codes) {
    const hit = resolve(root, code, lang);
    if (hit) console.log(`${code} \u2014 ${hit.name}`);
    else { red = 1; console.log(`${code} \u2014 ?`); }
  }
  process.exit(red);
}
