'use strict';

/**
 * The Codex adapter for the Forma core: the "Forma" tab (the nodes' roles from .codex/agents/*.toml).
 * The core finds it by itself - the `forma-adapter.cjs` file in a dotted directory; the object's shape - in the header of `.forma/dashboard/lib/engines.cjs`.
 * The adapter declares no other shape fields: the core substitutes `unknown`.
 */

const { readTomlCatalog, readMdCatalog } = require('../.forma/dashboard/lib/forma-roles.cjs');

module.exports = {
  engine: 'codex',
  formaRoles: (root) => {
    const cat = readTomlCatalog(root, { title: 'Codex', agentsDir: '.codex/agents' });
    const claude = readMdCatalog(root, { title: 'Claude Run profiles', rolesDir: '.claude/agents', mcpFiles: [] });
    cat.runRoles = claude.runRoles;
    cat.runNote = null;
    cat.plugins = null; // the engine has no plugin list for the tab
    return cat;
  },
};
