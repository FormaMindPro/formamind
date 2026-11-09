'use strict';

/**
 * The dashboard cache - `.forma/dashboard/.cache/<name>`: the file path and reading of the returns that separate scripts write.
 * Walking the transcripts costs seconds and gigabytes, so the data assembly only reads what is ready.
 */

const path = require('path');
const { readJson } = require('../lib/fs.cjs');

/** Path to a file in the project's dashboard cache. */
const cachePath = (projectRoot, name) => path.join(projectRoot, '.forma/dashboard', '.cache', name);

/** Age in hours from the ISO time; no time - `null`. */
const hoursSince = (iso) => (iso ? (Date.now() - Date.parse(iso)) / 3600000 : null);

/**
 * A return from the cache without the service fields `omit` and with the age (`ageHours`): yesterday's return is
 * not the same as today's. No file or a broken one - `null`.
 */
function readStatement(projectRoot, name, omit) {
  const d = readJson(cachePath(projectRoot, name), null);
  if (d === null) return null;
  const rest = { ...d };
  for (const key of omit) delete rest[key];
  return { ...rest, ageHours: hoursSince(d.generatedAt) };
}

module.exports = { cachePath, hoursSince, readStatement };
