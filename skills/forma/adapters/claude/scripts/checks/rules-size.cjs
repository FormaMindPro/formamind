'use strict';

// Rules file size: the platform truncates a rules file beyond the limit (Antigravity - 24 000 bytes), the law's tail is lost.
// Above 22 000 bytes - a violation, above 20 000 - an info note.

const fs = require('fs');
const path = require('path');
// Finding labels come from the core dictionary: English key in code, ru value as data.
const i18n = require('../../../.forma/i18n/index.cjs');
const msg = (code, params) => i18n.message(code, params, 'ru');

const ERROR_BYTES = 22000;
const WARN_BYTES = 20000;

function ruleFiles(root) {
  const files = ['AGENTS.md', 'GEMINI.md'];
  const E = require('../../../.forma/dashboard/lib/engines.cjs');
  const dirs = E.loadAdapters(root).map((a) => a.engineRulesFile).filter((f) => typeof f === 'string').map((f) => path.posix.dirname(f));
  for (const dir of [...new Set(dirs)]) {
    const abs = path.join(root, dir);
    if (fs.existsSync(abs)) for (const f of fs.readdirSync(abs)) if (f.endsWith('.md')) files.push(`${dir}/${f}`);
  }
  return files.filter((f) => fs.existsSync(path.join(root, f)));
}

function run({ root, info }) {
  const problems = [];
  for (const rel of ruleFiles(root)) {
    const bytes = fs.statSync(path.join(root, rel)).size;
    if (bytes > ERROR_BYTES) problems.push(msg('rules-size.too_big', { rel, bytes, limit: ERROR_BYTES }));
    else if (bytes > WARN_BYTES && info) info.push(msg('rules-size.close', { rel, warn: WARN_BYTES, limit: ERROR_BYTES }));
  }
  return problems;
}

module.exports = { id: 'rules-size', since: null, run };
