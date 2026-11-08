'use strict';

// The third environment: Codex. It reads the full canonical Claude text by reference; its Markdown files are not
// abridged copies but short executable adapters of the mechanics. So what is checked is the referential construction,
// not the edit time and not a "reconciled" mark: a change of the Claude body is available to Codex at once, and a
// broken reference must fail.
// Findings are info notes (`ctx.info`), not violations; the check never returns a violation.
// Finding labels come from the core dictionary: English key in code, ru value as data.

const fs = require('fs');
const path = require('path');
const { walk } = require('../../../.forma/dashboard/lib/fs.cjs');
const { isDormant } = require('./support/dormant.cjs');
const roots = require('./support/engine-roots.cjs');
const engines = require('../../../.forma/dashboard/lib/engines.cjs');
const i18n = require('../../../.forma/i18n/index.cjs');
const msg = (code, params) => i18n.message(code, params, 'ru');

const ROLE_NAMES = ['intent', 'spec', 'kit', 'run', 'core', 'extractor'];
const ENGINE_ID = 'codex';
const SKILLS_MIRROR_ID = 'gemini'; // Codex reads skills from the catalog declared by this engine's adapter

/**
 * The check's paths: with a Codex adapter - from its `sources`/`engineRulesFile`; no adapter but the folder exists -
 * by convention, engines.cjs on the engine's behalf. The roles source and the skills catalog - from the own and the
 * mirror engines' adapters.
 * null - Codex is not wired or there is nothing to reconcile with.
 */
function ctxOf(root) {
  const mine = roots.find(root, ENGINE_ID);
  const dir = mine ? mine.dir : '.' + ENGINE_ID;
  if (!fs.existsSync(path.join(root, dir))) return null;
  const base = roots.own(root);
  if (!base) return null;
  const src = mine ? mine.src : engines.sourcesOf({ id: ENGINE_ID, dir });
  const rules = (mine && mine.adapter.engineRulesFile) || `${dir}/${ENGINE_ID.toUpperCase()}-8.md`;
  const mirror = roots.find(root, SKILLS_MIRROR_ID);
  const rolesDir = mine && mine.adapter.sources ? mine.adapter.sources.rolesDir : `${dir}/roles`; // the Codex adapters are short, next to the subagent definitions
  return {
    id: ENGINE_ID,
    name: ENGINE_ID.charAt(0).toUpperCase() + ENGINE_ID.slice(1),
    dir,
    baseRoles: base.src.rolesDir,
    baseOnDemand: base.src.onDemandRolesDir || `${base.src.rolesDir}/on-demand`,
    baseSkills: base.src.skillsDir,
    skillsTarget: (mine && mine.adapter.sources && mine.adapter.sources.skillsDir) || (mirror ? mirror.src.skillsDir : null),
    tomlDir: `${dir}/agents`,
    rolesDir,
    onDemandDir: `${rolesDir}/on-demand`,
    compat: `${dir}/${base.id.toUpperCase()}-COMPAT.md`,
    eight: rules,
    cfg: `${dir}/config.toml`,
    _src: src,
  };
}

const sortedFiles = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort() : []);
const treeFiles = (dir) => walk(dir).sort();

/** 1. Completeness and the executable reference: the roles in two shapes - a subagent definition and an adapter referencing the Claude role. */
function roleProblems(root, c) {
  const problems = [];
  for (const role of ROLE_NAMES) {
    const toml = `${c.tomlDir}/${role}.toml`;
    const md = `${c.rolesDir}/${role}.md`;
    if (!fs.existsSync(path.join(root, toml))) problems.push(msg('codex.no_subagent', { path: toml }));
    if (!fs.existsSync(path.join(root, md))) { problems.push(msg('codex.no_role_adapter', { path: md })); continue; }
    const adapter = fs.readFileSync(path.join(root, md), 'utf8');
    if (!adapter.includes(`${c.baseRoles}/${role}.md`)) problems.push(msg('codex.no_canonical_ref', { path: md }));
    if (!adapter.includes(c.compat)) problems.push(msg('codex.no_compat_ref', { path: md, compat: path.posix.basename(c.compat) }));
  }
  return problems;
}

/** 2a. §8 does not replace the law and leans on AGENTS.md. */
function eightProblems(root, c) {
  const EIGHT_REL = c.eight;
  const abs = path.join(root, EIGHT_REL);
  if (!fs.existsSync(abs)) return [msg('codex.no_8', { eight: EIGHT_REL })];
  const eight = fs.readFileSync(abs, 'utf8');
  // No own copy of §1-7: the law is one, in AGENTS.md.
  const problems = (eight.match(/^#{1,3}\s*(§?\s*)?[1-7][.\s·]/gm) || [])
    .map((m) => msg('codex.own_law_copy', { eight: EIGHT_REL, found: m.trim() }));
  if (!/AGENTS\.md/.test(eight)) {
    problems.push(msg('codex.no_law_reference', { eight: EIGHT_REL }));
  }
  return problems;
}

/** 2b. The config references AGENTS.md and CODEX-8.md. */
function configProblems(root, c) {
  const CFG_REL = c.cfg;
  const abs = path.join(root, CFG_REL);
  if (!fs.existsSync(abs)) return [msg('codex.no_config', { path: CFG_REL })];
  const cfg = fs.readFileSync(abs, 'utf8');
  const problems = [];
  if (!/AGENTS\.md/.test(cfg)) problems.push(msg('codex.cfg_no_law', { path: CFG_REL }));
  const eightName = path.posix.basename(c.eight);
  if (!cfg.includes(eightName)) problems.push(msg('codex.cfg_no_8', { path: CFG_REL, eight: eightName }));
  return problems;
}

/** 3. The on-demand layer carries the same referential contract as the roles. */
function onDemandProblems(root, c) {
  const CLAUDE_ON_DEMAND_DIR = c.baseOnDemand;
  const CODEX_ON_DEMAND_DIR = c.onDemandDir;
  const COMPAT = c.compat;
  const claudeDir = path.join(root, CLAUDE_ON_DEMAND_DIR);
  const codexDir = path.join(root, CODEX_ON_DEMAND_DIR);
  if (!fs.existsSync(claudeDir)) return [];
  const claudeFiles = sortedFiles(claudeDir);
  if (!fs.existsSync(codexDir)) {
    return [msg('codex.no_on_demand_dir', { dir: CODEX_ON_DEMAND_DIR, count: claudeFiles.length })];
  }
  const problems = [];
  for (const f of claudeFiles) {
    const dstRel = `${CODEX_ON_DEMAND_DIR}/${f}`;
    const dstAbs = path.join(root, dstRel);
    if (!fs.existsSync(dstAbs)) { problems.push(msg('codex.on_demand_missing', { path: dstRel })); continue; }
    const adapter = fs.readFileSync(dstAbs, 'utf8');
    if (!adapter.includes(`${CLAUDE_ON_DEMAND_DIR}/${f}`)) problems.push(msg('codex.on_demand_no_ref', { path: dstRel }));
    if (!adapter.includes(COMPAT)) problems.push(msg('codex.on_demand_no_compat', { path: dstRel }));
  }
  for (const f of sortedFiles(codexDir)) {
    if (!claudeFiles.includes(f)) problems.push(msg('codex.on_demand_extra', { path: `${CODEX_ON_DEMAND_DIR}/${f}` }));
  }
  return problems;
}

/** The skill `name` from the base's skills catalog is available in the Codex skills catalog - the same composition and content. */
function skillMirrorProblems(root, c, name) {
  const source = path.join(root, c.baseSkills, name);
  const target = path.join(root, c.skillsTarget, name);
  if (!fs.existsSync(target)) return [msg('codex.no_skill_mirror', { dir: c.skillsTarget, name })];
  const sourceFiles = treeFiles(source);
  if (sourceFiles.join('\n') !== treeFiles(target).join('\n')) {
    return [msg('codex.skill_files_diverge', { dir: c.skillsTarget, name, base: c.baseSkills })];
  }
  for (const rel of sourceFiles) {
    if (!fs.readFileSync(path.join(source, rel)).equals(fs.readFileSync(path.join(target, rel)))) {
      return [msg('codex.skill_content_diverges', { dir: c.skillsTarget, name, rel })];
    }
  }
  return [];
}

/** 4. The Claude skills are available through the standard Codex skills path. */
function skillProblems(root, c) {
  if (!c.skillsTarget) return [];
  const dir = path.join(root, c.baseSkills);
  if (!fs.existsSync(dir)) return [];
  const names = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  return names.flatMap((name) => skillMirrorProblems(root, c, name));
}

function run({ root, info }) {
  // No environment - nothing to check: Codex may be unused, that is the norm.
  const c = ctxOf(root);
  if (!c) return [];
  // Sleeping mode (`.forma/engines.json`): the environment is in place but not reconciled.
  if (isDormant(root, c.id)) { if (info) info.push(msg('codex.dormant', { name: c.name })); return []; }
  const notes = [...roleProblems(root, c), ...eightProblems(root, c), ...configProblems(root, c), ...onDemandProblems(root, c), ...skillProblems(root, c)];
  if (info) info.push(...notes.map((l) => msg('codex.info_line', { name: c.name }) + l));
  return [];
}

module.exports = { id: ENGINE_ID, since: null, run };
