'use strict';

/**
 * The generator of the Claude -> ZCode roles mirror (`.claude/agents/` -> `.zcode/agents/`).
 *
 * The mechanics - the same as the Gemini mirrors' (`gen-gemini-roles.cjs`) and MiniMax's
 * (`.minimax/scripts/gen-roles.cjs`), with two differences caused by the engine:
 *   - the role's body - a copy with the paths transposed to mine; the engine reads the skills from
 *     the core canon `.forma/skills/` natively, so the renaming goes straight into there;
 *   - the frontmatter - mine: the model, the effort and the tools are the engine's engineering choice,
 *     the parity check does not compare them (`role-parity.cjs` cuts `^---...---\n`).
 *
 * Run: node .zcode/scripts/gen-roles.cjs [--check]
 *   --check - writes nothing, only reports the divergences (a role whose body has drifted).
 *   --print-paths - writes nothing, prints the destination paths the regeneration names (one per line,
 *     relative to .zcode/agents/): the expected mirror set the installer's hygiene pass classifies by.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, '.claude', 'agents');
const i18n = require([path.resolve(__dirname, '../../.forma/i18n/index.cjs'), path.resolve(__dirname, '../../../core/i18n/index.cjs')].find((p) => fs.existsSync(p)));
const msg = (code, params) => i18n.message(code, params, 'ru');
const DST = path.join(ROOT, '.zcode', 'agents');

/**
 * The path transpositions in a role's body: my zone - `.zcode/`, the law - `AGENTS.md`.
 *
 * The paths are written full (`.forma/skills/`, `.zcode/rules/zcode-8.md`), not "from the engine's folder":
 * the engines' parity check normalizes exactly the full paths (by the adapters' contract), and only they
 * match the reference. The roles folder is the exception: the check knows the short form too (`agents/…`).
 */

/**
 * The built-in Plumb executor's name - by the zone's small model, each engine has its own
 * (Gemini - `plumb-gemini`, its own file). The body's source is one, hence the renaming map:
 * the mirror file, the `name:` field and the mentions in the roles' bodies. The driver's wired
 * fallback tag and the value of the `plumb` setting in PROJECT.md are not touched - that is the
 * setting's vocabulary, not an agent's name.
 */
const EXECUTOR_RENAME = { 'plumb-haiku': 'plumb-glmflash' };

/**
 * The model of a mirror is resolved per role, never kept as a constant:
 *   1. one of the five nodes - that node's default from the zone's own declaration, `nodeModels`
 *      of `.zcode/forma-adapter.cjs` - the place the default is edited; the "Node defaults" table
 *      of project/config/PROJECT.md is its summary, not the source;
 *   2. a role outside the five nodes with a registry binding "role x engine zcode"
 *      (project/config/models.json, first candidate);
 *   3. any other role (the Plumb executor, helpers, the on-demand layer) - the zcode engine row's
 *      default_model of the same registry.
 * The value written into the frontmatter is the bare id (the last path segment of the address,
 * lower case) - the runtime form the live role registration proved. An unreadable registry or zone
 * adapter, a declaration without a node's model or effort, is a loud failure naming the file: the
 * mirror never falls back to a memorized value.
 *
 * The tier and the effort follow the same sources, never the canon:
 *   - the tier is the `tier` of the registry row of the model actually set, so every mirror of
 *     that model moves together; no row for that model - a loud failure, no memorized value;
 *   - the effort is the node's `effort` in the same declaration; a role outside the five nodes
 *     leaves the constants MY_EFFORT/RUN_EFFORT as the fallback, never a value from memory.
 */
const REGISTRY_PATH = path.join(ROOT, 'project', 'config', 'models.json');
const ADAPTER_PATH = path.join(ROOT, '.zcode', 'forma-adapter.cjs');
const NODES = ['intent', 'spec', 'kit', 'run', 'core'];
const EFFORTS = ['low', 'high', 'max'];

function bareModelId(address) {
  return address.split('/').pop().toLowerCase();
}

/** The five node defaults: the zone's declaration `nodeModels` of the adapter above. The values are
 *  the zone's literals, not a computation: the table of PROJECT.md is their summary. An unreadable
 *  adapter, or a declaration without a node's model/effort, is a loud failure naming the file. */
function loadNodeModels() {
  let adapter;
  try {
    adapter = require(ADAPTER_PATH);
  } catch (e) {
    throw new Error('gen-roles: the zone adapter is unreadable: ' + ADAPTER_PATH);
  }
  const declared = adapter && adapter.nodeModels;
  if (!declared || typeof declared !== 'object') {
    throw new Error('gen-roles: the zone adapter declares no nodeModels: ' + ADAPTER_PATH);
  }
  const defaults = {};
  for (const node of NODES) {
    const name = node.charAt(0).toUpperCase() + node.slice(1);
    const row = declared[name] || declared[node];
    const model = row && typeof row.model === 'string' ? row.model.trim() : '';
    const effort = row && typeof row.effort === 'string' ? row.effort.trim().toLowerCase() : '';
    if (!model || !EFFORTS.includes(effort)) {
      throw new Error('gen-roles: nodeModels of ' + ADAPTER_PATH + ' lacks a valid model/effort for ' + name + ' (effort low|high|max)');
    }
    defaults[node] = { model: bareModelId(model), effort };
  }
  return defaults;
}

function resolveModels() {
  let registry;
  try {
    registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  } catch (e) {
    throw new Error('gen-roles: the model registry is unreadable: ' + REGISTRY_PATH);
  }
  const engine = (registry.engines || []).find((e) => e.id === 'zcode');
  if (!engine || !engine.default_model) {
    throw new Error('gen-roles: the registry has no zcode engine row with default_model');
  }
  const engineDefault = bareModelId(engine.default_model);
  const bound = {};
  for (const b of registry.bindings || []) {
    if (b.engine === 'zcode' && Array.isArray(b.candidates) && b.candidates[0] && !bound[b.role]) {
      bound[b.role] = bareModelId(b.candidates[0]);
    }
  }
  const nodeDefault = loadNodeModels();
  const nodeOf = (rel) => {
    if (['intent.md', 'spec.md', 'kit.md', 'core.md'].includes(rel)) return rel.replace('.md', '');
    if (rel === 'run.md' || rel.startsWith('run/')) return 'run';
    return null;
  };
  const modelOf = (rel) => {
    const node = nodeOf(rel);
    if (node) return nodeDefault[node].model;
    return bound[rel.replace(/\.md$/, '')] || engineDefault;
  };
  const rows = new Map();
  for (const row of registry.models || []) {
    if (row.engine !== 'zcode' || !row.address) continue;
    const id = bareModelId(row.address);
    if (!rows.has(id)) rows.set(id, row);
  }
  const tierOf = (rel) => {
    const model = modelOf(rel);
    const row = rows.get(model);
    if (!row) {
      throw new Error('gen-roles: the registry has no zcode model row for "' + model + '" (role ' + rel + '); expected a row of engine zcode whose address ends with that id');
    }
    if (!row.tier) {
      throw new Error('gen-roles: the registry row of "' + model + '" carries no tier (role ' + rel + '); expected "tier: <strong|standard|light>"');
    }
    return row.tier;
  };
  const effortOf = (rel) => {
    const node = nodeOf(rel);
    return node ? nodeDefault[node].effort : null;
  };
  return { modelOf, tierOf, effortOf };
}

const MODELS = resolveModels();

const BODY_TRANSFORMS = [
  [/\bplumb-haiku\b/g, EXECUTOR_RENAME['plumb-haiku']],
  [/\.claude\/agents\/on-demand\//g, 'agents/on-demand/'],
  [/\.claude\/agents\/run\//g, 'agents/run/'],
  [/\.claude\/agents\/(?=[,`\s)]|$)/g, 'agents/'],
  [/\.claude\/skills\//g, '.forma/skills/'],
  [/\.claude\/rules\/claude-8\.md/g, '.zcode/rules/zcode-8.md'],
  [/\bclaude-8\.md\b/g, 'zcode-8.md'],
  [/\bCLAUDE\.md\b/g, 'AGENTS.md'],
];

/** The tools: the clone's name -> my runtime's name. The order matters: the long ones first. */
const TOOL_MAP = [
  [/mcp__chrome-devtools__[a-z_]+/g, 'mcp_browser'],
  [/\bKillShell\b/g, 'TaskStop'],
  // The site MCP server is not up in ZCode: the engine refuses to start an agent with an unavailable
  // tool altogether. A role can work with the site through Bash(node .claude/scripts/site.cjs *).
  [/mcp__site__mcp-adapter-[a-z-]+/g, ''],
];

/**
 * The engine's rules: those that change the MEANING, not the path.
 *
 * A foreign engine tag in my zone - not a typo but a spend error: the core accepts `claude-code:`,
 * and a ZCode attempt written by a foreign template would go into Claude's spend silently.
 * The rule is one: the tag in the zone is mine.
 */
const FILE_RULES = {
  'on-demand/route-choice.md': [[/claude-code:/g, 'zcode:']],
  'on-demand/spend-line.md': [[/claude-code:/g, 'zcode:']],
};

/**
 * The write zones: where a role puts a new file. These places belong to the engine, so my
 * zone has its own paths. Reading the shared scripts (`.claude/scripts/*`) stays: it is a dependency,
 * named in section 8, not an ownership.
 */
const WRITE_PATH_RULES = [
  [/project\/extensions\/claude\//g, 'project/extensions/zcode/'],
  [/\.claude\/settings\.local\.json/g, '.zcode/settings.local.json'],
  [/puts it in `\.claude\/scripts\/`/g, 'puts it in `.zcode/scripts/`'],
  [/never to `\.claude\/scripts\/`/g, 'never to `.zcode/scripts/`'],
];

/** The default effort, and Run's: the host's levels - low | high | max (no middle one).
 *  These are the fallback only, for a role whose node cell carries no effort. */
const MY_EFFORT = 'high';
const RUN_EFFORT = 'low';

function splitFrontmatter(text) {
  const m = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  if (!m) return { fm: null, body: text };
  return { fm: m[0], body: text.slice(m[0].length) };
}

function parseFrontmatter(fm) {
  const out = {};
  if (!fm) return out;
  for (const line of fm.split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i === -1) continue;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim();
    if (k && !k.startsWith('#')) out[k] = v;
  }
  return out;
}

function mapTools(value) {
  if (!value) return value;
  let out = value;
  for (const [re, to] of TOOL_MAP) out = out.replace(re, to);
  // Different clone tools collapsed into one name after the renaming - the duplicates are cleaned out, the order kept.
  const seen = new Set();
  out = out.split(/,\s*/).filter((t) => {
    if (!t || seen.has(t)) return false;
    seen.add(t);
    return true;
  }).join(', ');
  return out;
}

function myFrontmatter(srcFm, rel) {
  const f = parseFrontmatter(srcFm);
  const isRun = rel === 'run.md' || rel.startsWith('run/');
  const lines = ['---'];
  if (f.name) lines.push(`name: ${EXECUTOR_RENAME[f.name] || f.name}`);
  if (f.description) lines.push(`description: ${f.description}`);
  lines.push(`model: ${MODELS.modelOf(rel)}`);
  lines.push(`tier: ${MODELS.tierOf(rel)}`);
  lines.push(`effort: ${MODELS.effortOf(rel) || (isRun ? RUN_EFFORT : MY_EFFORT)}`);
  if (f.tools) lines.push(`tools: ${mapTools(f.tools)}`);
  if (f.uses) lines.push(`uses: ${f.uses}`);
  if (f.omitClaudeMd) lines.push(`omitClaudeMd: ${f.omitClaudeMd}`);
  lines.push('---');
  return lines.join('\n') + '\n';
}

function transformBody(body, rel) {
  let out = body.replace(/\r\n/g, '\n');
  for (const [re, to] of BODY_TRANSFORMS) out = out.replace(re, to);
  for (const [re, to] of TOOL_MAP) out = out.replace(re, to);
  for (const [re, to] of WRITE_PATH_RULES) out = out.replace(re, to);
  const rules = FILE_RULES[rel.replace(/\\/g, '/')] || [];
  for (const [re, to] of rules) out = out.replace(re, to);
  return out;
}

function listRoleFiles(dir, base = '') {
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listRoleFiles(path.join(dir, e.name), rel));
    else if (e.isFile() && e.name.endsWith('.md')) out.push(rel);
  }
  return out;
}

/** A project-layer role (frontmatter `layer: project`): the mirror must not carry it. */
function isProjectRole(rel) {
  const src = fs.readFileSync(path.join(SRC, ...rel.split('/')), 'utf8');
  const { fm } = splitFrontmatter(src);
  return /^layer:\s*project\s*$/m.test(fm || '');
}

function generate() {
  const printPaths = process.argv.includes('--print-paths');
  const all = listRoleFiles(SRC);
  const projectRels = all.filter(isProjectRole);
  const files = all.filter((rel) => !projectRels.includes(rel));
  const written = [];
  const drift = [];
  const paths = [];
  for (const rel of files) {
    const src = fs.readFileSync(path.join(SRC, ...rel.split('/')), 'utf8');
    const { fm, body } = splitFrontmatter(src);
    const text = myFrontmatter(fm || '', rel) + transformBody(body, rel);
    const stem = rel.replace(/\.md$/, '');
    const dstRel = EXECUTOR_RENAME[stem] ? `${EXECUTOR_RENAME[stem]}.md` : rel;
    if (printPaths) { paths.push(dstRel); continue; } // destinations only, nothing written
    const dst = path.join(DST, ...dstRel.split('/'));
    if (fs.existsSync(dst) && fs.readFileSync(dst, 'utf8') === text) continue;
    drift.push(rel);
    if (!process.argv.includes('--check')) {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.writeFileSync(dst, text);
      written.push(rel);
    }
  }
  const expected = new Set(files.map((rel) => {
    const stem = rel.replace(/\.md$/, '');
    return (EXECUTOR_RENAME[stem] ? `${EXECUTOR_RENAME[stem]}.md` : rel);
  }));
  // A file the project owns arrives from project/extensions/<engine>/ and is not stale: only a file
  // with neither a source role nor a project-extension source is a leftover of a removed role.
  const owned = (rel) => ['template', 'custom', ''].some((layer) => {
    const base = layer ? path.join(ROOT, 'project', 'extensions', layer, 'zcode', 'agents') : path.join(ROOT, 'project', 'extensions', 'zcode', 'agents');
    return fs.existsSync(path.join(base, ...rel.split('/')));
  });
  const projectDsts = new Set(projectRels.map((rel) => {
    const stem = rel.replace(/\.md$/, '');
    return (EXECUTOR_RENAME[stem] ? `${EXECUTOR_RENAME[stem]}.md` : rel);
  }));
  const stale = printPaths ? [] : listRoleFiles(DST).filter((rel) => projectDsts.has(rel) || (!expected.has(rel) && !owned(rel)));
  if (!printPaths && !process.argv.includes('--check')) {
    for (const rel of stale) fs.rmSync(path.join(DST, ...rel.split('/')), { force: true });
  }
  return { files, written, drift, stale, paths: printPaths ? [...new Set(paths)].sort() : null };
}

const { files, written, drift, paths, stale } = generate();
if (paths) {
  console.log(paths.join('\n'));
} else if (process.argv.includes('--check')) {
  if (stale.length) {
    console.error(msg('zgen.stale') + stale.join(', '));
    console.error(msg('zgen.rebuild'));
    process.exit(1);
  }
  if (drift.length) {
    console.error(msg('zgen.drift') + drift.join(', '));
    console.error(msg('zgen.rebuild'));
    process.exit(1);
  }
  console.log(msg('zgen.in_sync', { count: files.length }));
} else {
  console.log(msg('zgen.summary', { count: files.length, written: written.length }) + (written.length ? ': ' + written.join(', ') : msg('zgen.already_sync')));
}
