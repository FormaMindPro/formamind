#!/usr/bin/env node
// Questions to the Kit graphs without a model: a node, neighbours, a path, a search, the digest of gaps.
//   node .claude/scripts/graph-query.cjs find <text> [--graph central] [--type card|goal|role|file|...]
//     a resource (type asset) is also searched by description, tags, semantic_tags, class; several words - all must occur; the tags above the description:
//   node .claude/scripts/graph-query.cjs find Passport --type asset      (a word from the description) · find generated --type asset (a class)
//   node .claude/scripts/graph-query.cjs node <id|label> [--graph central]   - a node and its edges by relations
//   node .claude/scripts/graph-query.cjs path <from> <to> [--graph central]  - the shortest path (edges without direction)
//   node .claude/scripts/graph-query.cjs digest                              - the gaps from the central report, a few lines
// The graphs: .forma/living/graphs/<name>/graph.json (central merges the others). No graph - a "no graph" line, exit 1.
// A node's id in central: card:card-NNN, goal:goal-X, epic:<name>, role:<name>, file:<path>, zone:<path>, asset:<sha12>.
//
// Printed labels come from the core dictionary: English key in code, ru value as data.

const fs = require('fs');
const path = require('path');
const i18n = require('../../.forma/i18n/index.cjs');
const msg = (code, params) => i18n.message(code, params, 'ru');

const ROOT = path.resolve(__dirname, '..', '..');
const GRAPHS = path.join(ROOT, '.forma', 'living', 'graphs');
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const pos = [];
for (let i = 0; i < argv.length; i++) { if (argv[i].startsWith('--')) i++; else pos.push(argv[i]); }
const [cmd, ...rest] = pos;

function load(name) {
  const f = path.join(GRAPHS, name, 'graph.json');
  if (!fs.existsSync(f)) { console.error(msg('graph-query.no_graph', { name })); process.exit(1); }
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

const short = n => `${n.id}${n.label && n.label !== n.id ? ' — ' + String(n.label).slice(0, 80) : ''}${n.type ? ' [' + n.type + ']' : ''}`;

function resolve(g, q) {
  const by = new Map(g.nodes.map(n => [n.id, n]));
  if (by.has(q)) return [by.get(q)];
  const low = q.toLowerCase();
  const exactSuffix = g.nodes.filter(n => n.id.toLowerCase().endsWith(':' + low) || String(n.label || '').toLowerCase() === low);
  if (exactSuffix.length) return exactSuffix;
  return g.nodes.filter(n => n.id.toLowerCase().includes(low) || String(n.label || '').toLowerCase().includes(low));
}

function one(g, q) {
  const hits = resolve(g, q);
  if (!hits.length) { console.log(msg('graph-query.not_found', { q })); process.exit(1); }
  if (hits.length > 1) {
    console.log(msg('graph-query.multiple_hits', { count: hits.length }));
    hits.slice(0, 15).forEach(n => console.log('  ' + short(n)));
    process.exit(1);
  }
  return hits[0];
}

function cmdFind() {
  const g = load(flag('graph', 'central')), type = flag('type', '');
  const q = rest.join(' ').toLowerCase();
  if (!q) { console.error(msg('graph-query.usage_find')); process.exit(2); }
  const words = q.split(/\s+/).filter(Boolean);
  const flat = v => (Array.isArray(v) ? v.join(' ') : String(v == null ? '' : v)).toLowerCase();
  const score = n => {
    if (n.type !== 'asset') return 0;
    const tg = flat(n.semantic_tags) + ' ' + flat(n.tags), ds = flat(n.description), cl = flat(n.class), id = (n.id + ' ' + (n.label || '') + ' ' + (n.path || '')).toLowerCase();
    let sc = 0;
    for (const w of words) {
      const k = tg.includes(w) ? 3 : cl.includes(w) ? 2 : ds.includes(w) ? 1 : id.includes(w) ? 1 : 0;
      if (!k) return 0;
      sc += k;
    }
    return sc;
  };
  const hits = g.nodes.filter(n => (!type || n.type === type) && (n.id.toLowerCase().includes(q) || String(n.label || '').toLowerCase().includes(q) || score(n) > 0));
  const sc = new Map(hits.map(n => [n, n.type === 'asset' ? Math.max(score(n), 1) : 0]));
  hits.sort((x, y) => sc.get(y) - sc.get(x));   // stable: the non-resources keep their former order
  console.log(msg('graph-query.nodes_count', { count: hits.length }));
  hits.slice(0, 30).forEach(n => {
    console.log('  ' + short(n));
    if (n.type === 'asset') console.log(msg('graph-query.asset_line', { klass: n.class || '—', card: n.card ? msg('graph-query.card_is') + n.card : (n.card_note || msg('graph-query.no_card')), goal: n.goal ? msg('graph-query.goal_is') + n.goal : '', path: n.path }));
  });
  if (hits.length > 30) console.log(msg('graph-query.more_hits', { count: hits.length - 30 }));
}

function cmdNode() {
  const g = load(flag('graph', 'central')), n = one(g, rest.join(' '));
  console.log(short(n) + (n.file ? ` · ${n.file}` : n.source_file ? ` · ${n.source_file}` : ''));
  const by = new Map(g.nodes.map(x => [x.id, x]));
  const groups = new Map();
  for (const e of g.edges) {
    if (e.source !== n.id && e.target !== n.id) continue;
    const out = e.source === n.id, other = by.get(out ? e.target : e.source);
    if (!other) continue;
    const k = (out ? '→ ' : '← ') + e.relation;
    (groups.get(k) || groups.set(k, []).get(k)).push(other);
  }
  if (!groups.size) console.log(msg('graph-query.no_edges'));
  for (const [k, list] of groups) {
    console.log(`  ${k} (${list.length}):`);
    list.slice(0, 8).forEach(o => console.log('      ' + short(o)));
    if (list.length > 8) console.log(msg('graph-query.more_edges', { count: list.length - 8 }));
  }
}

function cmdPath() {
  const g = load(flag('graph', 'central'));
  if (rest.length < 2) { console.error(msg('graph-query.usage_path')); process.exit(2); }
  const a = one(g, rest[0]), b = one(g, rest[1]);
  const adj = new Map();
  for (const e of g.edges) {
    (adj.get(e.source) || adj.set(e.source, []).get(e.source)).push([e.target, e.relation + ' →']);
    (adj.get(e.target) || adj.set(e.target, []).get(e.target)).push([e.source, '← ' + e.relation]);
  }
  const prev = new Map([[a.id, null]]), queue = [a.id];
  while (queue.length && !prev.has(b.id)) {
    const cur = queue.shift();
    for (const [nx, rel] of adj.get(cur) || []) if (!prev.has(nx)) { prev.set(nx, [cur, rel]); queue.push(nx); }
  }
  if (!prev.has(b.id)) { console.log(msg('graph-query.no_path', { a: a.id, b: b.id })); process.exit(1); }
  const steps = [];
  for (let c = b.id; prev.get(c); c = prev.get(c)[0]) steps.unshift([c, prev.get(c)[1]]);
  const by = new Map(g.nodes.map(x => [x.id, x]));
  console.log(short(a));
  steps.forEach(([id, rel]) => console.log(`  ${rel} ${short(by.get(id))}`));
}

const list = (l, n = 4) => l.length ? `${l.length} (${l.slice(0, n).join(', ')}${l.length > n ? ', …' : ''})` : '0';

function cmdDigest() {
  const f = path.join(GRAPHS, 'central', 'graph.json');
  if (!fs.existsSync(f)) { console.log(msg('graph-query.no_graphs')); return; }
  const g = JSON.parse(fs.readFileSync(f, 'utf8')), r = g.report;
  if (!r) { console.log(msg('graph-query.no_report')); return; }
  const lines = [];
  const add = (label, l) => { if (l.length) lines.push(`- ${label}: ${list(l)}`); };
  add(msg('graph-query.g_cards_without_goal'), r.cards_without_goal);
  add(msg('graph-query.g_cards_without_role'), r.cards_without_role);
  add(msg('graph-query.g_roles_without_cards'), r.roles_without_cards);
  add(msg('graph-query.g_goals_without_cards'), r.goals_without_cards);
  if (r.dropped_edges) lines.push(msg('graph-query.g_dropped_edges', { count: r.dropped_edges, sample: r.dropped_sample && r.dropped_sample.length ? ` (${r.dropped_sample.slice(0, 3).join(', ')})` : '' }));
  if (r.structure) {
    const s = r.structure;
    if (s.cards_with_missing_path) lines.push(msg('graph-query.g_cards_missing_path', { count: s.cards_with_missing_path }));
    if (s.zones_without_readme) lines.push(msg('graph-query.g_zones_without_readme', { count: s.zones_without_readme }));
    if (s.goals_without_zone) lines.push(msg('graph-query.g_goals_without_zone', { count: s.goals_without_zone }));
  }
  if (r.resources) {
    const x = r.resources;
    if (x.without_description) lines.push(msg('graph-query.g_without_description', { count: x.without_description }));
    if (x.without_file) lines.push(msg('graph-query.g_without_file', { count: x.without_file }));
    if (x.without_entry) lines.push(msg('graph-query.g_without_entry', { count: x.without_entry }));
  }
  console.log(msg('graph-query.digest_header', { date: new Date(g.built).toISOString().slice(0, 16).replace('T', ' ') }));
  console.log(lines.length ? lines.join('\n') : msg('graph-query.no_gaps'));
}

({ find: cmdFind, node: cmdNode, path: cmdPath, digest: cmdDigest }[cmd] || (() => {
  console.error(msg('graph-query.usage'));
  process.exit(2);
}))();
