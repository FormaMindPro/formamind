#!/usr/bin/env node
'use strict';
// The speech register map of a project (the human rule: manual/en/03-protocol/LANGUAGE.md).
// Built at install from the project's own config, never shipped as a file: the epic codes and their
// human names are project data (prohibition 16), so the source carries only the shared part - the
// default mode of each known code, the mode names and the dictionary policy. An unknown code gets
// `firm`; the map's declared language is the project's declared language; every declared language
// gets a non-empty mode name (English is the fallback). An existing map is the human's edit and is
// never overwritten - a rerun only heals a missing one. The map is not a schema file: it is written
// outside the installer's `owned` set and so never enters .forma/install-manifest.json.
// The checker is .forma/board/checks/check-register.cjs (the same table parse: anchor, backticked
// code in the first cell, the second cell as the name).
// Standalone: `node .forma/i18n/registers.cjs [--root <path>]` - exit 0 written/kept, 1 nothing to build from.

const fs = require('node:fs');
const path = require('node:path');
const i18n = require('./index.cjs');

const MAP_REL = path.join('.forma', 'i18n', 'registers.json');
const FALLBACK_MODE = 'firm';

// The default speech mode of each epic code the protocol knows. A code outside this table is not an
// error: it gets the fallback so the report still has a register. The human re-picks any mode by
// editing the generated map.
const DEFAULT_MODES = {
  analytics: 'firm',
  structure: 'soft',
  protocol: 'firm',
  resources: 'soft',
  balance: 'soft',
  discussion: 'firm',
  channels: 'firm',
  competencies: 'firm',
  results: 'soft',
};

// Human names of the modes. English is the fallback for any declared language not listed here.
const MODE_NAMES = {
  firm: {
    en: 'firm',
    ru: '\u0442\u0432\u0451\u0440\u0434\u044b\u0439',
    _doc: 'codes and facts first; work, spend, routes, the protocol, the product',
  },
  soft: {
    en: 'soft',
    ru: '\u043c\u044f\u0433\u043a\u0438\u0439',
    _doc: 'the same fact plus the state, in human words; interviews, balance proposals, the human own testing',
  },
};

const DICTIONARY_POLICY = {
  keys: 'english-only',
  labels: 'fallback-only',
  dictionary: '.forma/i18n/keys.json',
  names: '.forma/i18n/names.cjs',
  rule: 'AGENTS.md section 6; a functional key in speech to the human carries its human name in the chat language, the address beside it (prohibition 20)',
};

const REPORT_SKELETON = {
  _doc: 'The sections of a report; the mode colors the wording, never the sections.',
  engine: [
    'what changed, by artifact',
    'gate outputs with exit codes',
    'open risks named by address and expected value',
  ],
  project: [
    'what the human can now see',
    'where to look, links',
    'what waits for the human decision',
  ],
};

const MAP_DOC = 'Speech modes of the engine (the human rule: manual/en/03-protocol/LANGUAGE.md, ru copy beside it). '
  + 'Generated at install from the project own "Project epics" table: one entry per epic code - the mode the report '
  + 'to the human is held in and the epic human name in the declared language. The dictionary policy and the report '
  + 'skeletons are the shared part. The map is project data: a rerun never overwrites it, the human edits it freely. '
  + 'Check: .forma/board/checks/check-register.cjs; behavior: skill human-register (read by Intent only).';

/** Epic codes and names from PROJECT.md: the table after the `<!-- k:epics -->` anchor. */
function epicTable(text) {
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

/** The map for the parsed epic rows and the declared project language: mode per code, name per language. */
function buildMap(rows, lang) {
  const modes = {};
  for (const [mode, names] of Object.entries(MODE_NAMES)) {
    const entry = {};
    for (const l of Object.keys(names).filter((k) => !k.startsWith('_'))) entry[l] = names[l];
    if (!entry[lang]) entry[lang] = names.en;
    if (names._doc) entry._doc = names._doc;
    modes[mode] = entry;
  }
  const epics = {};
  for (const [code, cell] of Object.entries(rows)) {
    epics[code] = { mode: DEFAULT_MODES[code] || FALLBACK_MODE, name: { [lang]: cell } };
  }
  return {
    _doc: MAP_DOC,
    modes,
    dictionaryPolicy: { ...DICTIONARY_POLICY, languages: [lang] },
    reportSkeleton: REPORT_SKELETON,
    epics,
  };
}

/**
 * Writes `.forma/i18n/registers.json` of the project at `root` when it is missing.
 * Returns `{ status, path }`: `written`, `kept` (an existing map stays), `no-config` (no PROJECT.md),
 * `no-table` (no epic table) - the last two are not errors, the install goes on.
 */
function write(root) {
  const dst = path.join(root, MAP_REL);
  if (fs.existsSync(dst)) return { status: 'kept', path: dst };
  const text = i18n.readProjectMd(root);
  if (!text) return { status: 'no-config', path: dst };
  const rows = epicTable(text);
  if (!rows || !Object.keys(rows).length) return { status: 'no-table', path: dst };
  const lang = i18n.projectLang(root);
  const map = buildMap(rows, lang);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, JSON.stringify(map, null, 2) + '\n');
  return { status: 'written', path: dst, language: lang, epics: Object.keys(rows).length };
}

module.exports = { write, epicTable, buildMap };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const at = argv.indexOf('--root');
  const root = at >= 0 && argv[at + 1] ? path.resolve(argv[at + 1]) : process.cwd();
  const r = write(root);
  const labels = {
    written: `written (${r.epics} epic(s), ${r.language})`,
    kept: 'kept - the existing map is not overwritten',
    'no-config': 'nothing to build from: PROJECT.md not found',
    'no-table': 'nothing to build from: no "Project epics" table',
  };
  console.log(`registers: ${labels[r.status] || r.status} (${r.path})`);
  process.exit(r.status === 'written' || r.status === 'kept' ? 0 : 1);
}
