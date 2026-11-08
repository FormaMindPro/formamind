// The site graph: the map of the pages, sections and content of the remote site.
//
// The snapshot - one read-only `novamira/execute-php` call through `.claude/scripts/site-php.cjs`
// (no --write: writing calls are absent from the PHP code below and would be rejected by
// site-php.cjs itself). The site does not change. The sections/widgets parsing - by regexes, no model.
//
//   node .claude/scripts/build-site-graph.cjs
//
// Output: .forma/living/graphs/site/graph.json (the graphify format: {nodes, edges}), a cache by the
// content hash of each entity - .forma/living/graphs/site/.cache.json. An unchanged entity is not
// rebuilt; a changed one is parsed anew.
//
// Printed labels come from the core dictionary: English key in code, ru value as data.

'use strict';
// Printed labels come from the core dictionary: English key in code, ru value as data.
const i18n = require('../../.forma/i18n/index.cjs');
const msg = (code, params) => i18n.message(code, params, 'ru');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync, execFileSync } = require('child_process');
const { readJson, walk } = require('../../.forma/dashboard/lib/fs.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(ROOT, '.forma/living', 'graphs', 'site');
const GRAPH_FILE = path.join(OUT_DIR, 'graph.json');
const CACHE_FILE = path.join(OUT_DIR, '.cache.json');
const BOARD_DIR = path.join(ROOT, '.devtool', 'features');
const PROJECT_DIR = path.join(ROOT, 'project');
const LOG_FILE = path.join(ROOT, '.forma/dashboard', 'graphify.log');

const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');
const hash = (s) => crypto.createHash('sha1').update(s).digest('hex');
const stripTags = (s) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

// An ID mentioned in a card's or a project file's text: "ID 19", "id: 76", "id=3".
const ID_RE = /\bID\s*[:=]?\s*(\d{1,6})\b/gi;
const CTA_RE = /class="[^"]*(?:\bcta\b|\bbtn\b|button)[^"]*"/i;

// --- the site snapshot: one read-only PHP call -------------------------------------

const SNAPSHOT_PHP = `<?php
global $wpdb;
function rows_with_content($types) {
  global $wpdb;
  if (empty($types)) return [];
  $in = "'" . implode("','", array_map('esc_sql', $types)) . "'";
  $rows = $wpdb->get_results("SELECT ID, post_title, post_name, post_status, post_type, post_parent, post_modified_gmt, post_content FROM {$wpdb->posts} WHERE post_type IN ($in) AND post_status IN ('publish','private') ORDER BY ID", ARRAY_A);
  foreach ($rows as &$r) {
    $r['url'] = get_permalink($r['ID']);
    $r['template'] = get_page_template_slug($r['ID']);
  }
  return $rows;
}
$core_types = ['page','post','wp_template','wp_template_part','wp_navigation'];
$all_types = $wpdb->get_col("SELECT DISTINCT post_type FROM {$wpdb->posts} WHERE post_status IN ('publish','private')");
$cpt_types = array_values(array_diff($all_types, array_merge($core_types, ['wp_global_styles','attachment'])));
$content = [];
foreach (array_merge($core_types, $cpt_types) as $t) { $content[$t] = rows_with_content([$t]); }
$media = $wpdb->get_results("SELECT ID, post_title, post_name, post_mime_type, post_parent, guid FROM {$wpdb->posts} WHERE post_type='attachment' ORDER BY ID", ARRAY_A);
return [
  'site' => ['url' => home_url(), 'name' => get_bloginfo('name'), 'front_page_id' => (int) get_option('page_on_front'), 'show_on_front' => get_option('show_on_front')],
  'core_types' => $core_types,
  'cpt_types' => $cpt_types,
  'content' => $content,
  'media' => $media,
];
`;

function snapshot() {
  const tmpPhp = path.join(os.tmpdir(), `site-graph-${process.pid}.php`);
  const tmpReport = path.join(os.tmpdir(), `site-graph-${process.pid}-report.json`);
  fs.writeFileSync(tmpPhp, SNAPSHOT_PHP, 'utf8');
  let report = null, summaryLine = '';
  try {
    const r = spawnSync(process.execPath, [path.join(ROOT, '.claude', 'scripts', 'site-php.cjs'), tmpPhp, '--report', tmpReport],
      { encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 64 * 1024 * 1024 });
    summaryLine = (r.stdout || '').trim().split('\n').filter(Boolean).pop() || '';
    report = readJson(tmpReport, null);
  } finally {
    fs.existsSync(tmpPhp) && fs.unlinkSync(tmpPhp);
    fs.existsSync(tmpReport) && fs.unlinkSync(tmpReport);
  }
  let summary = {};
  try { summary = JSON.parse(summaryLine); } catch { /* no summary - a stop by report below */ }
  if (!report || !report.cli || report.cli.ok === false || summary.status === 'stop') {
    throw new Error(msg('site-graph.no_snapshot', { summary: JSON.stringify(summary || {}), error: JSON.stringify(report && report.cli && report.cli.error || {}) }));
  }
  const rv = report.cli.data && report.cli.data.return_value;
  if (!rv) throw new Error(msg('site-graph.empty_snapshot', { data: JSON.stringify(report.cli.data || {}) }));
  return rv;
}

// --- parsing the content: the sections and the key widgets, no model ---------------------

function splitSections(html) {
  const openings = [...html.matchAll(/<section\b[^>]*\bid="([^"]+)"[^>]*>/g)];
  if (!openings.length) return [{ id: 'content', label: msg('site-graph.all_content_label'), html }];
  return openings.map((m, i) => ({
    id: m[1], label: m[1],
    html: html.slice(m.index, i + 1 < openings.length ? openings[i + 1].index : html.length),
  }));
}

function extractWidgets(html) {
  const widgets = [];
  for (const m of html.matchAll(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const text = stripTags(m[2]).slice(0, 120);
    if (text) widgets.push({ kind: 'heading', text, level: Number(m[1]) });
  }
  for (const m of html.matchAll(/<a\s+([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = m[1], text = stripTags(m[2]).slice(0, 80);
    const href = (attrs.match(/href="([^"]*)"/i) || [])[1] || '';
    if (!text || href === '#main') continue;
    widgets.push({ kind: CTA_RE.test(attrs) ? 'cta' : 'link', text, href });
  }
  return widgets.slice(0, 40);
}

function typeLabel(postType) {
  return { page: 'page', post: 'post', wp_template: 'template', wp_template_part: 'template_part', wp_navigation: 'menu' }[postType] || 'cpt';
}

// --- the index of an entity's ID mentions in the cards / project files ---------------

function indexMentions(files, cardLike, entityIds) {
  const idx = new Map();
  for (const f of files) {
    let text;
    try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const label = cardLike ? (path.basename(f).match(/^(card-\d+)/) || [])[1] : 'file:' + rel(f);
    if (!label) continue;
    const seen = new Set();
    for (const m of text.matchAll(ID_RE)) {
      const n = m[1];
      if (!entityIds.has(n) || seen.has(n)) continue;
      seen.add(n);
      (idx.get(n) || idx.set(n, []).get(n)).push(label);
    }
  }
  return idx;
}

// --- building the graph ----------------------------------------------------------------

// The pages, the posts and their sections/widgets; the sections cache by the content hash is updated in place.
function addContent(snap, cache, addNode, edges) {
  const templatePartByName = new Map();
  let hit = 0, miss = 0, pageCount = 0;
  const alive = new Set();

  for (const type of [...snap.core_types, ...snap.cpt_types]) {
    for (const row of snap.content[type] || []) {
      if (type === 'page') pageCount++;
      const id = 'site-page:' + row.ID;
      alive.add(String(row.ID));
      const h = hash((row.post_content || '') + '|' + (row.template || '') + '|' + row.post_title);
      let part = cache[row.ID];
      if (part && part.hash === h) hit++;
      else { part = { hash: h, sections: splitSections(row.post_content || '') }; cache[row.ID] = part; miss++; }

      addNode({
        id, label: row.post_title || row.post_name, type: typeLabel(type), post_type: type,
        slug: row.post_name, status: row.post_status, url: row.url, template: row.template || null,
      });
      edges.push({ source: 'site:main', target: id, relation: 'contains' });
      if (type === 'wp_template_part') templatePartByName.set(row.post_name, id);

      if (row.template) {
        const tId = 'theme-template:' + row.template;
        addNode({ id: tId, label: row.template, type: 'theme_template' });
        edges.push({ source: id, target: tId, relation: 'uses_template' });
      }

      part.sections.forEach((sec) => {
        const secId = id + ':section:' + sec.id;
        addNode({ id: secId, label: sec.label, type: 'section' });
        edges.push({ source: id, target: secId, relation: 'contains' });
        extractWidgets(sec.html).forEach((w, i) => {
          const wId = secId + ':widget:' + i;
          addNode({ id: wId, label: w.text, type: w.kind, href: w.href || null });
          edges.push({ source: secId, target: wId, relation: 'contains' });
        });
      });
    }
  }
  for (const id of Object.keys(cache)) if (!alive.has(String(id))) delete cache[id]; // a deleted entity leaves the cache
  return { templatePartByName, alive, hit, miss, pageCount };
}

function buildGraph(snap, cardIndex, projectIndex, cache) {
  const nodes = new Map(), edges = [];
  const addNode = (n) => nodes.set(n.id, { ...nodes.get(n.id), ...n });
  addNode({ id: 'site:main', label: snap.site.name || snap.site.url, type: 'site', url: snap.site.url });
  const { templatePartByName, alive, hit, miss, pageCount } = addContent(snap, cache, addNode, edges);

  // front-page: the wp_template "front-page" serves page_on_front, pulls the template parts
  if (snap.site.show_on_front === 'page' && snap.site.front_page_id) {
    const frontTpl = (snap.content.wp_template || []).find((t) => t.post_name === 'front-page');
    if (frontTpl) {
      edges.push({ source: 'site-page:' + snap.site.front_page_id, target: 'site-page:' + frontTpl.ID, relation: 'uses_template' });
      for (const m of (frontTpl.post_content || '').matchAll(/wp:template-part\s*\{"slug":"([^"]+)"/g)) {
        const partId = templatePartByName.get(m[1]);
        if (partId) edges.push({ source: 'site-page:' + frontTpl.ID, target: partId, relation: 'uses_template' });
      }
    }
  }

  for (const m of snap.media) {
    const id = 'site-media:' + m.ID;
    addNode({ id, label: m.post_title || m.post_name, type: 'media', mime: m.post_mime_type });
    if (m.post_parent && m.post_parent !== '0' && alive.has(String(m.post_parent))) {
      edges.push({ source: 'site-page:' + m.post_parent, target: id, relation: 'uses_media' });
    }
  }

  let madeEdges = 0;
  for (const [entId, cards] of cardIndex) {
    for (const cid of cards) {
      addNode({ id: cid, label: cid, type: 'card' });
      edges.push({ source: cid, target: 'site-page:' + entId, relation: 'made' });
      madeEdges++;
    }
  }
  for (const [entId, files] of projectIndex) {
    for (const fid of files) {
      addNode({ id: fid, label: fid, type: 'file' });
      edges.push({ source: 'site-page:' + entId, target: fid, relation: 'described_in' });
    }
  }

  return { nodes: [...nodes.values()], edges, hit, miss, pageCount, madeEdges };
}

// --- rendering graph.html: the same graphify to_html as the other corpora, no model ----

// The minimal field set graphify.validate requires (file_type/source_file on a node,
// relation/confidence/source_file on an edge) - this is not an LLM extraction, so confidence
// is always EXTRACTED (the link is visible in the site snapshot outright, not inferred).
function toExtraction(nodes, edges) {
  return {
    nodes: nodes.map((n) => ({ id: n.id, label: n.label || n.id, file_type: 'concept', source_file: n.url || ('site:' + n.id) })),
    edges: edges.map((e) => ({ source: e.source, target: e.target, relation: e.relation, confidence: 'EXTRACTED', source_file: 'site:main' })),
  };
}

function graphPythonScript() {
  return `
import json
from pathlib import Path
from graphify.build import build_from_json
from graphify.cluster import cluster
from graphify.export import to_html

out_dir = Path(r"${OUT_DIR.replace(/\\/g, '\\\\')}")
extraction = json.loads((out_dir / ".graphify_extract.json").read_text(encoding="utf-8"))
G = build_from_json(extraction)
if G.number_of_nodes() == 0:
    print("ERROR: Graph is empty")
    raise SystemExit(1)
communities = cluster(G)
labels = {cid: f"\u0420\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442: \u043a\u043b\u0430\u0441\u0442\u0435\u0440 {cid}" for cid in communities}  # "Result: cluster {cid}" in ru, escapes
to_html(G, communities, str(out_dir / "graph.html"), community_labels=labels)
print(f"Graph: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges, {len(communities)} communities")
`;
}

// Builds .forma/living/graphs/site/graph.html (the graphify Python step) from the already-built nodes/edges.
// Returns {nodesCount, edgesCount, communitiesCount} - for the line in graphify.log.
function buildHtml(nodes, edges) {
  const extractPath = path.join(OUT_DIR, '.graphify_extract.json');
  fs.writeFileSync(extractPath, JSON.stringify(toExtraction(nodes, edges)), 'utf8');
  const tmpPy = path.join(os.tmpdir(), `site-graph-build-${process.pid}.py`);
  fs.writeFileSync(tmpPy, graphPythonScript(), 'utf8');
  let out;
  try {
    out = execFileSync('python', [tmpPy], { encoding: 'utf8' });
  } finally {
    fs.unlinkSync(tmpPy);
    fs.existsSync(extractPath) && fs.unlinkSync(extractPath);
  }
  const m = /Graph:\s*(\d+)\s*nodes,\s*(\d+)\s*edges,\s*(\d+)\s*communities/.exec(out);
  if (!m) throw new Error(msg('site-graph.python_output_unparsed', { out }));
  return { nodesCount: Number(m[1]), edgesCount: Number(m[2]), communitiesCount: Number(m[3]) };
}

// A line into .forma/dashboard/graphify.log - the graphify.log format, corpus=site.
function appendBuildLog(g, html) {
  const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const line = `${ts} | mode=deterministic-site | agents=0 | tokens=0 | $0.000000 | corpus=site | trigger=manual | ` +
    `nodes=${html.nodesCount} | edges=${html.edgesCount} | communities=${html.communitiesCount} | warnings=0 | ` +
    msg('site-graph.log_line', { pages: g.pageCount, hit: g.hit, miss: g.miss, made: g.madeEdges }) + '\n';
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.appendFileSync(LOG_FILE, line, 'utf8');
}

// --- the run ------------------------------------------------------------------------

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const cache = readJson(CACHE_FILE, {});
  const snap = snapshot();

  const entityIds = new Set();
  for (const type of [...snap.core_types, ...snap.cpt_types]) {
    for (const row of snap.content[type] || []) entityIds.add(String(row.ID));
  }

  const boardFiles = walk(BOARD_DIR, { ext: '.md', abs: true, tolerant: true });
  const projectFiles = walk(PROJECT_DIR, { ext: '.md', abs: true, tolerant: true });
  const cardIndex = indexMentions(boardFiles, true, entityIds);
  const projectIndex = indexMentions(projectFiles, false, entityIds);

  const g = buildGraph(snap, cardIndex, projectIndex, cache);
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
  fs.writeFileSync(GRAPH_FILE, JSON.stringify({
    built: new Date().toISOString(), extractor: 'deterministic', model_tokens: 0,
    source: 'novamira-read-only-snapshot',
    nodes: g.nodes, edges: g.edges,
  }, null, 1));

  console.log(msg('site-graph.summary', { nodes: g.nodes.length, edges: g.edges.length, pages: g.pageCount, hit: g.hit, miss: g.miss, made: g.madeEdges }));

  console.log(msg('site-graph.building_html'));
  const html = buildHtml(g.nodes, g.edges);
  appendBuildLog(g, html);
  console.log(msg('site-graph.done_line', { nodes: html.nodesCount, edges: html.edgesCount, communities: html.communitiesCount, log: LOG_FILE }));
}

if (require.main === module) {
  try { main(); } catch (err) { console.error(String(err && err.message || err)); process.exit(2); }
}

module.exports = { splitSections, extractWidgets, buildGraph };
