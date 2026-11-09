'use strict';

/**
 * The "Law" tab: AGENTS.md, the engine's §8, roles, routes, the project, checks - as text, the way the files hold it.
 * The engine's paths (roles, the rules file, the verification script) are named by the adapter through `lib/engines.cjs`; no adapter -
 * empty text and empty lists, not an error.
 */

const fs = require('fs');
const path = require('path');
const { readIfExists, projectFile } = require('../lib/fs.cjs');
const { parseFlatFrontmatter } = require('../lib/card.cjs');
const engines = require('../lib/engines.cjs');

/** Roles from catalog `dir` (relative to the root): name, description, model, effort, tools, body. */
function readRoles(projectRoot, dir) {
  if (!dir || !fs.existsSync(path.join(projectRoot, dir))) return [];
  return fs.readdirSync(path.join(projectRoot, dir)).filter((f) => f.endsWith('.md')).map((f) => {
    const text = readIfExists(path.join(projectRoot, path.join(dir, f)));
    const [o, body] = parseFlatFrontmatter(text.replace(/\r/g, ''));
    return {
      file: dir + '/' + f, name: o.name || f.replace(/\.md$/, ''), desc: o.description || '',
      model: o.model || '', effort: o.effort || '', tools: o.tools || '', body,
    };
  });
}

/** The text of the file the adapter names by field `field`; no adapter or field - an empty string. */
function readEngineFile(projectRoot, field) {
  const rel = engines.first(projectRoot, field);
  return rel ? readIfExists(path.join(projectRoot, rel)) : '';
}

function buildLaw(projectRoot) {
  const rd = (f) => readIfExists(path.join(projectRoot, f));
  const syncScript = readEngineFile(projectRoot, 'syncScript');
  return {
    agents: rd('AGENTS.md'),
    engine: readEngineFile(projectRoot, 'engineRulesFile'),
    project: readIfExists(projectFile(projectRoot, 'PROJECT.md')),
    routes: rd('.forma/manual/ru/03-protocol/ROUTES.md'),
    protocol: rd('.forma/manual/ru/03-protocol/PROTOCOL.md'),
    roles: readRoles(projectRoot, engines.first(projectRoot, 'rolesDir')),
    onDemand: readRoles(projectRoot, engines.first(projectRoot, 'onDemandRolesDir')),
    checkDates: JSON.parse(rd('.forma/living/checks.json') || '{}'),
    checks: [...syncScript.matchAll(/^\/\/ --- (.+?) -*$/gm)].map((m) => m[1].trim()),
  };
}

module.exports = { buildLaw };
