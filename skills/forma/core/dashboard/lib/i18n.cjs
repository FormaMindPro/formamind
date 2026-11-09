'use strict';
// The server-side localization: the languages' list from `locales/*.json` and a key's translation. The core (the
// substitutions, the number forms, the en fallback) is the same as in the browser: web/js/i18n.js, one file for both sides.
const fs = require('fs');
const path = require('path');
const core = require('../web/js/i18n.js');

const LOCALES_DIR = path.join(__dirname, '..', 'locales');

function readDict(code, dir = LOCALES_DIR) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, code + '.json'), 'utf8')); } catch { return {}; }
}

/** [{ code, name }] - one file per language; en first, the rest by the code's alphabet. */
function listLocales(dir = LOCALES_DIR) {
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => /^[a-z]{2,3}(-[A-Za-z0-9]+)?\.json$/.test(f)); } catch { /* no directory - an empty list */ }
  return files.map((f) => f.slice(0, -5)).sort((a, b) => (a === core.FALLBACK ? -1 : b === core.FALLBACK ? 1 : a.localeCompare(b)))
    .map((code) => ({ code, name: readDict(code, dir)['_meta.name'] || code }));
}

/** A key's translation in the `lang` language with the en fallback. */
function tr(lang, key, vars, dir = LOCALES_DIR) {
  return core.translate({ [core.FALLBACK]: readDict(core.FALLBACK, dir), [lang]: readDict(lang, dir) }, lang, key, vars);
}

module.exports = { LOCALES_DIR, listLocales, readDict, tr, FALLBACK: core.FALLBACK, translate: core.translate };
