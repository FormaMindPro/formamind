'use strict';

/**
 * The root rules' construction: AGENTS.md is the only source of §1-7, the engines' §8 files are served separately
 * and hold no copy of the rules of their own. There is nothing left to compare between two texts - what is checked
 * is exactly that the text is one.
 * Finding labels come from the core dictionary: English key in code, ru value as data.
 */

const fs = require('fs');
const path = require('path');
const i18n = require('../../../.forma/i18n/index.cjs');
const msg = (code, params) => i18n.message(code, params, 'ru');

const SECTIONS = ['## 1.', '## 2.', '## 3.', '## 4.', '## 5.', '## 6.', '## 7.'];
const FIELD_BINDING = [/subagent_tokens|duration_ms|cache_read_input_tokens|agent_id/, 'root-rules.field_binding'];
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Engine bindings in AGENTS.md: every project adapter's roles directory + the spend fields. */
function bindings(root) {
  const E = require('../../../.forma/dashboard/lib/engines.cjs');
  const dirs = new Set(E.loadAdapters(root).map((a) => E.sourcesOf(a).rolesDir).filter(Boolean));
  return [...[...dirs].map((d) => [new RegExp(esc(d) + '/'), msg('root-rules.path_binding', { dir: d })]), FIELD_BINDING];
}
const CLAUDE_RULES_REL = '.claude/rules/claude-8.md';
const IMPORT_RE = /^@AGENTS\.md\s*$/m;

const exists = (root, rel) => fs.existsSync(path.join(root, rel));

/** AGENTS.md: present, the §1-7 sections in place, no §8 and no concrete engine's paths/fields inside. */
function lawProblems(agents, root) {
  const problems = [];
  for (const sec of SECTIONS) if (!agents.includes(sec)) problems.push(msg('root-rules.law_no_section', { section: sec }));
  if (/## 8\./.test(agents)) problems.push(msg('root-rules.law_has_8'));
  for (const [re, what] of bindings(root)) {
    if (re.test(agents)) problems.push(msg('root-rules.law_engine_bound', { what }));
  }
  return problems;
}

/**
 * The §8 files to check. Claude Code has two lawful constructions: "root" - a CLAUDE.md with the @AGENTS.md line
 * (works everywhere, including environments without native reading), and "rules catalog" - no CLAUDE.md in the root,
 * the engine reads AGENTS.md (§1-7) and .claude/rules/claude-8.md (§8) by itself; the §8 file then must hold no
 * import - nobody processes it. The other engines' §8 files - by the project's adapters (`engineRulesFile`):
 * a single-Claude project is a lawful installation. The @AGENTS.md import is neither required nor forbidden for
 * them: the way the law is read is the engine's business.
 */
function engineFiles(root, claudeNativeMode) {
  return [
    claudeNativeMode
      ? { name: 'Claude Code', path: CLAUDE_RULES_REL, needsImport: false }
      : { name: 'Claude Code', path: 'CLAUDE.md', needsImport: true },
    ...require('../../../.forma/dashboard/lib/engines.cjs').loadAdapters(root)
      .filter((a) => typeof a.engineRulesFile === 'string' && a.engineRulesFile !== CLAUDE_RULES_REL)
      .map((a) => ({ name: a.engine || a.dir, path: a.engineRulesFile, needsImport: null })),
  ];
}

/** One engine's §8 file: the @AGENTS.md import where it is read, the §8 "Engine architecture", no own copy of §1-7. */
function engineFileProblems(root, item) {
  const target = item.path;
  if (!exists(root, target)) return [msg('root-rules.file_missing', { path: item.path })];
  const problems = [];
  const txt = fs.readFileSync(path.join(root, target), 'utf8');
  const head = txt.split('\n').slice(0, 3).join('\n');
  if (item.needsImport === true && !IMPORT_RE.test(head)) {
    problems.push(msg('root-rules.no_import', { target }));
  }
  if (item.needsImport === false && IMPORT_RE.test(head)) {
    problems.push(msg('root-rules.useless_import', { target }));
  }
  if (!/#\s*8\.\s*Engine architecture/.test(txt)) problems.push(msg('root-rules.no_8', { target }));
  if (/## 2\. Route/.test(txt) || /## 5\. Prohibitions/.test(txt)) {
    problems.push(msg('root-rules.own_copy', { target }));
  }
  return problems;
}

function run({ root }) {
  if (!exists(root, 'AGENTS.md')) return [msg('root-rules.no_law')];
  const problems = lawProblems(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), root);
  // The engines' root wrappers (GEMINI.md) are abolished: §8 lives in the adapter's rules file. A return - a desync, not a fallback path.
  if (exists(root, 'GEMINI.md')) problems.push(msg('root-rules.gemini_returned'));
  // The root CLAUDE.md is abolished: an engine's specifics - only in the §8 file.
  const claudeNativeMode = !exists(root, 'CLAUDE.md');
  if (!claudeNativeMode) problems.push(msg('root-rules.claude_md_abolished'));
  for (const item of engineFiles(root, claudeNativeMode)) problems.push(...engineFileProblems(root, item));
  return problems;
}

module.exports = { id: 'root-rules', since: null, run };
