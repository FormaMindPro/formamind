'use strict';

// Card materials: project/cards/card-NNN/. The folder is named by the card code, not the title, so the link is checkable
// by machine. We catch the quiet breakages: the folder left from a removed card, a card referencing a folder that does
// not exist, a file in the folder heavier than the ceiling. Otherwise they are found by accident and late.

const fs = require('fs');
const path = require('path');
const i18n = require('../../i18n/index.cjs');
const { cardFiles, boardDir } = require('../../dashboard/lib/card.cjs');
const { walk } = require('../../dashboard/lib/fs.cjs');

// The weight ceiling. 500 KB is not a space budget but a discriminator of kind: a screenshot fits into it, a generated asset does not.
// So a file heavier than the ceiling is almost always not evidence but an asset, whose place is with the provider (project/cards/README.md).
// The check only names it: it does not compress, does not delete, does not hold the commit.
const LIMIT = 500 * 1024;
// assets/ and work/ - assets and working material of scripts: outside git (.gitignore), not weighed.
const UNTRACKED = new Set(['assets', 'work']);
// An image of any weight belongs to assets/: git is no place for pictures, and the file weight changes nothing.
const IMAGE = /\.(png|jpe?g|gif|webp|avif|bmp|tiff?|ico)$/i;

/** Codes of existing cards - from the board file names, live and closed. */
function cardCodes(root) {
  const codes = new Set();
  for (const file of cardFiles(root, /^card-\d+-.*\.md$/)) codes.add(path.basename(file).match(/^(card-\d+)-/)[1]);
  return codes;
}

/** Material folders: the name - a card code, the card is on the board, the folder is not empty. */
function folderProblems(dir, codes) {
  const problems = [];
  if (!fs.existsSync(dir)) return problems;
  for (const entry of fs.readdirSync(dir)) {
    const abs = path.join(dir, entry);
    if (!fs.statSync(abs).isDirectory()) continue;
    const m = entry.match(/^(card-\d+)$/);
    if (!m) {
      problems.push(i18n.message('board.card-materials.name_not_code', { entry }, 'ru'));
    } else if (!codes.has(m[1])) {
      problems.push(i18n.message('board.card-materials.no_card', { entry }, 'ru'));
    } else if (!fs.readdirSync(abs).length) {
      problems.push(i18n.message('board.card-materials.empty', { entry }, 'ru'));
    }
  }
  return problems;
}

/** Images outside assets/ - at any weight. */
function imageProblems(dir) {
  const problems = [];
  if (!fs.existsSync(dir)) return problems;
  const files = walk(dir, { symlinks: true, skip: (e) => e.isDirectory() && UNTRACKED.has(e.name) });
  for (const rel of files) {
    if (!IMAGE.test(rel)) continue;
    const kb = Math.round(fs.statSync(path.join(dir, rel)).size / 1024);
    problems.push(i18n.message('board.card-materials.image_outside', { rel, kb }, 'ru'));
  }
  return problems;
}

/** Material files heavier than the ceiling. */
function heavyProblems(dir) {
  const problems = [];
  if (!fs.existsSync(dir)) return problems;
  const files = walk(dir, { symlinks: true, skip: (e) => e.isDirectory() && UNTRACKED.has(e.name) });
  for (const rel of files) {
    if (IMAGE.test(rel)) continue;
    const size = fs.statSync(path.join(dir, rel)).size;
    if (size > LIMIT) {
      problems.push(i18n.message('board.card-materials.heavy', { rel, kb: Math.round(size / 1024) }, 'ru'));
    }
  }
  return problems;
}

/** The other side: a card references a folder that does not exist. */
function danglingProblems(root, dir) {
  const problems = [];
  for (const file of cardFiles(root)) {
    const body = fs.readFileSync(file, 'utf8');
    for (const m of body.matchAll(/project\/cards\/(card-\d+)\//g)) {
      if (!fs.existsSync(path.join(dir, m[1]))) problems.push(i18n.message('board.card-materials.dangling', { f: path.basename(file), entry: m[1] }, 'ru'));
    }
  }
  return problems;
}

function run({ root }) {
  if (!fs.existsSync(boardDir(root))) return [];
  const dir = path.join(root, 'project', 'cards');
  return [...folderProblems(dir, cardCodes(root)), ...imageProblems(dir), ...heavyProblems(dir), ...danglingProblems(root, dir)];
}

module.exports = { id: 'card-materials', since: null, run };
