'use strict';
// Paths engine-to-protocol.cjs never transfers - not by --apply, not by --add, not by landing in MAP:
// the product zones (project/, .devtool/, .forma/living/ - the history and content of a concrete project)
// and the entries of .claude/project-layer.txt (layer 4 - the engine's own files, not portable).
const fs = require('fs');
const path = require('path');

const FORBIDDEN_PREFIX = ['project/', '.devtool/', '.forma/living/'];

/** The set of paths (a file or a directory - covers everything inside) of the project `root`'s .claude/project-layer.txt. */
function readOwnLayer(root) {
  const layerFile = path.join(root, '.claude', 'project-layer.txt');
  return new Set(fs.existsSync(layerFile)
    ? fs.readFileSync(layerFile, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    : []);
}

/** `rel` - a path from the project root, with "/". `true` - transferring into the protocol is forbidden. */
function isForbiddenTransfer(rel, ownLayer) {
  if (FORBIDDEN_PREFIX.some((p) => rel === p.slice(0, -1) || rel.startsWith(p))) return true;
  for (const o of ownLayer) if (rel === o || rel.startsWith(o + '/')) return true;
  return false;
}

module.exports = { FORBIDDEN_PREFIX, readOwnLayer, isForbiddenTransfer };
