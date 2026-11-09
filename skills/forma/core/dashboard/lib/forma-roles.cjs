'use strict';

/**
 * The adapters' shared part for the "Forma" tab: reading the nodes' roles and the Run roles' catalog as
 * `{ name, file, model, tier, effort, skills, connectors, toolCount }`.
 * Two formats: markdown with a frontmatter (Claude, Gemini) and toml (Codex). Which to read is the engine
 * adapter's decision; the core (`.forma/dashboard/data/forma.cjs`) sees only the ready snapshot from the
 * adapter's `formaRoles` field (the `engines.cjs` header).
 * Display only: the inventory is not stored, this is a snapshot of the same files.
 */

const fs = require('fs');
const path = require('path');
const { readJson } = require('./fs.cjs');
const { parseFrontmatter } = require('./card.cjs');

const NODE_ORDER = ['Intent', 'Spec', 'Kit', 'Core']; // Run - separately, the roles' catalog

/** The frontmatter's tools; a comma inside Bash(...)/mcp brackets does not cut the list. */
function splitTools(raw) {
  return String(raw || '').split(/,\s*(?![^()]*\))/).map((s) => s.trim()).filter(Boolean);
}

/** The skills' list: empty/`none` -> `[]`. */
function splitSkills(raw) {
  const skills = String(raw || '').trim();
  return !skills || skills.toLowerCase() === 'none' ? [] : skills.split(/,\s*/).filter(Boolean);
}

/** The MCP connectors among the tools: `mcp__<server>__<ability>` -> the server's name. */
function mcpServerNames(tools) {
  const names = new Set();
  for (const t of tools) {
    const parts = t.split('__');
    if (parts[0] === 'mcp' && parts.length >= 3) names.add(parts[1]);
  }
  return [...names];
}

/** A minimal toml parse: top-level string and number values and the `[a.b]` table names. */
function parseToml(text) {
  const top = {};
  const tables = [];
  let inTop = true;
  const lines = String(text || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    const table = line.match(/^\[\[?([^\]]+)\]\]?$/);
    if (table) { inTop = false; tables.push(table[1].trim()); continue; }
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.*)$/);
    if (!kv) continue;
    let [, key, val] = kv;
    if (val.startsWith('"""')) { // a multiline string: skip to the closing one
      if (!(val.length >= 6 && val.endsWith('"""'))) while (++i < lines.length && !lines[i].includes('"""'));
      if (inTop) top[key] = '';
      continue;
    }
    val = val.replace(/\s+#.*$/, '').trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (inTop) top[key] = val;
  }
  return { top, tables };
}

/** The MCP servers' names from `{ file, level }` files: the `mcpServers` keys (json) or the `[mcp_servers.<name>]` tables (toml). */
function configuredServers(files) {
  const byName = new Map();
  for (const { file, level } of files) {
    let names = [];
    if (file.endsWith('.toml')) {
      if (!fs.existsSync(file)) continue;
      names = parseToml(fs.readFileSync(file, 'utf8')).tables
        .map((t) => t.match(/^mcp_servers\.("?)([^."]+)\1/)).filter(Boolean).map((m) => m[2]);
    } else {
      const j = readJson(file);
      names = j && j.mcpServers ? Object.keys(j.mcpServers) : [];
    }
    for (const n of names) if (!byName.has(n)) byName.set(n, level);
  }
  return byName;
}

/** A connector's row: `{ name, level }` - level null when the server was found in no file. */
function connectorRows(tools, configured) {
  return mcpServerNames(tools).sort().map((name) => ({ name, level: configured.get(name) || null }));
}

const rel = (root, file) => path.relative(root, file).split(path.sep).join('/');

/** A role from markdown with a frontmatter; `skillsKey` - the skills' key (`uses` for the nodes, `.forma/skills` for the Run roles). */
function mdRoleRow(root, file, { name, skillsKey, configured }) {
  const fm = parseFrontmatter(fs.readFileSync(file, 'utf8'));
  const tools = splitTools(fm.tools);
  return {
    name: name || fm.name || path.basename(file, '.md'),
    file: rel(root, file),
    model: fm.model || null,
    tier: fm.tier || null,
    effort: fm.effort || null,
    skills: fm[skillsKey] === undefined ? null : splitSkills(fm[skillsKey]),
    connectors: connectorRows(tools, configured),
    toolCount: tools.length,
  };
}

/** A role from the Codex engine's toml: the model, effort - `model_reasoning_effort`. No skills or tools in the file. */
function tomlRoleRow(root, file, name) {
  const { top } = parseToml(fs.readFileSync(file, 'utf8'));
  return {
    name: name || top.name || path.basename(file, '.toml'),
    file: rel(root, file),
    model: top.model || null,
    tier: null,
    effort: top.model_reasoning_effort || null,
    skills: null,
    connectors: [],
    toolCount: 0,
  };
}

/**
 * A snapshot over a markdown roles' directory: the nodes `<rolesDir>/<node>.md`, the Run roles `<rolesDir>/run/*.md`.
 * `mcpFiles` - `[{ file, level }]`. The result is the shape of the `formaRoles` field.
 */
function readMdCatalog(root, { title, rolesDir, mcpFiles }) {
  const dir = path.join(root, ...rolesDir.split('/'));
  if (!fs.existsSync(dir)) return { title, nodes: [], runRoles: [], runNote: null, rolesMissing: true };
  const configured = configuredServers(mcpFiles || []);
  const nodes = NODE_ORDER.map((label) => {
    const file = path.join(dir, `${label.toLowerCase()}.md`);
    return fs.existsSync(file) ? mdRoleRow(root, file, { name: label, skillsKey: 'uses', configured }) : null;
  }).filter(Boolean);
  const runDir = path.join(dir, 'run');
  const runExists = fs.existsSync(runDir);
  const runRoles = runExists
    ? fs.readdirSync(runDir).filter((f) => f.endsWith('.md')).sort()
      .map((f) => mdRoleRow(root, path.join(runDir, f), { name: null, skillsKey: '.forma/skills', configured }))
    : [];
  return { title, nodes, runRoles, runNote: runExists ? null : { key: 'fm.runNote.noDir', vars: { dir: rolesDir } }, rolesMissing: false };
}

/**
 * A snapshot over a toml roles' directory (Codex): the five nodes and `run` - the files `<agentsDir>/<node>.toml`.
 * The engine has no Run roles' catalog - a single `run` row and an explicit mark in `runNote`.
 */
function readTomlCatalog(root, { title, agentsDir }) {
  const dir = path.join(root, ...agentsDir.split('/'));
  if (!fs.existsSync(dir)) return { title, nodes: [], runRoles: [], runNote: null, rolesMissing: true };
  const row = (label) => {
    const file = path.join(dir, `${label.toLowerCase()}.toml`);
    return fs.existsSync(file) ? tomlRoleRow(root, file, label) : null;
  };
  const run = row('Run');
  return {
    title,
    nodes: NODE_ORDER.map(row).filter(Boolean),
    runRoles: run ? [{ ...run, name: 'run' }] : [],
    runNote: { key: 'fm.runNote.single' },
    rolesMissing: false,
  };
}

module.exports = {
  NODE_ORDER, splitTools, splitSkills, mcpServerNames, parseToml, configuredServers, connectorRows,
  mdRoleRow, tomlRoleRow, readMdCatalog, readTomlCatalog,
};
