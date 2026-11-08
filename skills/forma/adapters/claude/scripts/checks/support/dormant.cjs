'use strict';

// Sleeping engines: the `.forma/engines.json` registry (`{ "dormant": ["codex"] }`). A sleeping engine stays in
// the project as is, but is neither reconciled nor rebuilt; waking it - remove it from the list and run the engine's reconcile-rebuild.
// No file, or an unreadable one - no sleeping engines.

const fs = require('fs');
const path = require('path');

function dormantEngines(root) {
  try {
    const list = JSON.parse(fs.readFileSync(path.join(root, '.forma', 'engines.json'), 'utf8')).dormant;
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

const isDormant = (root, id) => dormantEngines(root).includes(id);

module.exports = { dormantEngines, isDormant };
