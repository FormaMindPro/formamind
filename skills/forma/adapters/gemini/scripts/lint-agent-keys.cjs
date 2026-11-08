#!/usr/bin/env node
'use strict';

/**
 * lint-agent-keys.cjs - a lint of the frontmatter keys of the Gemini zone's (.agents) agent files:
 * a closed list by the zone's fact, a typo - an error with the address and the key's name (exit 1).
 *
 *   node .agents/scripts/lint-agent-keys.cjs [directory]
 *
 * The default directory - the Gemini zone's agents (.agents/plugins/forma/agents, recursively).
 * The frontmatter keys are checked against the closed list, collated with the zone's real files:
 * name, description, model, effort, tier, uses, tools, skills, omitClaudeMd.
 * An unknown (typoed) key - an error with the file's address and the key's name, exit 1, not silence.
 * An agent file without a frontmatter block - an error (fail-closed, a silent skip is inadmissible).
 * The on-demand layer's files (on-demand instructions without a frontmatter) are skipped.
 * A clean set - exit 0.
 *
 * Exit codes:
 *   0 - no violations (the number of the checked files);
 *   1 - errors found (a line per each violation);
 *   2 - the directory is not found.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const i18n = require([path.resolve(__dirname, '../../.forma/i18n/index.cjs'), path.resolve(__dirname, '../../../core/i18n/index.cjs')].find((p) => fs.existsSync(p)));
const msg = (code, params) => i18n.message(code, params, 'ru');

/** The closed list of the Gemini zone's keys, fixed by the zone's fact. */
const KEYS = [
  'name',
  'description',
  'model',
  'effort',
  'tier',
  'uses',
  'tools',
  'skills',
  'omitClaudeMd',
];
const ALLOWED = new Set(KEYS);

const KEY_LINE_RE = /^([A-Za-z][A-Za-z0-9_-]*):/;
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;
const ON_DEMAND_RE = /(?:^|[\\/])on-demand(?:[\\/]|$)/;

/** All the .md files of a directory, recursively, in a stable order: [{ file, rel }]. */
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

/** One file's errors: the address and the key's name. */
function lintText(rel, text) {
  const m = FRONTMATTER_RE.exec(text);
  if (!m) {
    if (ON_DEMAND_RE.test(rel)) return [];
    return [msg('glint.no_frontmatter', { rel })];
  }
  const bad = [];
  for (const line of m[1].split(/\r?\n/)) {
    const km = KEY_LINE_RE.exec(line);
    if (km && !ALLOWED.has(km[1])) {
      bad.push(msg('glint.unknown_key', { rel, key: km[1], keys: KEYS.join(', ') }));
    }
  }
  return bad;
}

function lintDir(targetDir) {
  const files = listMd(targetDir);
  const problems = files.flatMap(({ file, rel }) => lintText(rel, fs.readFileSync(file, 'utf8')));
  return { files, problems };
}

module.exports = { KEYS, ALLOWED, listMd, lintText, lintDir };

if (require.main === module) {
  const dir = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(ROOT, '.agents', 'plugins', 'forma', 'agents');

  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    console.error(msg('glint.dir_not_found', { dir }));
    process.exit(2);
  }

  const { files, problems } = lintDir(dir);
  for (const p of problems) console.error(p);
  if (problems.length) process.exit(1);

  console.log(msg('glint.clean', { count: files.length, keys: KEYS.join(', ') }));
}
