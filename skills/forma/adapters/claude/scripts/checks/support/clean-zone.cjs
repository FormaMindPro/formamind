'use strict';

// Clean zones - prohibition 16 (AGENTS.md §5): the law, adapters, roles, scripts, hooks, skills, manual, dashboard,
// the README/docs/templates/skills of the protocol source. Layer 4 files - .claude/project-layer.txt.
// ISO timestamps with a "T" - a format, not a date. One truth: both the `engine-impersonal` check and the
// check-clean-zone.sh hook (`sync-engines --file`) call scanCleanFile.
// Finding labels come from the core dictionary: English key in code, ru value as data.

const fs = require('fs');
const path = require('path');
// Installed layout first (.claude/scripts/checks/support -> .forma/i18n); the protocol source keeps it in core/i18n
// (tests load this file in place).
const i18n = require([path.resolve(__dirname, '../../../../.forma/i18n/index.cjs'), path.resolve(__dirname, '../../../../../core/i18n/index.cjs')].find((p) => fs.existsSync(p)));
const msg = (code, params) => i18n.message(code, params, 'ru');

const CLEAN_ROOTS = ['AGENTS.md', '.claude/agents', '.claude/rules', '.claude/scripts', '.claude/hooks',
  '.claude/skills', '.forma/manual', '.forma/dashboard', '.forma/living/dictionary',
  '.forma/protocol/docs', '.forma/protocol/templates', '.forma/protocol/skills'];
const CLEAN_SKIP = new Set(['.cache', 'node_modules', 'graphify-out', 'data']);
// Assembled from parts, so the check does not find itself. The human-decision phrase is a Cyrillic
// scan pattern, held as \u escapes (ASCII file by construction).
const CLEAN_RX = new RegExp(['card-\\d{3}', '\u0440\u0435\u0448\u0435' + '\u043d\u0438\u0435 \u0447\u0435\u043b\u043e\u0432\u0435\u043a\u0430', 'iam' + 'forma\\.pro', '\\b20' + '\\d{2}-\\d{2}-\\d{2}(?![T\\d])',
  '`(?=[0-9a-f]*\\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}`', '[\\w.+-]+' + '@' + '[\\w-]+\\.[a-z]{2,}\\b'].join('|'), 'i');

/** The project's files that hold a project trace by design (layer 4): the lines of .claude/project-layer.txt. */
function cleanOwn(root) {
  const layerFile = path.join(root, '.claude', 'project-layer.txt');
  return new Set(fs.existsSync(layerFile)
    ? fs.readFileSync(layerFile, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    : []);
}

/** A layer 4 entry - the path to a file or a directory; a directory covers everything inside. */
function isOwn(rel, own) {
  if (own.has(rel)) return true;
  for (const o of own) if (rel === o || rel.startsWith(o + '/')) return true;
  return false;
}

/** `rel` - a path from the root with "/". Outside the clean zones or in layer 4 - `false` (not checked). */
function inCleanZone(rel, own) {
  if (isOwn(rel, own) || !/\.(md|cjs|js|mjs|sh|py|html)$/.test(rel)) return false;
  if (rel.split('/').some((p) => CLEAN_SKIP.has(p) || (p.startsWith('.') && !['.claude', '.forma'].includes(p)))) return false;
  if (/^protocol\/README[^/]*\.md$/.test(rel)) return true;
  return CLEAN_ROOTS.some((r) => rel === r || rel.startsWith(r + '/'));
}

/** Project traces in the text of file `rel`: a `path:number: ...` line. Plus a project resource in a role's `tools:`. */
function scanCleanFile(rel, text) {
  const problems = [];
  text.split(/\r?\n/).forEach((l, i) => {
    const m = l.match(CLEAN_RX);
    if (m) problems.push(msg('clean-zone.project_trace', { rel, line: i + 1, found: m[0] }));
    // A project resource in a role's permissions: `--site <domain>` or an MCP server with a domain in the name.
    if (/^tools:/.test(l) && rel.includes('/agents/')) {
      for (const t of l.matchAll(/--site\s+[\w-]+(\.[\w-]+)+|mcp__[\w-]*-(pro|ru|com|org|net|io|site|online)__/gi)) {
        problems.push(msg('clean-zone.tools_resource', { rel, line: i + 1, found: t[0] }));
      }
    }
  });
  return problems;
}

module.exports = { CLEAN_ROOTS, CLEAN_SKIP, cleanOwn, isOwn, inCleanZone, scanCleanFile };
