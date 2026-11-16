#!/usr/bin/env node
'use strict';

// run-catalog.cjs - the catalog of the Run profiles: one line per profile file found in the two zones.
//
// Behavior contract:
//   Zones scanned for run profiles (*.md):
//     zone1: .claude/agents/run/*.md
//     zone2: project/extensions/*/agents/run/*.md (the star is any first-level subdirectory of project/extensions/)
//   The zone2 glob may be absent or empty in other projects: a single `warning:` line goes to stderr
//   and the run stays exit 0. A missing zone1 is an error (exit 1) - the engine's own profiles zone
//   must exist.
//   For each profile one stdout line: `<name> — <subject>` where <name> is the frontmatter `name:`
//   field and <subject> is the first sentence of the frontmatter `description:` (up to the first
//   `. `, the trailing dot stripped). Files without a frontmatter `name:` are skipped.
//   The last stdout line is always the pointer, even when zone2 holds nothing:
//     product-only profiles live in project/extensions/*/agents/run/ and are listed in PROJECT.md (Run profiles section)
//   A summary line goes to stderr: `run-catalog: N profiles (zone1: X, zone2: Y)`.
//   Exit codes: 0 - success; 1 - a zone that must exist or a profile file could not be read (an
//   `error:` line on stderr before the exit).
//
// Usage: node .claude/scripts/run-catalog.cjs
//
// Dependency-free: requires only 'fs' and 'path'. Resolves the project root from its own location,
// so it runs from any working directory. The template copy in the protocol clone is byte-identical
// and is not run in place. Carries no project traces (clean-zone rule).

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const ZONE1 = path.join(ROOT, '.claude', 'agents', 'run');
const EXTENSIONS = path.join(ROOT, 'project', 'extensions');
const POINTER_LINE =
  'product-only profiles live in project/extensions/*/agents/run/ and are listed in PROJECT.md (Run profiles section)';
const DASH = '\u2014'; // the profile line separator: <name> — <subject>

/** One `error:` line on stderr and exit 1 - the only failure path. */
function fail(message) {
  console.error('error: ' + message);
  process.exit(1);
}

/** Sorted *.md names of one directory; null when the directory is absent (not an error by itself). */
function listMd(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    fail('cannot list ' + rel(dir) + ': ' + e.message);
  }
  return entries.filter((d) => d.isFile() && d.name.endsWith('.md')).map((d) => d.name).sort();
}

function rel(p) {
  return path.relative(ROOT, p) || '.';
}

/**
 * The frontmatter `name:` and `description:` of one profile file; null when the file has no
 * frontmatter or its frontmatter carries no `name:` (such files are skipped by the contract).
 */
function readProfile(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    fail('cannot read ' + rel(file) + ': ' + e.message);
  }
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '---') return null;
  const end = lines.indexOf('---', 1);
  if (end === -1) return null;
  const meta = {};
  for (const line of lines.slice(1, end)) {
    const m = line.match(/^(name|description):\s*(.*)$/);
    if (m) meta[m[1]] = m[2].trim();
  }
  return meta.name ? meta : null;
}

/** The first sentence of a description: up to the first `. `, the trailing dot stripped. */
function firstSentence(text) {
  const cut = text.indexOf('. ');
  const head = cut === -1 ? text : text.slice(0, cut);
  return head.replace(/\.\s*$/, '').trim();
}

/** One catalog line per profile of a directory; unreadable files fail the run. */
function collectProfiles(dir, names) {
  const out = [];
  for (const name of names) {
    const meta = readProfile(path.join(dir, name));
    if (!meta) continue;
    const subject = firstSentence(meta.description || '');
    out.push(subject ? meta.name + ' ' + DASH + ' ' + subject : meta.name);
  }
  return out;
}

/**
 * zone2: for every first-level subdirectory of project/extensions, the agents/run/*.md it holds.
 * Returns null when the extensions directory itself is absent; an array (possibly empty) otherwise.
 */
function extensionsZones() {
  let entries;
  try {
    entries = fs.readdirSync(EXTENSIONS, { withFileTypes: true });
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    fail('cannot list ' + rel(EXTENSIONS) + ': ' + e.message);
  }
  const zones = [];
  const dirs = entries.filter((d) => d.isDirectory()).map((d) => d.name).sort();
  for (const name of dirs) {
    const dir = path.join(EXTENSIONS, name, 'agents', 'run');
    const names = listMd(dir);
    if (names) zones.push({ dir, names });
  }
  return zones;
}

// --- main ---

const zone1Names = listMd(ZONE1);
if (!zone1Names) fail('run profiles zone not found: ' + rel(ZONE1));
const zone1 = collectProfiles(ZONE1, zone1Names);

const extZones = extensionsZones(); // null = absent, [] = nothing under the glob
const zone2 = [];
for (const zone of extZones || []) zone2.push(...collectProfiles(zone.dir, zone.names));

for (const line of [...zone1, ...zone2]) console.log(line);
console.log(POINTER_LINE);

if (!extZones) {
  console.error('warning: no run profiles found under project/extensions/*/agents/run/ (the extensions directory is absent)');
} else if (!zone2.length) {
  console.error('warning: no run profiles found under project/extensions/*/agents/run/ (no profile files under the glob)');
}

console.error('run-catalog: ' + (zone1.length + zone2.length) + ' profiles (zone1: ' + zone1.length + ', zone2: ' + zone2.length + ')');
