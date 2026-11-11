'use strict';

// manual: the English - the original, the other languages - exact copies (the listing of the .forma/manual/*/ directories).
// The set of files and the headings' count in each "original - copy" pair is compared - not the text: the meaning
// is compared by a human. A core check; the engines' sync puts it into the registry.

const fs = require('fs');
const path = require('path');
const { walk } = require('../lib/fs.cjs');
// The findings' canonical ru strings live in the core dictionary; the language is fixed.
const { message: coreMessage } = require('../../i18n/index.cjs');
const ruMsg = (key, params) => coreMessage(key, params, 'ru');

const headingCount = (file) => (fs.readFileSync(file, 'utf8').match(/^#{1,3} /gm) || []).length;

function run({ root }) {
  const problems = [];
  const base = path.join(root, '.forma/manual');
  const en = path.join(base, 'en');
  if (!fs.existsSync(en)) return problems;
  const E = new Set(walk(en, { ext: '.md', symlinks: true }));
  const langs = fs.readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  for (const lang of langs) {
    if (lang === 'en') continue;
    const dir = path.join(base, lang);
    const M = new Set(walk(dir, { ext: '.md', symlinks: true }));
    for (const f of E) if (!M.has(f)) problems.push(`.forma/manual/en/${f}: \u043d\u0435\u0442 \u043a\u043e\u043f\u0438\u0438 \u0432 .forma/manual/${lang}/`);
    for (const f of M) if (!E.has(f)) problems.push(`.forma/manual/${lang}/${f}: \u043d\u0435\u0442 \u0430\u043d\u0433\u043b\u0438\u0439\u0441\u043a\u043e\u0433\u043e \u043e\u0440\u0438\u0433\u0438\u043d\u0430\u043b\u0430 \u0432 .forma/manual/en/`);
    for (const f of E) {
      if (!M.has(f)) continue;
      const a = headingCount(path.join(en, f));
      const b = headingCount(path.join(dir, f));
      if (a !== b) problems.push(`.forma/manual/{en,${lang}}/${f}: \u0437\u0430\u0433\u043e\u043b\u043e\u0432\u043a\u043e\u0432 ${a} \u043f\u0440\u043e\u0442\u0438\u0432 ${b} — \u043a\u043e\u043f\u0438\u044f \u0440\u0430\u0437\u043e\u0448\u043b\u0430\u0441\u044c \u0441 \u043e\u0440\u0438\u0433\u0438\u043d\u0430\u043b\u043e\u043c`);
    }
  }
  return problems;
}

module.exports = { id: 'manual-languages', since: null, run };
