'use strict';

// manual: the English - the original, the Russian - an exact copy. The set of files and the headings' count in
// each pair is compared - not the text: the meaning is compared by a human. A core check; the engines' sync puts it into the registry.

const fs = require('fs');
const path = require('path');
const { walk } = require('../lib/fs.cjs');
// The findings' canonical ru strings live in the core dictionary; the language is fixed.
const { message: coreMessage } = require('../../i18n/index.cjs');
const ruMsg = (key, params) => coreMessage(key, params, 'ru');

const headingCount = (file) => (fs.readFileSync(file, 'utf8').match(/^#{1,3} /gm) || []).length;

function run({ root }) {
  const problems = [];
  const en = path.join(root, '.forma/manual', 'en');
  const ru = path.join(root, '.forma/manual', 'ru');
  if (!fs.existsSync(en) && !fs.existsSync(ru)) return problems;
  const E = new Set(walk(en, { ext: '.md', symlinks: true }));
  const R = new Set(walk(ru, { ext: '.md', symlinks: true }));
  for (const f of E) if (!R.has(f)) problems.push(ruMsg('manual_languages.no_ru_copy', { file: f }));
  for (const f of R) if (!E.has(f)) problems.push(ruMsg('manual_languages.no_en_copy', { file: f }));
  for (const f of E) {
    if (!R.has(f)) continue;
    const a = headingCount(path.join(en, f));
    const b = headingCount(path.join(ru, f));
    if (a !== b) problems.push(ruMsg('manual_languages.headings_drift', { file: f, a, b }));
  }
  return problems;
}

module.exports = { id: 'manual-languages', since: null, run };
