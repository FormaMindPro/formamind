'use strict';

/**
 * duplicate-number - detects duplicate card numbers across .devtool/features/ and done/
 */

const path = require('path');
const { cardFiles } = require('../../dashboard/lib/card.cjs');

function run({ root }) {
  const files = cardFiles(root);
  const seen = new Map();
  const dups = [];
  for (const f of files) {
    const m = path.basename(f).match(/^card-(\d+)/);
    if (!m) continue;
    const num = m[1];
    if (seen.has(num)) {
      dups.push(`card-${num}: ${path.basename(seen.get(num))} and ${path.basename(f)}`);
    } else {
      seen.set(num, f);
    }
  }
  return dups.map((d) => `duplicate card number: ${d}`);
}

module.exports = { id: 'duplicate-number', since: '0.0.35', run };
