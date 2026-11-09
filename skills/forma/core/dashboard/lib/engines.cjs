'use strict';

/**
 * The core - engine adapter boundary. The core knows neither the engine's name nor its adapter's directory:
 * it asks the adapters for what only the engine knows and lives without an answer.
 *
 * Search: `loadAdapters(root)` goes over the project root's directories whose name starts with a dot
 * and connects `<dir>/forma-adapter.cjs` if it is there. The module not found or thrown at load -
 * there is no adapter, that is not a fall. The order is by the directory's name.
 *
 * The adapter's shape is an object with optional fields. Paths - from the project root, through `/`.
 * No field or no adapter - the core puts `unknown` (as a string) into the datum, or an empty list
 * where the UI waits for a list; a zero and `null` do not go into a number's place.
 *
 *   field                  what it is                                      when absent
 *   engine                 the engine's tag, a string ('claude-code')      'unknown'
 *   instructionWeight()    the weight of the law and the role per call step: { common,   no weight block is
 *                          byNode: { Node: { perStep } } }                 built, 'unknown' in the datum
 *   stepsFromCacheRead(cacheRead, perStep) - the step count by cache read  'unknown'
 *   toolUsage              the tool journal's parsing: { source,           the tier of "Board" nodes without
 *                          readDeclared(dirAbs), readLog(fileAbs),         a source (source: null)
 *                          baseName(decl) }
 *   parseUsage(step)       a transcript step -> { tokens_in, tokens_out,   the transcript's spend - null
 *                          cache_read, cache_write }
 *   transcriptsDir(root)   the project's transcripts directory, absolute | null  no transcripts
 *   mainSessions(root)     the main session's journals: [{ id, file }] -    the engine's main journal
 *                          without subagent ones; the layout knows the adapter  is not read
 *   mainStepOf(line, prev) a main session journal entry -> a normalized step
 *                          { ts, key, usage, toolCalls, human, model }      (the same group)
 *   rolesDir               the nodes' roles directory                      the roles are not read
 *   onDemandRolesDir       the "on occasion" roles' directory              not read
 *   engineRulesFile        the §8 file - the engine's rules                the text is empty
 *   skillsDir              the project's skills directory                  'unknown' instead of a number
 *   templateSkills         the names of skills the template supplies (a list)  the skills mark "-"
 *   syncScript             the engines' sync script; called with --check   the sync is not run
 *   usageRefresh           [{ script, args, cache }] - scripts that         the spend caches are not
 *                          refresh the dialog spend cache in .forma/dashboard/.cache  refreshed by the core
 *   mcpConfigs(root)       [{ rel, file, level }] - MCP server files       no servers, an empty list
 *   engineSettings(root)   { present, env, hooks, nodes, skills, mcp,      present: false, empty lists
 *                          check } - the "Engine" tab
 *   formaRoles(root)       { title, nodes[], runRoles[], runNote, rolesMissing,  no engine tab
 *                          plugins? } - the roles snapshot for the "Forma" tab;
 *                          a tab per each adapter carrying the field
 *   structure              { key, title, note, roots, notes } - a group     no group in "Structure"
 *                          of the "Structure" tree; notes - the directories' captions
 *   id                     the engine's name for `check <engine>`, a string  the directory's name without the dot
 *   spendTag               the engine's label in the §3 spend line after the dash  the `engine` value
 *   sources                { rolesDir, onDemandRolesDir, runRolesDir,      values by convention
 *                          scriptsDir, skillsDir, testsDir (strings),      from the adapter's directory
 *                          packageManifest (a string), mcpConfigs (a list) } (`sourcesOf`)
 *   capabilities           { subagents, sendMessage, hooks, mcp } -        the "degraded" mode
 *                          booleans; subagents: true gives the "full" mode  (`modeOf`)
 *   nodeModels             { Node: { model, effort } } for the five nodes  no table
 *   writeZones             the list of paths the engine writes to: its own folder  writes only into its own folder
 *                          and the cards (.devtool/features)               (the `check` check)
 *
 * Several adapters carry fields: single ones are taken from the first who declared them; lists are glued.
 */

const fs = require('fs');
const path = require('path');
// Canonical ru strings (the check items, the mode labels) live in the core dictionary; the language is fixed.
const { message: coreMessage } = require('../../i18n/index.cjs');
const ruMsg = (key, params) => coreMessage(key, params, 'ru');

const ADAPTER_FILE = 'forma-adapter.cjs';
const UNKNOWN = 'unknown';

/**
 * The transcript-reading fields an engine declares only when its platform provides them:
 * the layout and format of the journals belong to the engine, and the core has a fallback path for
 * every field (without findSubagent/stepOf - the `message.usage` layout; without mainSessions/
 * mainStepOf - the engine's main journal is simply not read). The strict "the whole shape is
 * declared" check (the adapters' tests) skips this group - demanding it from all would equal
 * demanding identical hosts.
 */
const TRANSCRIPT_FIELDS = ['findSubagent', 'stepOf', 'mainSessions', 'mainStepOf'];

/** The type of every shape field; `validateAdapter` checks it. */
const SHAPE = {
  engine: 'string',
  instructionWeight: 'function',
  stepsFromCacheRead: 'function',
  toolUsage: 'object',
  parseUsage: 'function',
  transcriptsDir: 'function',
  findSubagent: 'function',
  stepOf: 'function',
  mainSessions: 'function',
  mainStepOf: 'function',
  rolesDir: 'string',
  onDemandRolesDir: 'string',
  engineRulesFile: 'string',
  skillsDir: 'string',
  templateSkills: 'array',
  syncScript: 'string',
  usageRefresh: 'array',
  mcpConfigs: 'function',
  engineSettings: 'function',
  formaRoles: 'function',
  structure: 'object',
  id: 'string',
  spendTag: 'string',
  sources: 'object',
  capabilities: 'object',
  nodeModels: 'object',
  writeZones: 'array',
};

/** The `sources` fields and each one's type. */
const SOURCE_FIELDS = {
  rolesDir: 'string',
  onDemandRolesDir: 'string',
  runRolesDir: 'string',
  scriptsDir: 'string',
  skillsDir: 'string',
  testsDir: 'string',
  packageManifest: 'string',
  mcpConfigs: 'array',
};
/** The engine's capabilities: each one a boolean. */
const CAPABILITY_FIELDS = ['subagents', 'sendMessage', 'hooks', 'mcp'];
/** The five nodes of the `nodeModels` table. */
const NODES = ['Intent', 'Spec', 'Kit', 'Run', 'Core'];
// The mode labels are canonical ru strings of the dictionary; the byte-exact values are pinned by tests.
const MODE_FULL = ruMsg('engines.mode_full');
const MODE_DEGRADED = ruMsg('engines.mode_degraded');
/** The cards - the second permitted write zone, besides the engine's own folder. */
const CARDS_ZONE = '.devtool/features';

const typeOf = (v) => (Array.isArray(v) ? 'array' : typeof v);

/** What is wrong with the adapter: an empty list - the shape is held. An absent field is not an error. */
function validateAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') return [ruMsg('engines.not_object')];
  const problems = [];
  for (const [field, type] of Object.entries(SHAPE)) {
    if (adapter[field] == null) continue;
    if (typeOf(adapter[field]) !== type) problems.push(ruMsg('engines.field_type', { field, want: type, got: typeOf(adapter[field]) }));
  }
  for (const field of Object.keys(adapter)) {
    if (field !== 'dir' && !(field in SHAPE)) problems.push(ruMsg('engines.field_unknown', { field }));
  }
  const { sources, capabilities, nodeModels, writeZones } = adapter;
  if (typeOf(sources) === 'object') {
    for (const [k, v] of Object.entries(sources)) {
      if (!(k in SOURCE_FIELDS)) problems.push(ruMsg('engines.sources_field_unknown', { key: k }));
      else if (typeOf(v) !== SOURCE_FIELDS[k]) problems.push(ruMsg('engines.sources_field_type', { key: k, want: SOURCE_FIELDS[k], got: typeOf(v) }));
      else if (k === 'mcpConfigs' && v.some((x) => typeof x !== 'string')) problems.push(ruMsg('engines.sources_mcp_strings'));
    }
  }
  if (typeOf(capabilities) === 'object') {
    for (const [k, v] of Object.entries(capabilities)) {
      if (!CAPABILITY_FIELDS.includes(k)) problems.push(ruMsg('engines.cap_field_unknown', { key: k }));
      else if (typeof v !== 'boolean') problems.push(ruMsg('engines.cap_field_type', { key: k, got: typeOf(v) }));
    }
  }
  if (typeOf(nodeModels) === 'object') {
    for (const [node, row] of Object.entries(nodeModels)) {
      if (!NODES.includes(node)) problems.push(ruMsg('engines.node_unknown', { node }));
      else if (typeOf(row) !== 'object' || typeof row.model !== 'string' || typeof row.effort !== 'string') problems.push(ruMsg('engines.node_shape', { node }));
    }
  }
  if (Array.isArray(writeZones) && writeZones.some((x) => typeof x !== 'string')) problems.push(ruMsg('engines.writezones_strings'));
  return problems;
}

/** The engine's name: the `id` or the adapter directory's name without the dot. */
function idOf(adapter) {
  if (adapter && typeof adapter.id === 'string' && adapter.id) return adapter.id;
  return adapter && adapter.dir ? String(adapter.dir).replace(/^\./, '') : UNKNOWN;
}

/**
 * The adapter's sources: the ones declared in `sources` as they are; an adapter without `sources` -
 * the values by convention from its directory (`<dir>/agents`, `/agents/on-demand`, `/agents/run`,
 * `/scripts`, `/skills`, `/tests`); `packageManifest` by convention - `null`, `mcpConfigs` - an empty
 * list. What is declared is not overwritten by the convention.
 */
function sourcesOf(adapter) {
  const dir = adapter && adapter.dir ? String(adapter.dir) : '.' + idOf(adapter);
  const byConvention = {
    rolesDir: `${dir}/agents`,
    onDemandRolesDir: `${dir}/agents/on-demand`,
    runRolesDir: `${dir}/agents/run`,
    scriptsDir: `${dir}/scripts`,
    skillsDir: `${dir}/skills`,
    testsDir: `${dir}/tests`,
    packageManifest: null,
    mcpConfigs: [],
  };
  const declared = adapter && adapter.sources && typeof adapter.sources === 'object' ? adapter.sources : null;
  return declared ? { ...byConvention, ...declared } : byConvention;
}

/** The engine's mode (AGENTS.md §2): "full" when the calling of subagents is declared, otherwise "degraded". */
function modeOf(adapter) {
  const c = adapter && adapter.capabilities;
  return c && typeof c === 'object' && c.subagents === true ? MODE_FULL : MODE_DEGRADED;
}

const under = (rel, dir) => rel === dir || rel.startsWith(dir + '/');

/**
 * The engine package folder by `sources.packageManifest`: the manifest's directory; when the manifest
 * sits in a service folder with a dot in the name (a plugin's metadata), its parent counts as the package.
 * Without a manifest - `null`. No engine names.
 */
function packageZone(adapter) {
  const m = adapter && adapter.sources && adapter.sources.packageManifest;
  if (typeof m !== 'string' || !m) return null;
  let dir = path.posix.dirname(m.split('\\').join('/'));
  if (dir !== '.' && path.posix.basename(dir).startsWith('.')) dir = path.posix.dirname(dir);
  return dir === '.' || dir === '' || dir === '..' || dir.startsWith('../') || path.posix.isAbsolute(dir) ? null : dir;
}

/**
 * The contract items for an adapter: `[{ item, ok, detail }]`. It reads the disk only for the existence
 * of the declared sources. An engine writes only into its own folder and the cards; Kit creates the roles
 * in the rolesDir of the engine that executes them.
 */
function checkAdapter(adapter, root) {
  const out = [];
  const add = (item, ok, detail = '') => out.push({ item, ok: Boolean(ok), detail });
  const shape = validateAdapter(adapter);
  add(ruMsg('engines.item_shape_ok'), shape.length === 0, shape.join('; '));
  add(ruMsg('engines.item_spend_tag'), typeof (adapter.spendTag || adapter.engine) === 'string', ruMsg('engines.spend_tag_missing'));
  const src = sourcesOf(adapter);
  add(ruMsg('engines.item_sources'), adapter.sources != null, ruMsg('engines.sources_missing'));
  for (const k of ['rolesDir', 'onDemandRolesDir', 'runRolesDir', 'scriptsDir', 'skillsDir', 'testsDir', 'packageManifest']) {
    if (adapter.sources == null || adapter.sources[k] == null) continue;
    add(ruMsg('engines.item_source_exists', { key: k }), fs.existsSync(resolveRel(root, src[k])), src[k]);
  }
  const cap = adapter.capabilities;
  const capOk = cap && typeof cap === 'object' && CAPABILITY_FIELDS.every((k) => typeof cap[k] === 'boolean');
  add(ruMsg('engines.item_capabilities'), capOk, ruMsg('engines.cap_needed'));
  add(ruMsg('engines.item_mode', { mode: modeOf(adapter) }), true);
  const nm = adapter.nodeModels;
  add(ruMsg('engines.item_nodemodels'), nm && typeof nm === 'object' && NODES.every((n) => nm[n] && nm[n].model && nm[n].effort),
    ruMsg('engines.nodes_needed'));
  const zones = adapter.writeZones;
  const own = adapter.dir ? String(adapter.dir) : null;
  const pkg = packageZone(adapter);
  const zonesOk = Array.isArray(zones) && zones.length > 0
    && zones.every((z) => (own && under(z, own)) || under(z, CARDS_ZONE) || (pkg && under(z, pkg)));
  add(ruMsg('engines.item_writezones'), zonesOk,
    ruMsg('engines.writezones_allowed', { own: own || ruMsg('engines.own_folder_fallback'), cards: CARDS_ZONE, pkg: pkg ? ruMsg('engines.and') + pkg : '' }));
  add(ruMsg('engines.item_roles_in_zone'), own != null && under(src.rolesDir, own), ruMsg('engines.roles_outside', { rolesDir: src.rolesDir, own }));
  // A parse probe: a step with output tokens under common field names, flat and under usage; we wait for tokens_out = 7.
  const flat = { tokens_out: 7, output_tokens: 7, outputTokens: 7, completion_tokens: 7, candidatesTokenCount: 7 };
  const reads = (step) => { try { const r = adapter.parseUsage(step); return Boolean(r) && typeof r === 'object' && r.tokens_out === 7; } catch { return false; } };
  add(ruMsg('engines.item_parseusage'), typeof adapter.parseUsage === 'function' && (reads(flat) || reads({ usage: flat })), ruMsg('engines.parseusage_failed'));
  return out;
}

/** The project's adapters: `[{ ...fields, dir }]`, `dir` - the adapter directory's name in the root. */
function loadAdapters(root) {
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return []; } // no root - no adapters
  const dirs = entries.filter((e) => e.isDirectory() && e.name.startsWith('.')).map((e) => e.name).sort();
  const found = [];
  for (const dir of dirs) {
    const file = path.join(root, dir, ADAPTER_FILE);
    if (!fs.existsSync(file)) continue;
    let mod;
    try { mod = require(file); } catch { continue; } // fell at load - no adapter, the core moves on
    if (mod && typeof mod === 'object') found.push({ ...mod, dir });
  }
  return found;
}

/** The field's value at the first adapter that declared it; otherwise `null`. */
function first(root, field) {
  for (const a of loadAdapters(root)) if (a[field] != null) return a[field];
  return null;
}

/** The values of a list field at all adapters, glued. */
function all(root, field) {
  return loadAdapters(root).flatMap((a) => (Array.isArray(a[field]) ? a[field] : []));
}

/** The results of a function field at all adapters (`fn(root)` -> a list), glued. */
function collect(root, field) {
  return loadAdapters(root).flatMap((a) => (typeof a[field] === 'function' ? a[field](root) : []));
}

/**
 * The engines' labels in the spend line: the `spendTag`, `engine` and `id` of each adapter (the line may carry
 * any of them). Not a single adapter - an empty list (nothing to judge the label by).
 */
function spendTags(root) {
  const tags = new Set();
  for (const a of loadAdapters(root)) {
    for (const v of [a.spendTag, a.engine, idOf(a)]) if (typeof v === 'string' && v && v !== UNKNOWN) tags.add(v);
  }
  return [...tags];
}

/**
 * The project's engines by the adapters: `[{ tag, aliases }]`. `tag` - the main label (`spendTag`, else
 * `engine`), `aliases` - all the labels under which the engine may stand in a spend line (`spendTag`,
 * `engine`, `id`). The tab and the spend column are built from this list: an engine folder with an adapter
 * appeared - the engine is in the list; removed - it is not.
 */
function engineTags(root) {
  return loadAdapters(root).map((a) => {
    const tag = a.spendTag || a.engine || idOf(a);
    const aliases = [...new Set([a.spendTag, a.engine, idOf(a)].filter((v) => typeof v === 'string' && v && v !== UNKNOWN))];
    return { tag, aliases: aliases.includes(tag) ? aliases : [tag, ...aliases] };
  });
}

/** A function tag -> the engine's main label: one adapter's aliases (`spendTag`, `engine`, `id`) reduce to `tag`; a foreign tag stays as is. */
function canonicalTag(root) {
  const map = new Map();
  for (const { tag, aliases } of engineTags(root)) for (const x of aliases) if (!map.has(x)) map.set(x, tag);
  return (k) => (map.has(k) ? map.get(k) : k);
}

/**
 * The transcripts directories of all adapters: `[{ tag, dir, parseUsage, findSubagent, stepOf }]`, `tag` -
 * the engine's label (`spendTag` or `engine`). `findSubagent(agentId, root)` - a subagent attempt's transcript
 * by id (the engine layout knows the adapter, not the core); `stepOf(line)` - the `usage`, `requestId` and
 * time out of a transcript step, `null` for a step without spend. An adapter without `transcriptsDir`, one
 * that threw or found no directory - is skipped.
 */
function transcriptDirs(root) {
  const out = [];
  for (const a of loadAdapters(root)) {
    if (typeof a.transcriptsDir !== 'function') continue;
    let dir = null;
    try { dir = a.transcriptsDir(root); } catch { dir = null; }
    if (!dir || !fs.existsSync(dir)) continue;
    out.push({
      tag: a.spendTag || a.engine || idOf(a),
      dir,
      parseUsage: typeof a.parseUsage === 'function' ? a.parseUsage : null,
      findSubagent: typeof a.findSubagent === 'function' ? a.findSubagent : null,
      stepOf: typeof a.stepOf === 'function' ? a.stepOf : null,
    });
  }
  return out;
}

/**
 * The main session journals of all adapters: `[{ tag, id, file, stepOf, parseUsage }]` - one entry per file.
 * An adapter declares `mainSessions(root)` (which files is its layout's business, subagent ones not included)
 * and `mainStepOf(line, prev)` (a normalized step); without both the engine gives no main journal - skipped.
 * The same `parseUsage` is taken as for transcripts; the engine names no directories - only files.
 */
function mainSessions(root) {
  const out = [];
  for (const a of loadAdapters(root)) {
    if (typeof a.mainSessions !== 'function' || typeof a.mainStepOf !== 'function') continue;
    let list = [];
    try { list = a.mainSessions(root) || []; } catch { list = []; }
    for (const s of list) {
      if (!s || !s.id || !s.file) continue;
      out.push({
        tag: a.spendTag || a.engine || idOf(a),
        id: String(s.id),
        file: s.file,
        stepOf: a.mainStepOf,
        parseUsage: typeof a.parseUsage === 'function' ? a.parseUsage : null,
      });
    }
  }
  return out;
}

/** Each adapter's node -> { model, effort } table: `[{ tag, dir, rolesDir, nodeModels }]` (adapters without a table are skipped). */
function nodeModelTables(root) {
  return loadAdapters(root)
    .filter((a) => a.nodeModels && typeof a.nodeModels === 'object')
    .map((a) => ({ tag: a.spendTag || a.engine || idOf(a), dir: a.dir, rolesDir: typeof a.rolesDir === 'string' ? a.rolesDir : null, nodeModels: a.nodeModels }));
}

/** An absolute path out of a path from the project root written through `/`. */
const resolveRel = (root, rel) => path.join(root, ...rel.split('/'));

/** The absolute path of the first adapter's path field, or `null`. */
function firstPath(root, field) {
  const rel = first(root, field);
  return rel ? resolveRel(root, rel) : null;
}

module.exports = {
  loadAdapters, first, all, collect, firstPath, engineTags, canonicalTag, spendTags, transcriptDirs, nodeModelTables, resolveRel, validateAdapter, SHAPE, UNKNOWN,
  idOf, sourcesOf, modeOf, checkAdapter, MODE_FULL, MODE_DEGRADED, TRANSCRIPT_FIELDS, mainSessions,
};

/**
 * `node engines.cjs check <engine> [--root <dir>]` - prints the contract items: `✓` passed, `✗` failed.
 * Exit code: 0 - all passed, 1 - there is a failed one, 2 - no engine or a wrong call. Writes nothing else.
 */
if (require.main === module) {
  const argv = process.argv.slice(2);
  const ri = argv.indexOf('--root');
  const root = ri >= 0 ? path.resolve(argv[ri + 1] || '.') : process.cwd();
  const rest = argv.filter((a, i) => a !== '--root' && (ri < 0 || i !== ri + 1));
  if (rest[0] !== 'check' || !rest[1]) {
    console.error('usage: node .forma/dashboard/lib/engines.cjs check <engine> [--root <dir>]');
    process.exit(2);
  }
  const a = loadAdapters(root).find((x) => idOf(x) === rest[1] || x.engine === rest[1] || x.dir === rest[1]);
  if (!a) {
    console.error(`engine not found: ${rest[1]} (adapters: ${loadAdapters(root).map(idOf).join(', ') || 'none'})`);
    process.exit(2);
  }
  const items = checkAdapter(a, root);
  for (const r of items) console.log(`${r.ok ? '✓' : '✗'} ${r.item}${!r.ok && r.detail ? ' — ' + r.detail : ''}`);
  const failed = items.filter((r) => !r.ok).length;
  console.log(`${idOf(a)}: passed ${items.length - failed}, failed ${failed}`);
  process.exit(failed ? 1 : 0);
}
