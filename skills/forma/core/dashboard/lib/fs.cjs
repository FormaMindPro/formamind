'use strict';

/**
 * Files: tree traversal, JSON, reading without falling. Part of the core's shared library (`.forma/dashboard/lib/`).
 * Not a single dependency besides the built-in modules: the core, the adapters and the installer connect it by path.
 */

const fs = require('fs');
const path = require('path');

/**
 * Recursive traversal, depth-first, in the `readdir` order (directories and files intermixed - the way the disk reads).
 * Symbolic links are not expanded: a link is neither a directory nor a regular file (`Dirent`).
 * No directory - `[]`.
 *
 * @param {string} dir
 * @param {object} [o]
 * @param {string} [o.ext] - keep only the files with this name ending (`.md`)
 * @param {(entry: fs.Dirent, rel: string) => boolean} [o.skip] - skip an entry (a directory - together with its content);
 *   `rel` - the path from `dir` through `/`
 * @param {boolean} [o.abs] - return absolute paths (the default - from `dir`, through `/`)
 * @param {boolean} [o.tolerant] - skip a directory that does not read, instead of falling
 * @param {boolean} [o.symlinks] - count everything that is not a directory a file (a link included)
 * @returns {string[]}
 */
function walk(dir, o = {}) {
  const out = [];
  const isFile = o.symlinks ? (e) => !e.isDirectory() : (e) => e.isFile();
  const visit = (abs, rel) => {
    let entries;
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); }
    catch (err) { if (o.tolerant || err.code === 'ENOENT') return; throw err; }
    for (const e of entries) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (o.skip && o.skip(e, r)) continue;
      if (e.isDirectory()) { visit(path.join(abs, e.name), r); continue; }
      if (!isFile(e)) continue;
      if (o.ext && !e.name.endsWith(o.ext)) continue;
      out.push(o.abs ? path.join(dir, r) : r);
    }
  };
  visit(dir, '');
  return out;
}

/** A JSON file; no file or a broken one - `fallback`. */
function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

/** Writing through a temporary file and a rename: a reader never sees half a file. Indent 2, a line end. */
function writeJsonAtomic(file, obj) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

/** The file's text; no file or an unreadable one - `fallback` (an empty string by default). */
function readIfExists(file, fallback = '') {
  try { return fs.readFileSync(file, 'utf8'); }
  catch { return fallback; }
}

/** The project's static configuration (`PROJECT.md`, `CONFIG.md`, `SETUP.md`, `ROUTE.md`, `SITE.md`) - in `project/config/`;
 *  before the move it lived in `project/`. The old path is the fallback: a project that has not been through the installer reads as before. */
function projectFile(root, name) {
  const next = path.join(root, 'project', 'config', name);
  const old = path.join(root, 'project', name);
  return !fs.existsSync(next) && fs.existsSync(old) ? old : next;
}

/** The project's service files (`ROADMAP.md`, `JOURNAL.md`, `VALUE.md`, `GLOSSARY.md`) - in `project/ops/`;
 *  before the move they lived in `project/`. The old path is the fallback, like `projectFile`'s. */
function opsFile(root, name) {
  const next = path.join(root, 'project', 'ops', name);
  const old = path.join(root, 'project', name);
  return !fs.existsSync(next) && fs.existsSync(old) ? old : next;
}

module.exports = { walk, readJson, writeJsonAtomic, readIfExists, projectFile, opsFile };
