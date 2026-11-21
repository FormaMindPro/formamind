'use strict';

// Names (AGENTS.md section 1, prohibition 20). Every functional key carries its human name beside the address:
// a card - its board headline after the middle dot; a goal - the name in its GOAL.md heading; a route, an overlay,
// a prohibition - the name in keys.json and the registry NAMES.md. A missing name is a red board: a code alone
// cannot reach the human. Goals are project data and are read at runtime, never from the machine dictionary.

const fs = require('fs');
const path = require('path');
const i18n = require('../../i18n/index.cjs');
const names = require('../../i18n/names.cjs');
const { cardFiles, labelsOf } = require('../../dashboard/lib/card.cjs');

const msg = (key, params) => i18n.message(key, params, 'ru');

function cards(root) {
  const out = [];
  for (const file of cardFiles(root, /^card-\d+.*\.md$/)) {
    const text = fs.readFileSync(file, 'utf8');
    const title = (/^#\s+(.+)$/m.exec(text) || [])[1] || '';
    const m = /^card-(\d+)\s*\u00b7\s*(.+)$/.exec(title.trim());
    out.push({ file: path.basename(file), text, named: Boolean(m && m[2].trim()) });
  }
  return out;
}

/** Numbers of the prohibitions in the law's section 5; null when the law or the section is missing. */
function lawProhibitions(root) {
  let text;
  try { text = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'); } catch { return null; }
  const m = /^## 5\./m.exec(text);
  if (!m) return null;
  const rest = text.slice(m.index + 1);
  const next = rest.match(/^## \d+\./m);
  const section = next ? rest.slice(0, next.index) : rest;
  const numbers = new Set();
  for (const line of section.split(/\r?\n/)) {
    const n = /^(\d+)\. /.exec(line);
    if (n) numbers.add(n[1]);
  }
  return numbers;
}

/** The registry mirrors: every prohibition key is named in each language's NAMES.md. */
function registryFindings(root, keys) {
  const manual = path.join(root, '.forma', 'manual');
  let langs;
  try { langs = fs.readdirSync(manual, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; }
  const findings = [];
  for (const lang of langs) {
    const file = path.join(manual, lang, '03-protocol', 'NAMES.md');
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const key of Object.keys(keys)) if (!text.includes('`' + key + '`')) findings.push(msg('board.names.registry', { rel: path.relative(root, file), key }));
  }
  return findings;
}

function run({ root }) {
  const keys = i18n.KEYS.prohibitionNames || {};
  const findings = [];
  const board = cards(root);

  for (const c of board) if (!c.named) findings.push(msg('board.names.card', { file: c.file }));

  const goals = new Set();
  const routes = new Set();
  for (const c of board) {
    for (const label of labelsOf(c.text)) {
      if (/^goal-/.test(label)) goals.add(label);
      if (/^(route-[0-8]|over-[1-4])$/.test(label)) routes.add(label);
    }
  }
  for (const code of [...goals].sort()) if (!names.goalName(root, code)) findings.push(msg('board.names.goal', { code }));
  for (const label of [...routes].sort()) {
    const entry = (i18n.KEYS.routeNames || {})[label];
    if (!entry || !entry.en || !entry.ru) findings.push(msg('board.names.route', { label }));
  }

  const law = lawProhibitions(root);
  if (law) {
    for (const n of law) if (!keys['prohibition-' + n]) findings.push(msg('board.names.dict', { n }));
    for (const key of Object.keys(keys)) {
      const n = /^prohibition-(\d+)$/.exec(key);
      if (n && !law.has(n[1])) findings.push(msg('board.names.law', { n: n[1] }));
    }
    findings.push(...registryFindings(root, keys));
  }
  return findings;
}

module.exports = { id: 'names', since: null, run };
