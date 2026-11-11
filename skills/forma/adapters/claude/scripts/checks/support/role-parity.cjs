'use strict';

// Claude<->Gemini role parity - an info note, not a violation: the roles are equal by content, compared by
// normalized text. Codex reads the Claude roles by reference and is checked by the `codex` check. Not a registry
// check but a table the reconciliation prints.
// Table labels come from the core dictionary: English key in code, ru value as data.

const fs = require('fs');
const path = require('path');
const i18n = require('../../../../.forma/i18n/index.cjs');
const msg = (code, params) => i18n.message(code, params, 'ru');

const roots = require('./engine-roots.cjs');
const { isDormant } = require('./dormant.cjs');

const CORE_ROLES = ['core', 'intent', 'kit', 'run', 'spec', 'extractor'];
const RULE = '----------------------------------------------------------------------';

// The five standing roles (the root rules are no longer a pair - they live in AGENTS.md, one file) - the hard list stays:
// this is not a growing catalog, a new role is not created by itself but by the human's decision.
const titleCase = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const mdFiles = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.md')) : []);

// The pairs are built by the adapters (engines.cjs): the base - the engine in whose folder the check lies, paired
// with every other engine that has a roles folder. A fourth engine wired in lands in the reconciliation without
// editing this file; no adapter - no pair.
function pairsFor(root, base, peer) {
  const bRoles = base.src.rolesDir;
  const bOnDemand = base.src.onDemandRolesDir || `${bRoles}/on-demand`;
  const pRoles = peer.src.rolesDir;
  const pOnDemand = peer.src.onDemandRolesDir || `${pRoles}/on-demand`;
  const core = CORE_ROLES.map((role) => ({
    name: `Agent: ${titleCase(role)}`, base: `${bRoles}/${role}.md`, peer: `${pRoles}/${role}.md`, type: 'agent',
  }));
  // The on-demand layer grows without editing this script: it scans both directories, matching by file name.
  // A file existing on one side only still enters a pair - comparePair() sees it as
  // missing_<engine>, never silently skips it.
  const names = new Set([...mdFiles(path.join(root, bOnDemand)), ...mdFiles(path.join(root, pOnDemand))]);
  const onDemand = [...names].sort().map((file) => {
    const display = file.replace(/.md$/, '').split('-').map(titleCase).join(' ');
    return { name: `On-Demand: ${display}`, base: `${bOnDemand}/${file}`, peer: `${pOnDemand}/${file}`, type: 'on-demand' };
  });
  return [...core, ...onDemand].map((p) => ({ ...p, from: base.id, to: peer.id }));
}

/** Path normalization over all the project's adapters: roles folder, on-demand, skills, hooks, rules file, engine root. */
function pathNormalizers(root) {
  const all = roots.list(root);
  const re = (p, tail = '') => new RegExp(roots.escapeRe(p) + tail, 'g');
  const out = [];
  const add = (p, to, tail) => { if (p) out.push([re(p, tail), to]); };
  for (const e of all) { // the engine's rules file: the full path, then the name
    const rules = e.adapter.engineRulesFile;
    if (rules) { add(rules, 'ENGINE_RULES.md'); add(path.posix.basename(rules), 'ENGINE_RULES.md'); }
  }
  for (const e of all) add(`${e.src.onDemandRolesDir || e.src.rolesDir + '/on-demand'}/`, 'AGENTS_DIR/on-demand/');
  for (const e of all) {
    add(`${e.dir}/hooks/guard-delete.sh`, 'HOOK_GUARD');
    add(`${e.dir}/hooks/guard-delete.ps1`, 'HOOK_GUARD');
    add(`${e.dir}/hooks/.delete-unlock`, 'HOOK_UNLOCK');
  }
  for (const e of all) add(`${e.src.skillsDir}/`, 'SKILLS_DIR/');
  for (const e of all) add(`${e.src.rolesDir}/`, 'AGENTS_DIR/');
  for (const e of all) add(`${e.dir}/`, 'ENGINE_DIR/');
  // The project's extensions folder and the engine tag in the spend line are named by the engine's name - not a meaning divergence.
  for (const e of all) add(`project/extensions/${e.dir.replace(/^./, '')}/`, 'project/extensions/ENGINE_ID/');
  for (const e of all) add(`${e.adapter.spendTag || e.adapter.engine}:`, 'ENGINE_TAG:');
  for (const e of all) add(`${path.posix.basename(e.src.skillsDir)}/`, 'SKILLS_DIR/');
  return out;
}

// What differs between two engines' roles without being a meaning divergence: file and directory names, the way a
// tool is called, phrasing about the environment. The row order is the application order.
// Paths (engine, roles, skills, hooks folders, the rules file) are normalized by `pathNormalizers` - by the
// project's adapters; here - what is not a path: rules file names in text and phrasing about the environment.
const NORMALIZERS_BEFORE_PATHS = [
  [/CLAUDE\.md/g, 'ENGINE_RULES.md'],
  [/GEMINI\.md/g, 'ENGINE_RULES.md'],
  [/\s*\((Gemini Engine|Claude Code|Kimi Engine)\)/g, ''],
];
// Tool equivalence as data: each row is one action that engines name differently. A name in a row reads as the
// row's first word in both texts; any other difference stays a drift. Add a row for a new pair — no code change.
const TOOL_EQUIVALENCE = [
  ['SendMessage', 'task_append'], // continue the live call of a node by its id
];
// Role equivalence as data: a source-engine role with no pair in the mirror, because the mirror engine carries its own
// analogue under another name. Each row is [source role, mirror analogue]; the generator skips the source role.
const ROLE_EQUIVALENCE = [
  ['plumb-haiku', 'plumb-gemini'], // the Plumb's built-in executor, one per engine
];
const toolRules = (table = TOOL_EQUIVALENCE) => table.flatMap(([canon, ...names]) => names.map((n) => [new RegExp(`\\b${roots.escapeRe(n)}\\b`, 'g'), canon]));

const AGENT_NORMALIZERS = [
  [/\b[A-Za-z]+-8\.md/g, 'ENGINE_RULES.md'], // §8 of any engine is `<engine>-8.md`; named without a path it needs no adapter to be read
  [/\bplumb-glmflash\b/g, 'plumb-haiku'], // the Plumb's built-in executor is named after each engine's own small model (plumb-gemini, plumb-glmflash)
  [/\bPlumb on `?(?:gemini-3\.8-flash(?: \(low\))?|minimax-m3\.1-flash|glm-4-flash|haiku)`?(?: or OpenRouter `?jev`?|\/`?jev`?)/g, 'Plumb on haiku/jev'],
  [/agents\/on-demand\//g, 'AGENTS_DIR/on-demand/'],
  [/\bagents\//g, 'AGENTS_DIR/'],
  [/(\b(intent|spec|kit|run|core)\.md\b)/g, 'AGENTS_DIR/$1'],
  [/AGENTS_DIR\/AGENTS_DIR\//g, 'AGENTS_DIR/'],
  [/skills already available in (Claude Code|the environment)/g, 'skills already available in the environment'],
  [/call `?Skill`?/g, 'call the skill'],
  [/global ones \([^)]+\) and plugin ones \([^)]+\)/g, 'global and plugin ones'],
  [/Bash\((node [^)]+)\)/g, '$1'],
  [/Cost is checked with `simulate_cost`/g, 'Cost is checked'],
  [/the (Antigravity )?plugin marketplace/g, 'the plugin marketplace'],
  [/connected plugin sources( \([^)]+\)|, where the platform provides them)?/g, 'connected plugin sources'],
  [/\(`?new_page`?\s*\+\s*`?take_snapshot`?\)/g, '(`browser_tool`)'],
  [/\(`?browser_subagent`?\)/g, '(`browser_tool`)'],
  [/\(`extractor\.md`(, `omitClaudeMd: true`)?\)/g, '(`extractor.md`)'],
  [/the browser \(`browser_tool`\) is a fallback/g, 'the browser is a fallback'],
  [/## After work \(the "Result" section\)/g, '## After work'],
  [/, read on demand, never entering the cycle cache/g, ''],
  [/The bridge \([^)]+\) stays with you/g, 'The external bridge stays with you'],
  [/The bridge stays with you/g, 'The external bridge stays with you'],
  [/The bridge stays available to you/g, 'The external bridge stays with you'],
  [/The external channel stays available to you/g, 'The external bridge stays with you'],
  [/The bridge \([^)]+\)/g, 'The external bridge'],
  [/the text-to-text bridge gives no live access/g, 'the text-to-text external channel gives no live access'],
  [/internal model \(Agent tool\)/g, 'internal model'],
  [/, local `Bash`/g, ''],
  [/\(needs `execute-php`\/Novamira abilities — you deliberately don't have these, only the `Aura` catalog\)/g, "(needs site access you deliberately don't have)"],
  [/`?Spec`? also keeps the bridge/g, '`Spec` also keeps the external channel'],
  [/set your own tier to (the strongest one|`?strongest`?)( in `?AGENTS_DIR\/kit\.md`?)?/g, 'set your own tier to the strongest one'],
  [/A plugin (from `?claude plugin marketplace`?|connected globally to the environment)/g, 'A plugin from marketplace'],
  [/(A plugin from the marketplace|A globally-connected plugin) goes the same way/g, 'A marketplace/global plugin goes the same way'],
  [/already available (in Claude Code|to the environment)/g, 'already available in the environment'],
  [/call (the skill|it), copy/g, 'call the skill, copy'],
  [/node (ENGINE_DIR\/scripts|dashboard)\/tally\.cjs( \*)?/g, 'node ENGINE_DIR/scripts/tally.cjs'],
  [/Every bridge call is also an attempt[\s\S]*?never by eye\./g, 'Every external call is an attempt, caller writes line.'],
  [/Every call through the external channel is also an attempt[\s\S]*?never by eye\./g, 'Every external call is an attempt, caller writes line.'],
];

/** The text readied for comparison: no line-ending or trailing-space differences; for roles - no engine differences either. */
function normalizeText(text, type, pathRules = [], tools = toolRules()) {
  let norm = text.replace(/\r\n/g, '\n');
  norm = norm.split('\n').map((l) => l.trimEnd()).join('\n').trim();
  if (type === 'agent' || type === 'on-demand') {
    for (const [re, to] of [...NORMALIZERS_BEFORE_PATHS, ...pathRules, ...AGENT_NORMALIZERS, ...tools]) norm = norm.replace(re, to);
    // The frontmatter's specific fields (model, tools, effort) are ignored
    norm = norm.replace(/^---[\s\S]*?---\n/m, '');
  }
  return norm;
}

/** The first three diverging lines of two texts, for diagnostics. */
function lineDiffs(baseNorm, peerNorm) {
  const bLines = baseNorm.split('\n');
  const pLines = peerNorm.split('\n');
  const max = Math.max(bLines.length, pLines.length);
  const diffs = [];
  for (let i = 0; i < max; i++) {
    if (bLines[i] === pLines[i]) continue;
    diffs.push(`Line ${i + 1}:\n  <base>: ${bLines[i] || '[EOF]'}\n  <peer>: ${pLines[i] || '[EOF]'}`);
    if (diffs.length >= 3) {
      diffs.push(msg('role-parity.total_diffs', { count: Math.abs(bLines.length - pLines.length) + diffs.length }));
      break;
    }
  }
  return diffs.join('\n');
}

/**
 * Own roles of an engine, read by one rule from its rules file (§8): a paragraph that says a role is "written by
 * this zone" declares every backticked `<rolesDir>/…md` path in it as the engine's own role (not a mirror).
 * Returns a Set of project-relative posix paths.
 */
function ownRolesOf(root, peer) {
  const out = new Set();
  const rules = peer.adapter.engineRulesFile;
  const file = rules && path.join(root, rules);
  if (!file || !fs.existsSync(file) || !peer.src.rolesDir) return out;
  const prefix = peer.src.rolesDir.replace(/\/+$/, '') + '/';
  for (const para of fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split(/\n\s*\n/)) {
    if (!/written by this zone/i.test(para.replace(/\s+/g, ' '))) continue;
    for (const m of para.matchAll(/`([^`\s]+\.md)`/g)) if (m[1].startsWith(prefix)) out.add(m[1]);
  }
  return out;
}

/** A pair of files: `{ status: synced|drift|missing_*, diff }`. */
function comparePair(root, pair, pathRules = pathNormalizers(root), own = new Set(), tools = toolRules()) {
  const basePath = path.join(root, pair.base);
  const peerPath = path.join(root, pair.peer);
  const baseExists = fs.existsSync(basePath);
  const peerExists = fs.existsSync(peerPath);
  if (!baseExists && !peerExists) return { status: 'missing_both', diff: 'Both files missing' };
  if (!baseExists) return { status: 'missing_' + pair.from, diff: `Missing ${pair.base}` };
  if (!peerExists) return { status: 'missing_' + pair.to, diff: `Missing ${pair.peer}` };
  if (own.has(pair.peer)) return { status: 'own', diff: null }; // declared in the engine's §8: its own role, not a mirror
  const baseNorm = normalizeText(fs.readFileSync(basePath, 'utf8'), pair.type, pathRules, tools);
  const peerNorm = normalizeText(fs.readFileSync(peerPath, 'utf8'), pair.type, pathRules, tools);
  if (baseNorm === peerNorm) return { status: 'synced', diff: null };
  return { status: 'drift', diff: lineDiffs(baseNorm, peerNorm) };
}

/** All the project's role pairs and each one's reconciliation verdict: `[{ pair, res }]`. */
function compareRoles(root, { only } = {}) {
  const base = roots.own(root);
  if (!base || !base.src.rolesDir) return [];
  const pathRules = pathNormalizers(root);
  return roots.peers(root).filter((p) => !isDormant(root, p.id) && (!only || [].concat(only).includes(p.id))).flatMap((peer) => {
    const own = ownRolesOf(root, peer);
    return pairsFor(root, base, peer).map((pair) => ({ pair, res: comparePair(root, pair, pathRules, own) }));
  });
}

/** The parity table's header and lines - in print order. */
function parityTable(results) {
  const lines = [
    msg('role-parity.header', { pairs: [...new Set(results.map(({ pair }) => pair.from + '↔' + pair.to))].join(', ') || msg('role-parity.no_pairs') }),
    msg('role-parity.col_header'),
    '|---|---|---|---|',
  ];
  for (const { pair, res } of results) {
    const icon = res.status === 'synced' ? msg('role-parity.st_synced') : res.status === 'own' ? msg('role-parity.st_own') : msg('role-parity.st_drift', { status: res.status });
    lines.push(`| ${pair.name.padEnd(25)} | ${pair.base.padEnd(35)} | ${pair.peer.padEnd(45)} | ${icon} |`);
  }
  return lines;
}

/** The drift lines by pair (for `--diff`). */
function driftDetails(results) {
  const lines = [];
  for (const { pair, res } of results) {
    if (res.status === 'synced' || res.status === 'own' || !res.diff) continue;
    lines.push(`--- [ ${pair.name} ] ---`, res.diff, RULE + '\n');
  }
  return lines;
}

module.exports = { RULE, compareRoles, comparePair, normalizeText, ownRolesOf, toolRules, TOOL_EQUIVALENCE, ROLE_EQUIVALENCE,parityTable, driftDetails };
