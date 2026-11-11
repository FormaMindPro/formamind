'use strict';

/**
 * The "Documentation" tab - two books; each book's structure is set by a `_toc.json` file, not by folders.
 * The TOC format - `.forma/templates/README-toc.md` and `.forma/templates/toc.json` (a sample without project traces).
 *
 * The "Project documentation" book (`project/docs/_toc.json`) - one language, `title` as a string.
 * The "Engine manual" book (`.forma/manual/_toc.json`) - one TOC over every language branch `.forma/manual/<lang>/`
 * (the file tree is identical by the contract in `.forma/manual/README.md`), `title` - `{en, ru}`.
 *
 * A broken TOC link is not a message in the data but a thrown error with the item's address (`items[0].items[1].page`):
 * `node .forma/dashboard/generate.js` falls on it explicitly instead of publishing a dashboard with a silent hole in the contents.
 */

const fs = require('fs');
const path = require('path');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// All .md files under `base`, the path relative to `base`, with a forward slash (comparable to `page` from the TOC).
function walkMd(dir, base, out) {
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walkMd(full, base, out);
    else if (name.endsWith('.md')) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

// Walks the TOC tree; at every leaf (one with `page`) it calls walk.onLeaf(item, the trail of headings, the address for errors);
// walk.sourceLabel - the TOC file's name for the error message.
// Neither `page` nor `items` on a node - a broken item; we fall with its address, this too is a "link to nothing".
function walkToc(items, trail, addrPrefix, walk) {
  items.forEach((item, i) => {
    const addr = `${addrPrefix}[${i}]`;
    if (item.items) {
      walkToc(item.items, [...trail, item.title], addr + '.items', walk);
    } else if (item.page) {
      walk.onLeaf(item, trail, addr);
    } else {
      throw new Error(`${walk.sourceLabel} ${addr} — item has neither "page" nor "items"`);
    }
  });
}

function buildProjectBook(projectRoot) {
  const root = path.join(projectRoot, 'project', 'docs');
  const tocFile = path.join(root, '_toc.json');
  const id = 'project';
  const fallbackTitle = { key: 'docs.title.project' };
  if (!fs.existsSync(tocFile)) {
    return { id, title: fallbackTitle, toc: null, pages: {}, unlisted: [], error: 'project/docs/_toc.json not found' };
  }
  let toc;
  try { toc = readJson(tocFile); } catch (err) { throw new Error(`project/docs/_toc.json is not valid JSON: ${err.message}`); }

  const pages = {};
  const referenced = new Set();
  walkToc(toc.items || [], [], 'items', { sourceLabel: 'project/docs/_toc.json', onLeaf: (item, trail, addr) => {
    const file = path.join(root, item.page);
    if (!fs.existsSync(file)) throw new Error(`project/docs/_toc.json ${addr}.page — file not found: ${item.page}`);
    referenced.add(item.page);
    pages[item.page] = { page: item.page, title: item.title, breadcrumbs: [...trail, item.title], text: fs.readFileSync(file, 'utf8') };
  } });
  const all = walkMd(root, root, []);
  const unlisted = all.filter((p) => p !== '_toc.json' && !referenced.has(p));
  return { id, title: toc.title || fallbackTitle, toc, pages, unlisted };
}

function buildManualBook(projectRoot) {
  const root = path.join(projectRoot, '.forma/manual');
  const tocFile = path.join(root, '_toc.json');
  const id = '.forma/manual';
  const fallbackTitle = { key: 'docs.title.manual' };
  // Manual languages - the directory listing .forma/manual/*/ (en is the original), the same definition as the manual-languages check.
  const langs = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  const emptyPages = () => Object.fromEntries(langs.map((l) => [l, {}]));
  const emptyUnlisted = () => Object.fromEntries(langs.map((l) => [l, []]));
  if (!fs.existsSync(tocFile)) {
    return { id, title: fallbackTitle, toc: null, pages: emptyPages(), unlisted: emptyUnlisted(), error: '.forma/manual/_toc.json not found' };
  }
  let toc;
  try { toc = readJson(tocFile); } catch (err) { throw new Error(`.forma/manual/_toc.json is not valid JSON: ${err.message}`); }

  const pages = emptyPages();
  const referenced = new Set();
  walkToc(toc.items || [], [], 'items', { sourceLabel: '.forma/manual/_toc.json', onLeaf: (item, trail, addr) => {
    referenced.add(item.page);
    for (const lang of langs) {
      const file = path.join(root, lang, item.page);
      if (!fs.existsSync(file)) throw new Error(`.forma/manual/_toc.json ${addr}.page — file not found: ${lang}/${item.page}`);
      pages[lang][item.page] = { page: item.page, title: item.title, breadcrumbs: [...trail, item.title], text: fs.readFileSync(file, 'utf8') };
    }
  } });
  const unlisted = {};
  for (const lang of langs) {
    const all = walkMd(path.join(root, lang), path.join(root, lang), []);
    unlisted[lang] = all.filter((p) => !referenced.has(p));
  }
  return { id, title: toc.title || fallbackTitle, toc, pages, unlisted };
}

function buildDocs(projectRoot) {
  return { books: [buildProjectBook(projectRoot), buildManualBook(projectRoot)] };
}

module.exports = { buildDocs };
