#!/usr/bin/env node
// The Claude Code permission level in the project: small | medium | full (the ru names are the level keys of permission-levels.json).
// The levels' description - .claude/permission-levels.json. Writes permissions into .claude/settings.local.json - the human's file:
// touches only what the script added itself (the ledger - .claude/permission-level.state.json); the human's entries stay as they are.
//   node .claude/scripts/permissions-level.cjs <level>   - switch the level on (the previous level is removed)
//   node .claude/scripts/permissions-level.cjs --show    - the current level and the list of levels
//   node .claude/scripts/permissions-level.cjs --off     - remove everything the script added
// Run from the project root. The PERMISSIONS_ROOT environment variable changes the root (for a test).
// Printed labels come from the core dictionary: English key in code, ru value as data.
'use strict';
const fs = require('fs');
const path = require('path');
const i18n = require([path.resolve(__dirname, '../../.forma/i18n/index.cjs'), path.resolve(__dirname, '../../../core/i18n/index.cjs')].find((p) => fs.existsSync(p)));
const msg = (code, params) => i18n.message(code, params, 'ru');

const root = process.env.PERMISSIONS_ROOT || process.cwd();
const C = path.join(root, '.claude');
const levelsFile = path.join(C, 'permission-levels.json');
const localFile = path.join(C, 'settings.local.json');
const stateFile = path.join(C, 'permission-level.state.json');

const stop = (m, code = 1) => { console.error(msg('perm.stop_prefix') + m); process.exit(code); };
const readJson = (f, what) => {
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return stop(msg('perm.not_json', { what }), 2); }
};
const writeJson = (f, o) => fs.writeFileSync(f, JSON.stringify(o, null, 2) + '\n');

const cfg = readJson(levelsFile, '.claude/permission-levels.json');
if (!cfg) stop(msg('perm.no_levels_file'), 2);

/** The level's permissions together with the inherited ones. */
function resolve(name, seen = []) {
  const l = cfg.levels[name];
  if (!l || seen.includes(name)) return stop(msg('perm.level_unknown_or_loop', { name }), 2);
  const base = l.extends ? resolve(l.extends, [...seen, name]) : { allow: [], defaultMode: null };
  return { allow: [...new Set([...base.allow, ...l.allow])], defaultMode: l.defaultMode || base.defaultMode };
}
const canonical = (w) => { const k = String(w || '').trim().toLowerCase(); return cfg.levels[k] ? k : (cfg.aliases || {})[k] || null; };

const state = readJson(stateFile, '.claude/permission-level.state.json') || { level: null, added: [], mode: null };
const local = readJson(localFile, '.claude/settings.local.json') || {};

/** Removes what the script added; the human's entries are not touched. */
function strip() {
  const perm = local.permissions || {};
  if (Array.isArray(perm.allow)) perm.allow = perm.allow.filter((e) => !state.added.includes(e));
  if (state.mode && perm.defaultMode === state.mode) delete perm.defaultMode;
  state.added = []; state.mode = null; state.level = null;
  if (local.permissions) local.permissions = perm;
}
function save() {
  const perm = local.permissions;
  if (perm && Array.isArray(perm.allow) && !perm.allow.length) delete perm.allow;
  if (perm && !Object.keys(perm).length) delete local.permissions;
  fs.mkdirSync(C, { recursive: true });
  writeJson(localFile, local);
  if (state.level) { writeJson(stateFile, state); exclude(); } else if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
}
/** The script's ledger is personal, like settings.local.json: it does not go into git (a local .git/info/exclude entry). */
function exclude() {
  const file = path.join(root, '.git', 'info', 'exclude');
  const line = '.claude/permission-level.state.json';
  try {
    const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (cur.split(/\r?\n/).includes(line)) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, (cur && !cur.endsWith('\n') ? '\n' : '') + line + '\n');
  } catch { /* no .git - nothing to exclude */ }
}

const arg = process.argv[2];
if (!arg || arg === '--help') {
  console.log(msg('perm.usage'));
  process.exit(arg ? 0 : 2);
}
if (arg === '--show') {
  console.log(msg('perm.current_level', { level: state.level || msg('perm.level_not_set') }));
  for (const n of Object.keys(cfg.levels)) console.log(`  ${n === state.level ? '*' : ' '} ${n} — ${cfg.levels[n].about}`);
  process.exit(0);
}
if (arg === '--off') { strip(); save(); console.log(msg('perm.off_done')); process.exit(0); }

const name = canonical(arg);
if (!name) stop(msg('perm.unknown_level_arg', { arg, levels: Object.keys(cfg.levels).join(', ') }), 2);
strip();
const { allow, defaultMode } = resolve(name);
local.permissions = local.permissions || {};
const have = Array.isArray(local.permissions.allow) ? local.permissions.allow : [];
const fresh = allow.filter((e) => !have.includes(e)); // what the human already holds - not ours, will not be stripped
local.permissions.allow = [...have, ...fresh];
state.added = fresh;
if (defaultMode && !local.permissions.defaultMode) { local.permissions.defaultMode = defaultMode; state.mode = defaultMode; }
state.level = name;
save();
console.log(msg('perm.level_on', { name, count: fresh.length }) + (state.mode ? msg('perm.mode_on', { mode: state.mode }) : '') + '.');
console.log(msg('perm.effective_line'));
