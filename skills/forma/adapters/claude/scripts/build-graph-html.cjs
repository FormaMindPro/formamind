#!/usr/bin/env node
// Rendering .forma/living/graphs/<corpus>/graph.html from the already-built graph.json for the Kit graphs
// (goals, arsenal, structure, resources, board, central). The same graphify.to_html step as for
// engine and site - no model, no network: a Python renderer.
//
//   node .claude/scripts/build-graph-html.cjs            # all six
//   node .claude/scripts/build-graph-html.cjs goals board
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
// Printed labels come from the core dictionary: English key in code, ru value as data.
const i18n = require('../../.forma/i18n/index.cjs');
const msg = (code, params) => i18n.message(code, params, 'ru');

const ROOT = path.resolve(__dirname, '..', '..');
const GRAPHS = path.join(ROOT, '.forma/living', 'graphs');
const CORPORA = ['goals', 'arsenal', 'structure', 'resources', 'board', 'manual', 'project', 'central'];

function toExtraction(g, corpus) {
  return {
    nodes: g.nodes.map((n) => ({
      id: n.id,
      label: n.label || n.id,
      file_type: 'concept',
      source_file: n.source_file || n.id,
      node_type: n.type || '',
    })),
    edges: g.edges.map((e) => ({
      source: e.source,
      target: e.target,
      relation: e.relation,
      confidence: 'EXTRACTED',
      source_file: e.source_file || `${corpus}:main`,
    })),
  };
}

const PY = `
import json, sys
from collections import Counter
from pathlib import Path
from graphify.build import build_from_json
from graphify.cluster import cluster
from graphify.export import to_html

out_dir = Path(sys.argv[1])
extraction = json.loads((out_dir / ".graphify_extract.json").read_text(encoding="utf-8"))
types = {n["id"]: n.get("node_type", "") for n in extraction["nodes"]}
G = build_from_json(extraction)
if G.number_of_nodes() == 0:
    print("ERROR: Graph is empty")
    raise SystemExit(1)
communities = cluster(G)
labels = {}
for cid, members in communities.items():
    top = Counter(types.get(m, "") for m in members).most_common(1)
    labels[cid] = f"\u0413\u0440\u0443\u043f\u043f\u0430 {cid}: {top[0][0]}" if top and top[0][0] else f"\u0413\u0440\u0443\u043f\u043f\u0430 {cid}"  # "Group {cid}" in ru, escapes
to_html(G, communities, str(out_dir / "graph.html"), community_labels=labels)
print(f"Graph: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges, {len(communities)} communities")
`;

function render(corpus, tmpPy) {
  const dir = path.join(GRAPHS, corpus);
  const file = path.join(dir, 'graph.json');
  if (!fs.existsSync(file)) throw new Error(msg('graph-html.missing_graph', { file, corpus }));
  const extract = path.join(dir, '.graphify_extract.json');
  fs.writeFileSync(extract, JSON.stringify(toExtraction(JSON.parse(fs.readFileSync(file, 'utf8')), corpus)), 'utf8');
  try {
    return execFileSync('python', [tmpPy, dir], { encoding: 'utf8' }).trim();
  } finally {
    fs.existsSync(extract) && fs.unlinkSync(extract);
  }
}

function main(argv = process.argv.slice(2)) {
  const wanted = argv;
  const list = wanted.length ? wanted : CORPORA;
  const bad = list.filter((c) => !CORPORA.includes(c));
  if (bad.length) throw new Error(msg('graph-html.unknown_corpus', { bad: bad.join(', '), corpora: CORPORA.join(', ') }));
  const tmpPy = path.join(os.tmpdir(), `kit-graph-html-${process.pid}.py`);
  fs.writeFileSync(tmpPy, PY, 'utf8');
  try {
    // one corpus failed (e.g. an empty graph) - the rest are still drawn
    for (const c of list) {
      try { console.log(`${c}: ${render(c, tmpPy)}`); }
      catch (err) { console.log(msg('graph-html.not_built', { corpus: c, error: String(err && err.message || err).split('\n')[0] })); }
    }
  } finally {
    fs.unlinkSync(tmpPy);
  }
}

if (require.main === module) {
  try { main(); } catch (err) { console.error(String(err && err.message || err)); process.exit(2); }
}

module.exports = { toExtraction, main, CORPORA };
