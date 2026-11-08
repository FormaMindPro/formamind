'use strict';

// The environment: Kimi Code. The adapter's economy-contract conformance test is run by adapter-conformance itself
// (it finds the test by the adapter's testsDir); this check is the kimi zone's construction, as codex.cjs is for
// Codex: §8 leans on AGENTS.md and holds no copy of §1-7 of its own, the native agents of the six roles and the
// hooks are in place. Findings are info notes (ctx.info), not violations; the check never returns a violation.
// Finding labels come from the core dictionary: English key in code, ru value as data.

const fs = require('fs');
const path = require('path');
const { isDormant } = require('./support/dormant.cjs');
const roots = require('./support/engine-roots.cjs');
const i18n = require('../../../.forma/i18n/index.cjs');
const msg = (code, params) => i18n.message(code, params, 'ru');

const ENGINE_ID = 'kimi';
const AGENT_NAMES = ['intent', 'spec', 'kit', 'run', 'core', 'extractor'];
const HOOK_FILES = ['kimi-ledger.cjs', 'kimi-session-start.cjs'];

/** The check's paths - from the kimi adapter; no adapter but the folder exists - by convention. null - the environment is not wired. */
function ctxOf(root) {
  const mine = roots.find(root, ENGINE_ID);
  const dir = mine ? mine.dir : '.' + ENGINE_ID;
  if (!fs.existsSync(path.join(root, dir))) return null;
  return {
    id: ENGINE_ID,
    name: 'Kimi Code',
    dir,
    eight: (mine && mine.adapter.engineRulesFile) || `${dir}/rules/kimi-8.md`,
    agentsCode: `${dir}/agents-code`,
    hooks: `${dir}/hooks`,
    skillsDir: (mine && mine.adapter.sources && mine.adapter.sources.skillsDir) || '.agents/skills',
  };
}

/** §8 does not replace the law and leans on AGENTS.md - the same contract as codex.cjs. */
function eightProblems(root, c) {
  const abs = path.join(root, c.eight);
  if (!fs.existsSync(abs)) return [msg('kimi.no_8', { eight: c.eight })];
  const eight = fs.readFileSync(abs, 'utf8');
  const problems = (eight.match(/^#{1,3}\s*(§?\s*)?[1-7][.\s·]/gm) || [])
    .map((m) => msg('kimi.own_law_copy', { eight: c.eight, found: m.trim() }));
  if (!/AGENTS\.md/.test(eight)) {
    problems.push(msg('kimi.no_law_reference', { eight: c.eight }));
  }
  return problems;
}

/** Natively discoverable agents of the six roles - what extra_agent_dirs serves the engine (the sync - the adapter test). */
function agentsCodeProblems(root, c) {
  return AGENT_NAMES
    .filter((name) => !fs.existsSync(path.join(root, c.agentsCode, `${name}.md`)))
    .map((name) => msg('kimi.no_agent', { path: `${c.agentsCode}/${name}.md` }));
}

function hooksProblems(root, c) {
  return HOOK_FILES
    .filter((f) => !fs.existsSync(path.join(root, c.hooks, f)))
    .map((f) => msg('kimi.no_hook', { path: `${c.hooks}/${f}` }));
}

function run({ root, info }) {
  // No environment - nothing to check: Kimi Code may be unused, that is the norm.
  const c = ctxOf(root);
  if (!c) return [];
  // Sleeping mode (`.forma/engines.json`): the environment is in place but not reconciled.
  if (isDormant(root, c.id)) { if (info) info.push(msg('kimi.dormant', { name: c.name })); return []; }
  const notes = [...eightProblems(root, c), ...agentsCodeProblems(root, c), ...hooksProblems(root, c)];
  if (!fs.existsSync(path.join(root, c.skillsDir))) notes.push(msg('kimi.no_skills_dir', { dir: c.skillsDir }));
  if (info) info.push(...notes.map((l) => msg('kimi.info_line', { name: c.name }) + l));
  return [];
}

module.exports = { id: ENGINE_ID, since: null, run };
