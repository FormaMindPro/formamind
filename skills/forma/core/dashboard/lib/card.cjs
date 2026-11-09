'use strict';

/**
 * A board card (AGENTS.md §6-7): where the files live, the frontmatter, the heading, the labels, the zones in
 * two languages. Part of the core's shared library (`.forma/dashboard/lib/`). Only the card's shape is read
 * here - what the fields mean is decided by the callers.
 */

const fs = require('fs');
const path = require('path');
const i18n = require('../../i18n/index.cjs');

/** The board's directory: live cards; the closed ones - in `done/` inside it. */
const boardDir = (root) => path.join(root, '.devtool', 'features');

/**
 * The cards' files: the board first, then `done/`; in each directory - the `readdir` order. No directory -
 * skipped. `test` - a RegExp or a `(name) => bool` over the file's name; the default is `.md`. Returns absolute paths.
 */
function cardFiles(root, test = (name) => name.endsWith('.md')) {
  const ok = test instanceof RegExp ? (name) => test.test(name) : test;
  const board = boardDir(root);
  const out = [];
  for (const dir of [board, path.join(board, 'done')]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) if (ok(f)) out.push(path.join(dir, f));
  }
  return out;
}

// ---- frontmatter --------------------------------------------------------------------------------

/** The block between the `---` at the file's start: the single copy of the regex. */
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

/** The frontmatter block's content or `null`. */
function frontmatterBlock(text) {
  const m = FRONTMATTER_RE.exec(text);
  return m ? m[1] : null;
}

/** `{ block, rest }`: the block and the body after the closing `---` (and one line break). No block - `block: null`, `rest` is the whole text. */
function splitFrontmatter(text) {
  const m = FRONTMATTER_RE.exec(text);
  if (!m) return { block: null, rest: text };
  return { block: m[1], rest: text.slice(m[0].length).replace(/^\r?\n/, '') };
}

/**
 * The card's fields with types: `null` - `null`, `"..."` - a string, `[...]` - an array of strings, else -
 * the raw string. The key is latin (`[a-zA-Z]+`). No block - `{}`.
 */
function parseFrontmatter(text) {
  const block = frontmatterBlock(text);
  if (block === null) return {};
  const fm = {};
  for (const line of block.split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z]+):\s*(.*)$/);
    if (!kv) continue;
    let [, key, val] = kv;
    val = val.trim();
    if (val === 'null') { fm[key] = null; continue; }
    if (val.startsWith('"') && val.endsWith('"')) { fm[key] = val.slice(1, -1); continue; }
    if (val.startsWith('[') && val.endsWith(']')) {
      fm[key] = val.slice(1, -1).split(',').map(s => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
      continue;
    }
    fm[key] = val;
  }
  return fm;
}

/** The fields as JSON: the value - `JSON.parse`, unparsed - the raw string. The key - everything before the first `:`. No block - `{}`. */
function parseFrontmatterJson(text) {
  const block = frontmatterBlock(text);
  const fm = {};
  if (block === null) return fm;
  for (const line of block.split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    const raw = line.slice(i + 1).trim();
    try { fm[k] = JSON.parse(raw); } catch { fm[k] = raw; }
  }
  return fm;
}

/**
 * The flat frontmatter lines (roles, skills): `[fields, body]`. The values - strings without edge quotes;
 * the key - `\w+`; the parsing is by `\n`, the caller cleans `\r`.
 */
function parseFlatFrontmatter(text) {
  const { block, rest } = splitFrontmatter(text);
  const o = {};
  if (block !== null) block.split('\n').forEach((l) => { const k = l.match(/^(\w+):\s*(.*)$/); if (k) o[k[1]] = k[2].replace(/^["']|["']$/g, ''); });
  return [o, rest];
}

/** A field's value over the whole text (not only the block): without quotes, `null` - `null`; no field - `null`. */
function field(text, key) {
  const m = text.match(new RegExp('^' + key + ':\\s*(.*)$', 'm'));
  if (!m) return null;
  const v = m[1].trim().replace(/^["']|["']$/g, '');
  return v === 'null' ? null : v;
}

/** The card's labels - over the whole text, a one-line `labels: [...]`. */
function labelsOf(text) {
  const m = text.match(/^labels:\s*\[([^\]]*)\]/m);
  return m ? m[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean) : [];
}

/** The creation day (`created`) - `YYYY-MM-DD` or an empty string. */
function createdDay(text) {
  return (text.match(/^created:\s*"?(\d{4}-\d{2}-\d{2})/m) || [])[1] || '';
}

/** The card's heading - the first `# ...` line; none - `null`. */
function cardTitle(text) {
  const m = text.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : null;
}

// ---- zones --------------------------------------------------------------------------------------

/** The keys of the card's four zones (AGENTS.md §6): the heading is found by the `<!-- k:zone.X -->` anchor, else by the i18n dictionary. */
const ZONES = ['task', 'kit', 'history', 'result'];

/** A zone's heading for a new card is always English (Task, Kit, History, Result): the core's key does not depend on the project's language. Extra arguments (a language, an anchor) are accepted for compatibility and have no effect. */
const zoneHeading = (key) => i18n.labelsOf('zone.' + key)[0];

/** A zone's heading as written in this card (English, Russian, with an anchor): without the edge `## `; no zone - `null`. */
const zoneHeadingIn = (text, key) => {
  const re = i18n.headingRe('zone.' + key, '');
  const l = String(text).split('\n').map((x) => x.replace(/\r$/, '')).find((x) => re.test(x));
  return l ? l.replace(/^##[ \t]+/, '') : null;
};

/** A zone's body, without edge spaces; no zone - an empty string. */
function zone(text, key) {
  const head = i18n.headingRe('zone.' + key, 'm');
  const lines = String(text).split(/\r?\n/);
  const i = lines.findIndex((l) => head.test(l));
  if (i < 0) return '';
  let end = lines.findIndex((l, k) => k > i && l.startsWith('## '));
  if (end < 0) end = lines.length;
  return lines.slice(i + 1, end).join('\n').trim();
}

/** The whole heading line of the "History" zone (for line-by-line search). */
const HISTORY_HEADING_RE = i18n.headingRe('zone.history', '');

/** The card's text without the history zone - spend lines are appended into closed cards and must not change the hash. */
function withoutHistory(text) {
  const lines = String(text).split('\n');
  const i = lines.findIndex((l) => HISTORY_HEADING_RE.test(l.replace(/\r$/, '')));
  if (i < 0) return String(text);
  let end = lines.findIndex((l, k) => k > i && l.startsWith('## '));
  if (end < 0) end = lines.length;
  return lines.slice(0, i).concat(lines.slice(end)).join('\n');
}

module.exports = {
  boardDir, cardFiles,
  FRONTMATTER_RE, frontmatterBlock, splitFrontmatter, parseFrontmatter, parseFrontmatterJson, parseFlatFrontmatter,
  field, labelsOf, createdDay, cardTitle,
  ZONES, zoneHeading, zoneHeadingIn, zone, HISTORY_HEADING_RE, withoutHistory,
};
