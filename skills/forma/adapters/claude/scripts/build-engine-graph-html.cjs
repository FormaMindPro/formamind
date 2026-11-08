#!/usr/bin/env node
// Rendering .forma/living/graphs/engine/graph.html from the already-built graph.json (the skeleton). The same graphify.to_html step as for site (build-site-graph.cjs) -
// no model, no network: a Python renderer, called after build-engine-graph.cjs.
//
// Printed labels come from the core dictionary: English key in code, ru value as data.
//
//   node .claude/scripts/build-engine-graph-html.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const i18n = require('../../.forma/i18n/index.cjs');
const msg = (code, params) => i18n.message(code, params, 'ru');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(ROOT, '.forma/living', 'graphs', 'engine');
const GRAPH_FILE = path.join(OUT_DIR, 'graph.json');

function toExtraction(g) {
  return {
    nodes: g.nodes.map((n) => ({
      id: n.id,
      label: n.label || n.id,
      file_type: n.type === 'file' ? 'concept' : 'concept',
      source_file: n.source_file || n.id,
    })),
    edges: g.edges.map((e) => ({
      source: e.source,
      target: e.target,
      relation: e.relation,
      confidence: 'EXTRACTED',
      source_file: 'engine:main',
    })),
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
labels = {cid: f"\u0413\u0440\u0443\u043f\u043f\u0430: \u043a\u043b\u0430\u0441\u0442\u0435\u0440 {cid}" for cid in communities}  # "Group: cluster {cid}" in ru, escapes
to_html(G, communities, str(out_dir / "graph.html"), community_labels=labels)
print(f"Graph: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges, {len(communities)} communities")
`;
}

function main() {
  if (!fs.existsSync(GRAPH_FILE)) {
    console.error(msg('engine-graph-html.missing_graph', { file: GRAPH_FILE }));
    process.exit(1);
  }
  const g = JSON.parse(fs.readFileSync(GRAPH_FILE, 'utf8'));
  const extractPath = path.join(OUT_DIR, '.graphify_extract.json');
  fs.writeFileSync(extractPath, JSON.stringify(toExtraction(g)), 'utf8');
  const tmpPy = path.join(os.tmpdir(), `engine-graph-html-${process.pid}.py`);
  fs.writeFileSync(tmpPy, graphPythonScript(), 'utf8');
  let out;
  try {
    out = execFileSync('python', [tmpPy], { encoding: 'utf8' });
  } finally {
    fs.unlinkSync(tmpPy);
    fs.existsSync(extractPath) && fs.unlinkSync(extractPath);
  }
  console.log(out.trim());
  console.log(msg('engine-graph-html.written', { file: path.join(OUT_DIR, 'graph.html') }));
}

if (require.main === module) {
  try { main(); } catch (err) { console.error(String(err && err.message || err)); process.exit(2); }
}

module.exports = { toExtraction };
