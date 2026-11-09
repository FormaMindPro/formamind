'use strict';

// Registry wrapper for `thresholds-declared.cjs` - the declaration gate of the law (§3) as a standing
// board check. The subject - the declaration itself: the scaffold of a fresh install keeps the
// k:attempts / k:volume rows with empty values until the interview fills them ("human, before start"),
// and a declaration not yet made is no subject - the check skips without findings. A row gone, the
// whole section gone, or a number already standing - the full gate run: a removed or half-filled
// declaration is red, fail-closed.

const fs = require('node:fs');
const path = require('node:path');
const { runProject } = require('./thresholds-declared.cjs');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const PROJECT_REL = 'project/config/PROJECT.md';

/** The declaration is made: at least one of the k:attempts / k:volume rows carries a number.
 *  A missing row or a missing section is not a scaffold state - the gate judges it (red via runProject). */
function declarationMade(lines) {
  const at = lines.findIndex((l) => l.includes('k:thresholds'));
  if (at < 0) return true; // the section itself is gone - the gate judges
  const rowFor = (key) => {
    for (let i = at + 1; i < lines.length; i++) {
      const t = lines[i].trim();
      if (!t) continue; // empty lines between the heading and the table - skipped
      if (!t.startsWith('|')) break; // the table runs to the first line outside `|`
      if (t.includes('k:' + key)) return t;
    }
    return null;
  };
  const attempts = rowFor('attempts');
  const volume = rowFor('volume');
  if (attempts === null || volume === null) return true; // a row gone - the gate judges
  return /\d/.test(attempts) || /\d/.test(volume); // both rows stand empty - the interview has not happened yet
}

function run(ctx = {}) {
  const root = ctx.root || ROOT;
  const file = path.join(root, PROJECT_REL);
  if (!fs.existsSync(file)) return []; // no project config - no subject, skip
  const lines = String(fs.readFileSync(file, 'utf8')).split(/\r?\n/);
  if (!declarationMade(lines)) return []; // the declaration is not made yet - skip
  try {
    const r = runProject({ root });
    return r.lines.filter((l) => l.status === 'red').map((l) => 'law-thresholds-declared: ' + l.fact);
  } catch (e) {
    return ['law-thresholds-declared: the gate fell: ' + (e && e.message ? e.message : String(e))];
  }
}

module.exports = { id: 'law-thresholds-declared', since: null, run };
