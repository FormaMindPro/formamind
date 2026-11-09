'use strict';

/**
 * The five nodes and their rig per engine - model, effort (from the adapter's `nodeModels`), the tool count and access
 * to the external model (from the role file's frontmatter in the same adapter's role catalog). The row carries `engine`.
 * An engine without `nodeModels` yields one empty row (`empty: true`) - an empty group, not a fall.
 * No engine name is ever compared: the list of engines is the list of adapters (.forma/manual/en/03-protocol/SCHEME.md).
 */

const fs = require('fs');
const path = require('path');
const { parseFrontmatter } = require('../lib/card.cjs');
const engines = require('../lib/engines.cjs');

/** The order of nodes in the tables. */
const NODE_ORDER = ['Intent', 'Spec', 'Kit', 'Run', 'Core'];

/** A role's tools: `{ toolCount, externalModel }`; no catalog or file - 0 and false. */
function toolsOf(rolesDir, label) {
  const file = rolesDir ? path.join(rolesDir, `${label.toLowerCase()}.md`) : null;
  if (!file || !fs.existsSync(file)) return { toolCount: 0, externalModel: false };
  const fm = parseFrontmatter(fs.readFileSync(file, 'utf8'));
  const tools = (fm.tools || '').split(',').map((s) => s.trim()).filter(Boolean);
  return { toolCount: tools.length, externalModel: tools.some((t) => /external-model-bridge/i.test(t)) };
}

const emptyRow = (engine) => ({ engine, node: null, model: null, effort: null, toolCount: 0, externalModel: false, empty: true });

/** The rig of the five nodes across all adapters; no adapters - empty. */
function readNodeConfig(projectRoot) {
  const tables = engines.nodeModelTables(projectRoot);
  const rows = [];
  for (const t of tables) {
    const rolesDir = t.rolesDir ? engines.resolveRel(projectRoot, t.rolesDir) : null;
    for (const label of NODE_ORDER) {
      const m = t.nodeModels[label];
      if (!m) continue;
      rows.push({ engine: t.tag, node: label, model: m.model || null, effort: m.effort || null, ...toolsOf(rolesDir, label) });
    }
  }
  for (const e of engines.engineTags(projectRoot)) {
    if (!tables.some((t) => e.aliases.includes(t.tag))) rows.push(emptyRow(e.tag));
  }
  return rows;
}

module.exports = { NODE_ORDER, readNodeConfig };
