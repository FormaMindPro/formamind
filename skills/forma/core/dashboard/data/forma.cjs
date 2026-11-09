'use strict';

/**
 * The "Form" tab: a tab per installed engine - the node's card and the Run role's card
 * (model, tier, effort, skills, connectors, plugins). "Installed" = the root has a dotted directory
 * and a `forma-adapter.cjs` with a `formaRoles` field (the header of `.forma/dashboard/lib/engines.cjs`). The core knows neither the names
 * of engines nor their file formats: the adapter assembles the role slice (the common parsers - `lib/forma-roles.cjs`).
 * An adapter whose `formaRoles` threw is skipped - the other tabs live on.
 * Display only: the inventory is not stored separately, it is a slice of the same files (kit.md, "Arsenal").
 */

const engines = require('../lib/engines.cjs');

function readEngineTab(adapter, projectRoot) {
  let cat;
  try { cat = adapter.formaRoles(projectRoot); } catch { return null; }
  if (!cat || typeof cat !== 'object') return null;
  return {
    engine: adapter.engine || engines.UNKNOWN,
    dir: adapter.dir,
    title: cat.title || adapter.engine || adapter.dir,
    nodes: cat.nodes || [],
    runRoles: cat.runRoles || [],
    runNote: cat.runNote || null,
    rolesMissing: !!cat.rolesMissing,
    plugins: cat.plugins || null,
  };
}

/** The "Form" tab's slice: `{ engines: [{ engine, dir, title, nodes, runRoles, runNote, rolesMissing, plugins }] }`. */
function readFormaCatalog(projectRoot) {
  const tabs = engines.loadAdapters(projectRoot)
    .filter((a) => typeof a.formaRoles === 'function')
    .map((a) => readEngineTab(a, projectRoot))
    .filter(Boolean); // the order - by the adapter directory's name (`loadAdapters`), no engine stands first by name
  return { engines: tabs };
}

module.exports = { readFormaCatalog };
