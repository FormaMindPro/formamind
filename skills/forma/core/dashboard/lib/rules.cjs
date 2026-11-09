'use strict';

/**
 * The project's checks journal - `.forma/living/checks.json`: `{ "<rule>": "YYYY-MM-DD" }`, the first day from which
 * the rule is demanded. The engine knows only the rule's key; the date is written by the project. Part of the core's shared library (`.forma/dashboard/lib/`).
 */

const fs = require('fs');
const path = require('path');

/**
 * The day a rule takes effect. The rule is not in the journal - it has been met in this project for the first time:
 * tomorrow's day is written (the lines written today do not carry the new field yet), and the project's past
 * stays outside the check.
 */
function ruleSince(root, key) {
  const file = path.join(root, '.forma/living', 'checks.json');
  let j = {};
  try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* no checks journal or a broken one - start empty */ }
  if (!j[key]) {
    j[key] = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(j, null, 2) + '\n'); } catch { /* writing the journal is not obligatory: the date is already computed and returned */ }
  }
  return j[key];
}

module.exports = { ruleSince };
