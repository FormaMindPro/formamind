// The system's structure: directory trees - the protocol source, the engine, the engines' adapters (one per each found), the project;
// plus the project root by the kind of its content: settings, dynamics, permanent data, arbitrary.
//
// Read from disk on every dashboard rebuild - the tree is always fresh, no model calls.
// The captions come from the NOTES reference below; a folder without a caption is shown all the same.
'use strict';

const fs = require('fs');
const path = require('path');
const { walk } = require('./lib/fs.cjs');
const engines = require('./lib/engines.cjs');
// Canonical English strings of this module's own CLI output live in the core dictionary; the log language is fixed.
const { message: coreMessage } = require('../i18n/index.cjs');
const logMsg = (key, params) => coreMessage(key, params, 'en');

// The core groups; the adapters' groups (the `structure` field) stand between "Engine" and "Project".
const CORE_GROUPS = [
  { key: '.forma/protocol', title: 'Protocol · plugin source', note: 'a separate repository: the plugin is installed into projects from it',
    roots: ['.forma/protocol'] },
  { key: 'engine', title: 'Engine', note: 'the system itself in this project — without the protocol source',
    roots: ['AGENTS.md', '.forma/board', { p: '.devtool', dirs: true }, '.forma/skills', '.forma/manual', '.forma/dashboard', '.forma/living'] },
  { key: 'project', title: 'Project', note: 'what the project consists of — first level, without working content',
    roots: [{ p: 'project', max: 2 }] },
];

/** The core groups with the adapters' groups before "Project", and the adapters' directories' captions. */
function groupsFor(root) {
  const adapterStructures = engines.loadAdapters(root).map((a) => a.structure).filter(Boolean);
  const groups = [...CORE_GROUPS];
  groups.splice(groups.length - 1, 0, ...adapterStructures);
  return { groups, notes: Object.assign({}, ...adapterStructures.map((s) => s.notes || {})) };
}

// The project root by the kind of content. Static - only the settings a human edits;
// dynamics - what is kept during the work. mixed - dynamics is still being kept in a settings file
// (what exactly - in why); the split is a separate decision.
const PROJECT_KINDS = [
  { key: 'static', title: 'Static · settings', note: 'edited by a human; does not change during work', items: [
    { p: 'project/config/PROJECT.md', note: '\u044f\u0437\u044b\u043a, \u043f\u043e\u0440\u043e\u0433\u0438, \u044d\u043f\u0438\u043a\u0438, \u043c\u0430\u0440\u0448\u0440\u0443\u0442\u044b, \u0441\u0435\u0440\u0432\u0438\u0441\u044b, \u043e\u0441\u043d\u0430\u0441\u0442\u043a\u0430, \u0434\u043e\u0441\u0442\u0443\u043f\u044b',
      mixed: '\u0441\u0442\u0430\u0442\u0443\u0441 \u0448\u0430\u0431\u043b\u043e\u043d\u0430, «\u0412\u0435\u0440\u0441\u0438\u044f \u043d\u0430 \u0441\u0435\u0433\u043e\u0434\u043d\u044f» \u0441\u043f\u0440\u0430\u0432\u043e\u0447\u043d\u0438\u043a\u043e\u0432, \u0440\u0435\u0435\u0441\u0442\u0440 \u043e\u0444\u043e\u0440\u043c\u043b\u0435\u043d\u043d\u044b\u0445 \u0443\u043c\u0435\u043d\u0438\u0439' },
    { p: 'project/config/CONFIG.md', note: '\u0441\u0442\u0440\u0443\u043a\u0442\u0443\u0440\u0430 \u0440\u0430\u0437\u0434\u0435\u043b\u043e\u0432 \u043f\u0440\u043e\u0435\u043a\u0442\u0430 \u0438 \u0434\u043e\u0441\u043a\u0438',
      mixed: '«\u0422\u0435\u0445\u043d\u0438\u0447\u0435\u0441\u043a\u0438\u0435 \u043a\u043e\u043d\u0442\u0440\u0430\u043a\u0442\u044b \u0441\u0440\u0435\u0434\u044b», «\u041b\u043e\u0433 \u043e\u0441\u043d\u0430\u0441\u0442\u043a\u0438»' },
    { p: 'project/config/ROUTE.md', note: '\u0448\u0430\u0433\u0438 \u043c\u0430\u0440\u0448\u0440\u0443\u0442\u0430 \u0448\u0430\u0431\u043b\u043e\u043d\u0430',
      mixed: '«\u041f\u0440\u043e\u0439\u0434\u0435\u043d\u043e», «\u0422\u043e\u0447\u043a\u0438 \u0432\u044b\u0431\u043e\u0440\u0430»' },
    { p: 'project/config/SETUP.md', note: '\u043f\u043e\u0440\u044f\u0434\u043e\u043a \u043f\u043e\u0434\u0433\u043e\u0442\u043e\u0432\u043a\u0438 \u043f\u0440\u043e\u0435\u043a\u0442\u0430' },
  ] },
  { key: 'dynamic', title: 'Dynamics · project keeping', note: 'statistics and state; written by the nodes during work', items: [
    { p: 'project/ops/JOURNAL.md', note: '\u0436\u0443\u0440\u043d\u0430\u043b \u043a\u0440\u0443\u0433\u043e\u0432' },
    { p: 'project/ops/VALUE.md', note: '\u0441\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043a\u0430 \u0438 \u0446\u0435\u043d\u043d\u043e\u0441\u0442\u044c \u043f\u043e \u0437\u0430\u043a\u0440\u044b\u0442\u044b\u043c \u0446\u0435\u043b\u044f\u043c' },
    { p: 'project/ops/ROADMAP.md', note: '\u043a\u0430\u0440\u0442\u0430 \u0446\u0435\u043b\u0435\u0439 \u0438 \u0438\u0445 \u0441\u043e\u0441\u0442\u043e\u044f\u043d\u0438\u0435' },
    { p: 'project/goals', note: '\u0446\u0435\u043b\u0438: \u043e\u0431\u0440\u0430\u0437, \u043a\u0440\u0443\u0433\u0438, \u0432\u0435\u0440\u0434\u0438\u043a\u0442\u044b' },
    { p: 'project/cards', note: '\u043c\u0430\u0442\u0435\u0440\u0438\u0430\u043b, \u0440\u043e\u0436\u0434\u0451\u043d\u043d\u044b\u0439 \u043a\u0430\u0440\u0442\u043e\u0447\u043a\u0430\u043c\u0438' },
    { p: 'project/experience', note: '\u043e\u043f\u044b\u0442: \u0444\u0430\u043a\u0442\u044b \u0441\u0440\u0435\u0434\u044b' },
    { p: '.devtool/features', note: '\u0434\u043e\u0441\u043a\u0430: \u043a\u0430\u0440\u0442\u043e\u0447\u043a\u0438' },
  ] },
  { key: 'data', title: 'Permanent data', note: 'set once, then only read', items: [
    { p: 'project/brief', note: '\u044f\u043a\u043e\u0440\u044c: \u0447\u0442\u043e \u0441\u043a\u0430\u0437\u0430\u043b \u0447\u0435\u043b\u043e\u0432\u0435\u043a \u0434\u043e \u043f\u0435\u0440\u0432\u043e\u0439 \u0446\u0435\u043b\u0438' },
    { p: 'project/VARS', note: '\u0440\u0435\u0448\u0451\u043d\u043d\u044b\u0435 \u0432\u0435\u043b\u0438\u0447\u0438\u043d\u044b \u0438 \u0434\u043e\u0441\u0442\u0443\u043f\u044b' },
    { p: 'project/reference', note: '\u0441\u043f\u0440\u0430\u0432\u043e\u0447\u043d\u044b\u0435 \u043c\u0430\u0442\u0435\u0440\u0438\u0430\u043b\u044b' },
    { p: 'project/design-system', note: '\u0434\u0438\u0437\u0430\u0439\u043d-\u0441\u0438\u0441\u0442\u0435\u043c\u0430' },
  ] },
  { key: 'free', title: 'Project content', note: 'the product itself — different in every project', items: [
    { p: 'project/mockups', note: '\u043c\u0430\u043a\u0435\u0442\u044b \u0438 \u043a\u0430\u0440\u0442\u0430 \u0441\u0430\u0439\u0442\u0430 (SITEMAP.md)' },
    { p: 'project/theme', note: '\u0442\u0435\u043c\u0430 \u0441\u0430\u0439\u0442\u0430' },
    { p: 'project/prompts', note: '\u043f\u0440\u043e\u043c\u043f\u0442\u044b \u0441\u0442\u0440\u0430\u043d\u0438\u0446' },
    { p: 'project/docs', note: '\u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442\u0430\u0446\u0438\u044f \u0434\u043b\u044f \u0447\u0435\u043b\u043e\u0432\u0435\u043a\u0430' },
  ] },
];

function projectKinds(root) {
  const known = new Set(PROJECT_KINDS.flatMap(k => k.items.map(i => i.p)));
  const kinds = PROJECT_KINDS.map(k => ({ key: k.key, title: k.title, note: k.note,
    items: k.items.map(i => {
      const n = node(root, i.p, MAX_DEPTH);
      return n && { name: i.p, rel: i.p, desc: n.desc, note: i.note, mixed: i.mixed || null, dir: n.dir, files: n.files };
    }).filter(Boolean) }));
  // everything in the root of project/ not sorted into kinds is visible separately, not lost
  let rest = [];
  try { rest = fs.readdirSync(path.join(root, 'project')).filter(n => !SKIP.has(n)).map(n => 'project/' + n).filter(p => !known.has(p)); } catch { /* no project/ directory - nothing unsorted */ }
  if (rest.length) kinds.push({ key: 'unsorted', title: 'Not sorted', note: 'in the root of project/, no kind assigned',
    items: rest.map(p => { const n = node(root, p, MAX_DEPTH); return { name: p, note: null, mixed: null, dir: n.dir, files: n.files }; }) });
  return kinds;
}

const NOTES = {
  'AGENTS.md': '\u0437\u0430\u043a\u043e\u043d §1–7: \u043f\u044f\u0442\u044c \u0443\u0437\u043b\u043e\u0432, \u043c\u0430\u0440\u0448\u0440\u0443\u0442, \u043f\u043e\u0440\u043e\u0433\u0438, \u0437\u0430\u043f\u0440\u0435\u0442\u044b',
  '.forma/protocol': '\u0438\u0441\u0445\u043e\u0434\u043d\u0438\u043a \u043f\u0440\u043e\u0442\u043e\u043a\u043e\u043b\u0430 — \u043e\u0442\u0434\u0435\u043b\u044c\u043d\u044b\u0439 \u0440\u0435\u043f\u043e\u0437\u0438\u0442\u043e\u0440\u0438\u0439',
  '.forma/protocol/templates': '\u0448\u0430\u0431\u043b\u043e\u043d\u044b \u043f\u0440\u043e\u0435\u043a\u0442\u043e\u0432',
  '.forma/protocol/skills': '\u0441\u043a\u0438\u043b\u043b\u044b, \u043f\u043e\u0441\u0442\u0430\u0432\u043b\u044f\u0435\u043c\u044b\u0435 \u0441 \u043f\u0440\u043e\u0442\u043e\u043a\u043e\u043b\u043e\u043c',
  '.forma/board': '\u044f\u0434\u0440\u043e \u0434\u043e\u0441\u043a\u0438: \u0441\u043e\u0437\u0434\u0430\u043d\u0438\u0435 \u0438 \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0430 \u043a\u0430\u0440\u0442\u043e\u0447\u0435\u043a',
  '.forma/skills': '\u0438\u043d\u0442\u0435\u0440\u0432\u044c\u044e-\u0441\u043a\u0438\u043b\u043b\u044b \u044f\u0434\u0440\u0430, \u0434\u043e\u0441\u0442\u0430\u0432\u043b\u044f\u044e\u0442\u0441\u044f \u0432 \u043a\u0430\u0442\u0430\u043b\u043e\u0433 \u0441\u043a\u0438\u043b\u043b\u043e\u0432 \u0430\u0434\u0430\u043f\u0442\u0435\u0440\u0430',
  '.forma/manual': '\u0440\u0443\u043a\u043e\u0432\u043e\u0434\u0441\u0442\u0432\u043e \u043f\u043e \u043f\u0440\u043e\u0442\u043e\u043a\u043e\u043b\u0443',
  '.forma/manual/ru': '\u0440\u0443\u043a\u043e\u0432\u043e\u0434\u0441\u0442\u0432\u043e, \u0440\u0443\u0441\u0441\u043a\u0430\u044f \u0432\u0435\u0440\u0441\u0438\u044f',
  '.forma/manual/en': '\u0440\u0443\u043a\u043e\u0432\u043e\u0434\u0441\u0442\u0432\u043e, \u0430\u043d\u0433\u043b\u0438\u0439\u0441\u043a\u0438\u0439 \u043f\u043e\u0434\u043b\u0438\u043d\u043d\u0438\u043a',
  '.forma/dashboard': '\u0434\u0430\u0448\u0431\u043e\u0440\u0434: \u0441\u0431\u043e\u0440 \u0434\u0430\u043d\u043d\u044b\u0445 \u0438 \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0430',
  '.forma/living': '\u0436\u0438\u0432\u044b\u0435 \u0434\u0430\u043d\u043d\u044b\u0435: \u0433\u0440\u0430\u0444\u044b, \u0436\u0443\u0440\u043d\u0430\u043b \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u0439, \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0438',
  '.forma/living/graphs': '\u0433\u0440\u0430\u0444\u044b \u0437\u043d\u0430\u043d\u0438\u0439',
  'project': '\u043c\u0430\u0442\u0435\u0440\u0438\u0430\u043b \u043f\u0440\u043e\u0435\u043a\u0442\u0430',
  'project/brief': '\u044f\u043a\u043e\u0440\u044c: \u0447\u0442\u043e \u0441\u043a\u0430\u0437\u0430\u043b \u0447\u0435\u043b\u043e\u0432\u0435\u043a \u0434\u043e \u043f\u0435\u0440\u0432\u043e\u0439 \u0446\u0435\u043b\u0438',
  'project/goals': '\u0446\u0435\u043b\u0438 \u0438 \u0438\u0445 \u043e\u0431\u0440\u0430\u0437\u044b',
  'project/cards': '\u043c\u0430\u0442\u0435\u0440\u0438\u0430\u043b, \u0440\u043e\u0436\u0434\u0451\u043d\u043d\u044b\u0439 \u043a\u0430\u0440\u0442\u043e\u0447\u043a\u0430\u043c\u0438',
  'project/design-system': '\u0434\u0438\u0437\u0430\u0439\u043d-\u0441\u0438\u0441\u0442\u0435\u043c\u0430',
  'project/mockups': '\u043c\u0430\u043a\u0435\u0442\u044b',
  'project/adr': '\u0436\u0443\u0440\u043d\u0430\u043b \u0440\u0435\u0448\u0435\u043d\u0438\u0439',
  'project/VARS': '\u0434\u043e\u0441\u0442\u0443\u043f\u044b \u043a \u0441\u0430\u0439\u0442\u0443',
  'project/config/PROJECT.md': '\u043f\u043e\u0440\u043e\u0433\u0438, \u044d\u043f\u0438\u043a\u0438, \u043c\u0430\u0440\u0448\u0440\u0443\u0442\u044b, \u0432\u043d\u0435\u0448\u043d\u0438\u0435 \u0441\u0435\u0440\u0432\u0438\u0441\u044b',
  'project/ops/JOURNAL.md': '\u0436\u0443\u0440\u043d\u0430\u043b \u0446\u0438\u043a\u043b\u043e\u0432',
  '.devtool': '\u0434\u043e\u0441\u043a\u0430: \u043a\u0430\u0442\u0430\u043b\u043e\u0433\u0438 \u0441\u0442\u0430\u0442\u0443\u0441\u043e\u0432; \u043a\u0430\u0440\u0442\u043e\u0447\u043a\u0438 \u0432 \u043d\u0438\u0445 — \u043f\u0440\u043e\u0435\u043a\u0442',
  '.devtool/features': '\u043a\u0430\u0440\u0442\u043e\u0447\u043a\u0438 \u043f\u0440\u043e\u0435\u043a\u0442\u0430: \u0432 \u0440\u0430\u0431\u043e\u0442\u0435 \u0438 done/',
  '.devtool/features/done': '\u043f\u0440\u0438\u043d\u044f\u0442\u044b\u0435 \u043a\u0430\u0440\u0442\u043e\u0447\u043a\u0438',
};

const SKIP = new Set(['.git', 'node_modules', '.cache', 'temp', '__pycache__', '.github']);
const MAX_DEPTH = 3;       // deeper - only a file counter
const MAX_CHILDREN = 40;   // per one folder; the rest - by one line

// The description out of the file itself: the frontmatter's description, the script's header comment, the first heading of a .md.
function describe(abs) {
  let t;
  try { const fd = fs.openSync(abs, 'r'); const b = Buffer.alloc(2048); const n = fs.readSync(fd, b, 0, 2048, 0); fs.closeSync(fd); t = b.toString('utf8', 0, n); } catch { return null; }
  t = t.replace(/^\uFEFF/, '').replace(/^#!.*\r?\n/, '');
  const fm = t.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fm) { const d = fm[1].match(/^description:\s*(.+)$/m); if (d) return d[1].replace(/^["']|["']$/g, '').trim().slice(0, 300); }
  if (/\.(cjs|js|mjs|sh|py)$/.test(abs)) {
    const c = t.split(/\r?\n/).filter(l => /^\s*(\/\/|#|\*|\/\*)/.test(l) && !/use strict/.test(l)).slice(0, 3)
      .map(l => l.replace(/^\s*(\/\/+|#+|\/\*+|\*+\/?)\s?/, '').trim()).filter(Boolean).join(' ');
    return c ? c.slice(0, 300) : null;
  }
  if (/\.md$/.test(abs)) { const h = t.replace(/^---[\s\S]*?---\s*/, '').match(/^#\s+(.+)$/m); return h ? h[1].trim().slice(0, 200) : null; }
  return null;
}

function countFiles(abs) {
  return walk(abs, { symlinks: true, tolerant: true, skip: (e) => SKIP.has(e.name) }).length;
}

// opts.dirs - directories only (a skeleton, without working files); opts.max - its own disclosure depth.
function node(root, rel, depth, opts = {}) {
  const abs = path.join(root, rel);
  let st;
  try { st = fs.statSync(abs); } catch { return null; }
  const name = path.basename(rel);
  const note = ((opts.notes || NOTES)[rel.split(path.sep).join('/')]) || null;
  const relp = rel.split(path.sep).join('/');
  if (!st.isDirectory()) return { name, note, dir: false, rel: relp, desc: describe(abs), size: st.size, mtime: st.mtime.toISOString().slice(0, 10) };
  const out = { name, note, dir: true, rel: relp, files: countFiles(abs), mtime: st.mtime.toISOString().slice(0, 10) };
  if (depth >= (opts.max || MAX_DEPTH)) return out;
  let entries = [];
  try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { /* no directory - an empty list */ }
  entries = entries.filter(e => !SKIP.has(e.name) && (!opts.dirs || e.isDirectory()))
    .sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name, 'ru'));
  out.children = entries.slice(0, MAX_CHILDREN).map(e => node(root, path.join(rel, e.name), depth + 1, opts)).filter(Boolean);
  if (entries.length > MAX_CHILDREN) out.more = entries.length - MAX_CHILDREN;
  return out;
}

// Each path's parent kind by PROJECT_KINDS - the "Project" tree is highlighted by them.
function markKinds(n, rel) {
  const it = PROJECT_KINDS.find(k => k.items.some(i => i.p === rel));
  if (it) { n.kind = it.key; const i = it.items.find(x => x.p === rel); if (i.mixed) n.mixed = i.mixed; }
  (n.children || []).forEach(ch => markKinds(ch, rel + '/' + ch.name));
}

// The files where settings are kept. who: human - a human edits it; nodes - the nodes keep it; secret - the values are not shown (prohibition 15).
const SETTINGS_FILES = [
  { p: 'project/config/PROJECT.md', who: 'human', note: '\u044f\u0437\u044b\u043a, \u043f\u043e\u0440\u043e\u0433\u0438, \u044d\u043f\u0438\u043a\u0438, \u043c\u0430\u0440\u0448\u0440\u0443\u0442\u044b, \u0432\u043d\u0435\u0448\u043d\u0438\u0435 \u0441\u0435\u0440\u0432\u0438\u0441\u044b, \u043e\u0441\u043d\u0430\u0441\u0442\u043a\u0430' },
  { p: 'project/config/CONFIG.md', who: 'human', note: '\u0441\u0442\u0440\u0443\u043a\u0442\u0443\u0440\u0430 \u0440\u0430\u0437\u0434\u0435\u043b\u043e\u0432 \u043f\u0440\u043e\u0435\u043a\u0442\u0430 \u0438 \u0434\u043e\u0441\u043a\u0438' },
  { p: 'project/config/ROUTE.md', who: 'human', note: '\u0448\u0430\u0433\u0438 \u043c\u0430\u0440\u0448\u0440\u0443\u0442\u0430 \u0448\u0430\u0431\u043b\u043e\u043d\u0430' },
  { p: 'project/config/SETUP.md', who: 'human', note: '\u043f\u043e\u0440\u044f\u0434\u043e\u043a \u043f\u043e\u0434\u0433\u043e\u0442\u043e\u0432\u043a\u0438 \u043f\u0440\u043e\u0435\u043a\u0442\u0430' },
  { p: 'project/VARS', who: 'human', note: '\u0440\u0435\u0448\u0451\u043d\u043d\u044b\u0435 \u0432\u0435\u043b\u0438\u0447\u0438\u043d\u044b \u0438 \u0434\u043e\u0441\u0442\u0443\u043f\u044b \u043a \u0441\u0430\u0439\u0442\u0443 (credentials.md — \u0441\u0435\u043a\u0440\u0435\u0442\u044b, \u0442\u043e\u043b\u044c\u043a\u043e \u043f\u043e \u0438\u043c\u0435\u043d\u0438)' },
  { p: 'AGENTS.md', who: 'human', note: '\u0437\u0430\u043a\u043e\u043d §1–7, \u043e\u0431\u0449\u0438\u0439 \u0434\u043b\u044f \u0432\u0441\u0435\u0445 \u0434\u0432\u0438\u0436\u043a\u043e\u0432' },
  { p: '.claude/settings.json', who: 'human', note: 'Claude Code: \u043f\u0440\u0430\u0432\u0430, \u0445\u0443\u043a\u0438, \u043c\u043e\u0434\u0435\u043b\u044c' },
  { p: '.claude/hooks', who: 'human', note: '\u0445\u0443\u043a\u0438: \u0441\u0442\u0430\u0440\u0442 \u0441\u0435\u0441\u0441\u0438\u0438, \u0437\u0430\u0449\u0438\u0442\u0430 \u043e\u0442 \u0443\u0434\u0430\u043b\u0435\u043d\u0438\u044f, \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0430 \u043a\u0430\u0440\u0442\u043e\u0447\u0435\u043a' },
  { p: '.mcp.json', who: 'human', note: '\u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u044f MCP-\u0441\u0435\u0440\u0432\u0435\u0440\u043e\u0432' },
  { p: '.env', who: 'secret', note: '\u043a\u043b\u044e\u0447\u0438 \u0438 \u0442\u043e\u043a\u0435\u043d\u044b \u043e\u043a\u0440\u0443\u0436\u0435\u043d\u0438\u044f; \u0432 \u0434\u0430\u0448\u0431\u043e\u0440\u0434\u0435 — \u0442\u043e\u043b\u044c\u043a\u043e \u0438\u043c\u044f \u0444\u0430\u0439\u043b\u0430' },
  { p: '.forma/living/checks.json', who: 'nodes', note: '\u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0438: \u0441 \u043a\u0430\u043a\u043e\u0439 \u0434\u0430\u0442\u044b \u0434\u0435\u0439\u0441\u0442\u0432\u0443\u0435\u0442 \u043a\u0430\u043a\u043e\u0435 \u043f\u0440\u0430\u0432\u0438\u043b\u043e' },
];

function settingsFiles(root) {
  return SETTINGS_FILES.map(f => {
    const n = node(root, f.p, 99, { max: 1 });
    if (!n) return { rel: f.p, name: f.p, who: f.who, note: f.note, exists: false };
    return { rel: f.p, name: f.p, who: f.who, note: f.note, exists: true, dir: n.dir, files: n.files, size: n.size,
      mtime: n.mtime, desc: f.who === 'secret' ? null : n.desc };
  });
}

function buildStructure(root) {
  const { groups: defs, notes } = groupsFor(root);
  const allNotes = { ...NOTES, ...notes };
  const groups = defs.map(g => ({
    key: g.key, title: g.title, note: g.note,
    roots: g.roots.map(r => {
      if (typeof r === 'string') return node(root, r, 1, { notes: allNotes });
      // dirs - the directory's skeleton without working files; max - disclose only to this depth
      return node(root, r.p, 1, { dirs: r.dirs, max: r.max, notes: allNotes });
    }).filter(Boolean),
  }));
  groups.filter(g => g.key === 'project').forEach(g => g.roots.forEach(r => markKinds(r, r.name)));
  return { groups, settingsFiles: settingsFiles(root), projectKinds: projectKinds(root), legend: PROJECT_KINDS.map(k => ({ key: k.key, title: k.title })) };
}

module.exports = { buildStructure, describe };

if (require.main === module) {
  const s = buildStructure(path.resolve(__dirname, '..', '..'));
  for (const k of s.projectKinds) console.log(k.title + ": " + k.items.map(i => i.name + (i.mixed ? logMsg('structure.mixed_marker') : "")).join(", "));
  for (const g of s.groups) console.log(g.title + ': ' + g.roots.map(r => r.name + (r.dir ? ` (${r.files})` : '')).join(', '));
}
