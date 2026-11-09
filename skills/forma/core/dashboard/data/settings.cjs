'use strict';

/**
 * The "Project" and "Engine" tabs: read-only. "Project" - `project/config/PROJECT.md` and the goals' `GOAL.md` files;
 * "Engine" - the engine settings the adapter reads (`engineSettings`); the same adapter holds prohibition 15 (secrets have
 * only a name), plus the route catalog. No adapter - the settings are not found, not empty.
 */

const fs = require('fs');
const path = require('path');
const { readIfExists, projectFile } = require('../lib/fs.cjs');
const i18n = require('../../i18n/index.cjs');
const { parseFrontmatter } = require('../lib/card.cjs');
const engines = require('../lib/engines.cjs');
const { readRoutesCatalog } = require('./routes.cjs');

const { UNKNOWN } = engines;

/** The nodes' rig: a row counts as empty if all columns but the node's name are empty. */
function toolingView(tooling) {
  return {
    columns: tooling ? tooling.columns : [],
    rows: tooling ? tooling.rows.filter((r) => r.slice(1).some((c) => c)) : [],
    total: tooling ? tooling.rows.length : 0,
  };
}

const ORIGIN = { core: '\u044f\u0434\u0440\u043e', project: '\u043f\u0440\u043e\u0435\u043a\u0442', unknown: '—' };

/**
 * The project's skills - from the engine's skill catalog: the folder name and the `description` from `SKILL.md`. There is no separate inventory.
 * The origin marker: "core" - the name is among the skills the template supplies (the list is given by the adapter, `templateSkills`; it travels
 * with the installed adapter, the .forma/protocol/ clone is not needed), otherwise "project". The adapter declared no list - there is
 * no source, and the marker is "-", not a silent "project".
 */
function readSkills(projectRoot) {
  const dir = engines.firstPath(projectRoot, 'skillsDir');
  const columns = ['\u0423\u043c\u0435\u043d\u0438\u0435', '\u041f\u0440\u0438\u0437\u043d\u0430\u043a', '\u041e\u043f\u0438\u0441\u0430\u043d\u0438\u0435'];
  if (!dir) return { columns, rows: [], dirs: UNKNOWN };
  const tpl = engines.first(projectRoot, 'templateSkills');
  const fromTemplate = Array.isArray(tpl) ? new Set(tpl) : null;
  const names = fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort() : [];
  const rows = names.map((n) => {
    const fm = parseFrontmatter(readIfExists(path.join(dir, n, 'SKILL.md'), ''));
    const d = typeof fm.description === 'string' ? fm.description.replace(/\s+/g, ' ').trim() : '';
    const origin = !fromTemplate ? ORIGIN.unknown : fromTemplate.has(n) ? ORIGIN.core : ORIGIN.project;
    return [n, origin, d.length > 160 ? d.slice(0, 157) + '...' : d];
  });
  return { columns, rows, dirs: names.length };
}

/** Goals with the "end-image is a draft" marker. */
function readGoalDrafts(projectRoot) {
  const goalsDir = path.join(projectRoot, 'project', 'goals');
  const goals = [];
  if (!fs.existsSync(goalsDir)) return goals;
  for (const d of fs.readdirSync(goalsDir).sort()) {
    const g = readIfExists(path.join(goalsDir, d, 'GOAL.md'), null);
    if (!g) continue;
    goals.push({ id: d, draft: String(parseFrontmatter(g).draft) === 'true' });
  }
  return goals;
}

function readProjectSettings(projectRoot) {
  const raw = readIfExists(projectFile(projectRoot, 'PROJECT.md'), null);
  if (!raw) return { present: false };
  const md = i18n.reader(raw);
  const tpl = md.table('template');
  const thr = md.table('thresholds');
  const skills = readSkills(projectRoot);
  return {
    present: true,
    source: 'project/config/PROJECT.md',
    language: md.inline('language'),
    template: { name: i18n.rowValue(tpl, 'name'), status: i18n.rowValue(tpl, 'status') },
    thresholds: { attempts: i18n.rowValue(thr, 'attempts'), volume: i18n.rowValue(thr, 'volume') },
    release: md.trailingNumber('release'),
    epics: md.table('epics'),
    services: md.table('services'),
    tooling: toolingView(md.table('tooling')),
    references: md.table('references'),
    skills: { columns: skills.columns, rows: skills.rows },
    skillDirs: skills.dirs,
    goals: readGoalDrafts(projectRoot),
  };
}

const NO_ENGINE_SETTINGS = {
  present: false, env: [], hooks: [], nodes: [], skills: [],
  mcp: { project: [], user: [], userProject: [] }, check: { ran: false },
};

// The newest file in the directory (shallow); no directory - 0.
function newestMtime(dir) {
  let best = 0;
  const walk = (d, depth) => {
    let list = [];
    try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (depth < 2) walk(p, depth + 1); continue; }
      try { best = Math.max(best, fs.statSync(p).mtimeMs); } catch { /* the file vanished - skip */ }
    }
  };
  walk(dir, 0);
  return best;
}

// The tab's engine - the one whose last session is freshest; without transcripts - the first that declared settings.
function activeAdapter(projectRoot) {
  const list = engines.loadAdapters(projectRoot).filter((a) => typeof a.engineSettings === 'function');
  let pick = list[0] || null, best = -1;
  for (const a of list) {
    let dir = null;
    try { dir = typeof a.transcriptsDir === 'function' ? a.transcriptsDir(projectRoot) : null; } catch { dir = null; }
    const m = dir ? newestMtime(dir) : 0;
    if (m > best) { best = m; pick = a; }
  }
  return pick;
}

function readEngineSettings(projectRoot) {
  const active = activeAdapter(projectRoot);
  const read = active ? active.engineSettings : null;
  // An adapter without engineSettings still declared the engine tag: the tag - from the active one, else from the first that declared it.
  const tag = (active ? active.engine : engines.first(projectRoot, 'engine')) || null;
  const eng = read ? read(projectRoot) : NO_ENGINE_SETTINGS;
  // a hook's description - from its script's header (as in "Structure"); no header - no description, not an invention
  const { describe } = require('../structure.cjs');
  const hookDescs = {};
  for (const h of eng.hooks || []) for (const cmd of h.commands) {
    if (!(cmd in hookDescs)) hookDescs[cmd] = describe(path.join(projectRoot, cmd));
  }
  return { ...eng, hookDescs, engine: tag || UNKNOWN, routes: readRoutesCatalog(projectRoot) };
}

module.exports = { readProjectSettings, readEngineSettings };
