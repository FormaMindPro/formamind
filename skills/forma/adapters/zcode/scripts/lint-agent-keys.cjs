#!/usr/bin/env node
'use strict';

/**
 * lint-agent-keys.cjs - a lint of the zone's agent files' frontmatter keys: a closed list, a typo - an error.
 *
 *   node .zcode/scripts/lint-agent-keys.cjs [directory]
 *
 * The default directory - this zone's agents, recursively (the root, run/, on-demand/). The frontmatter keys
 * are checked against the closed list, collated with the zone's real files: name, description, model, effort,
 * tier, uses, tools. An unknown (a typoed one included) key - an error with the file's address and the name
 * of the key, exit 1, not silence. A file without a frontmatter block - also an error: to skip it silently means
 * to leave the same hole on fail-open. A clean set - exit 0.
 *
 * Exit: 0 - no violations (the number of the reviewed files is printed); 1 - a line per each violation;
 * 2 - the directory is not found.
 */

const fs = require('fs');
const path = require('path');
const i18n = require([path.resolve(__dirname, '../../.forma/i18n/index.cjs'), path.resolve(__dirname, '../../../core/i18n/index.cjs')].find((p) => fs.existsSync(p)));
const msg = (code, params) => i18n.message(code, params, 'ru');

const ROOT = path.resolve(__dirname, '..', '..');

/** The closed list of the keys. It grows only by editing this constant - together with the collation
 *  against the zone's real files; an "just in case" addition does not become a list. */
const KEYS = ['name', 'description', 'model', 'effort', 'tier', 'uses', 'tools'];
const ALLOWED = new Set(KEYS);

const KEY_LINE_RE = /^([A-Za-z][A-Za-z0-9_-]*):/;
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

/** All the .md of a directory, recursively, in a stable order: [{ file, rel }]. */
function listMd(dir, base = '') {
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listMd(path.join(dir, e.name), rel));
    else if (e.isFile() && e.name.endsWith('.md')) out.push({ file: path.join(dir, e.name), rel });
  }
  return out;
}

/** One file's errors: each names the address and the key's name. */
function lintText(rel, text) {
  const m = FRONTMATTER_RE.exec(text);
  if (!m) return [msg('zlint.no_frontmatter', { rel })];
  const bad = [];
  for (const line of m[1].split(/\r?\n/)) {
    const km = KEY_LINE_RE.exec(line);
    if (km && !ALLOWED.has(km[1])) bad.push(msg('zlint.unknown_key', { rel, key: km[1], keys: KEYS.join(', ') }));
  }
  return bad;
}

const dir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, '.zcode', 'agents');
if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
  console.error(msg('zlint.dir_not_found', { dir }));
  process.exit(2);
}
const files = listMd(dir);
const problems = files.flatMap(({ file, rel }) => lintText(rel, fs.readFileSync(file, 'utf8')));
for (const p of problems) console.error(p);
if (problems.length) process.exit(1);
console.log(msg('zlint.clean', { count: files.length, keys: KEYS.join(', ') }));
