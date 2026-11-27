'use strict';

// The speech register map (the human rule: manual/en/03-protocol/LANGUAGE.md): every epic code of
// PROJECT.md ("Project epics") carries a speech mode, every key of `.forma/i18n/registers.json`
// carries a human name in each declared language, and the ru names match the config cells.
// Registry form: one check - one file (`index.cjs`); printed labels come from the core dictionary.
// Standalone: `node .forma/board/checks/check-register.cjs` - exit 0 green, 1 findings.

const fs = require('fs');
const path = require('path');
const i18n = require('../../i18n/index.cjs');

const LANG = 'ru';

/** Epic codes and names from PROJECT.md: the table after the `<!-- k:epics -->` anchor. */
function epicTable(root) {
  let text;
  try { text = fs.readFileSync(path.join(root, 'project', 'config', 'PROJECT.md'), 'utf8'); } catch { return null; }
  const start = text.indexOf('<!-- k:epics -->');
  if (start < 0) return null;
  const rest = text.slice(start);
  const nextAnchor = rest.slice(1).indexOf('<!-- k:');
  const block = nextAnchor < 0 ? rest : rest.slice(0, nextAnchor + 1);
  const rows = {};
  for (const m of block.matchAll(/^\|\s*`([a-z][a-z0-9-]*)`\s*\|\s*([^|]+)\|/gm)) {
    rows[m[1]] = m[2].trim().replace(/\s+/g, ' ');
  }
  return rows;
}

function run({ root }) {
  const bad = [];
  let map;
  try {
    map = JSON.parse(fs.readFileSync(path.join(root, '.forma', 'i18n', 'registers.json'), 'utf8'));
  } catch {
    return [i18n.message('board.register.missing_map', {}, LANG)];
  }
  const modes = map.modes || {};
  const epics = map.epics || {};
  const langs = (map.dictionaryPolicy && map.dictionaryPolicy.languages) || ['en', 'ru'];
  const table = epicTable(root);
  if (!table || !Object.keys(table).length) {
    bad.push(i18n.message('board.register.no_table', {}, LANG));
  }
  for (const [code, cell] of Object.entries(table || {})) {
    const e = epics[code];
    if (!e) { bad.push(i18n.message('board.register.no_mode', { epic: code }, LANG)); continue; }
    if (!modes[e.mode]) bad.push(i18n.message('board.register.bad_mode', { epic: code, mode: e.mode }, LANG));
    for (const l of langs) {
      if (!e.name || !e.name[l] || !String(e.name[l]).trim()) {
        bad.push(i18n.message('board.register.no_name', { key: 'epics.' + code, lang: l }, LANG));
      }
    }
    if (e.name && e.name.ru && e.name.ru !== cell) {
      bad.push(i18n.message('board.register.name_drift', { epic: code }, LANG));
    }
  }
  for (const code of Object.keys(epics)) {
    if (!table || !table[code]) bad.push(i18n.message('board.register.unknown_code', { epic: code }, LANG));
  }
  for (const [mode, m] of Object.entries(modes)) {
    for (const l of langs) {
      if (!m[l] || !String(m[l]).trim()) {
        bad.push(i18n.message('board.register.no_name', { key: 'modes.' + mode, lang: l }, LANG));
      }
    }
  }
  return bad;
}

module.exports = { id: 'check-register', since: null, run };

if (require.main === module) {
  const bad = run({ root: process.cwd() });
  if (bad.length) {
    console.log(i18n.message('board.register.header', { n: bad.length }, LANG));
    for (const line of bad) console.log('  - ' + line);
    process.exit(1);
  }
  console.log(i18n.message('board.register.ok', {}, LANG));
  process.exit(0);
}
