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
 * the mirror file, the `name:` field and the mentions in the roles' bodies. The wired jev fallback tag
 * (`{"fallback":"haiku"}`) and the `haiku` value of the `plumb` setting in PROJECT.md are not touched -
 * that is the setting's vocabulary, not an agent's name.
 */
const EXECUTOR_RENAME = { 'plumb-haiku': 'plumb-glmflash' };

const BODY_TRANSFORMS = [
  [/\bplumb-haiku\b/g, EXECUTOR_RENAME['plumb-haiku']],
  [/\.claude\/agents\/on-demand\//g, 'agents/on-demand/'],
  [/\.claude\/agents\/run\//g, 'agents/run/'],
  [/\.claude\/agents\/(?=[,`\s)]|$)/g, 'agents/'],
  [/\.claude\/skills\//g, '.forma/skills/'],
  [/\.claude\/rules\/claude-8\.md/g, '.zcode/rules/zcode-8.md'],
  [/\bclaude-8\.md\b/g, 'zcode-8.md'],
  [/\bCLAUDE\.md\b/g, 'AGENTS.md'],
  [/Plumb on `haiku` or OpenRouter `jev`/g, 'Plumb on `glm-4-flash` or OpenRouter `jev`'],
  [/Plumb on `haiku`\/`jev`/g, 'Plumb on `glm-4-flash`\/`jev`'],
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

/** My model: one runtime; the "node / effort" distinction is expressed by the thinking level. */
const MY_MODEL = 'glm-5.3-flash';

/** The default effort, and Run's: the host's levels - low | high | max (no middle one). */
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
  lines.push(`model: ${MY_MODEL}`);
  if (f.tier) lines.push(`tier: ${f.tier}`);
  lines.push(`effort: ${isRun ? RUN_EFFORT : MY_EFFORT}`);
  if (f.tools) lines.push(`tools: ${mapTools(f.tools)}`);
  if (f.uses) lines.push(`uses: ${f.uses}`);
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

function generate() {
  const files = listRoleFiles(SRC);
  const written = [];
  const drift = [];
  for (const rel of files) {
    const src = fs.readFileSync(path.join(SRC, ...rel.split('/')), 'utf8');
    const { fm, body } = splitFrontmatter(src);
    const text = myFrontmatter(fm || '', rel) + transformBody(body, rel);
    const stem = rel.replace(/\.md$/, '');
    const dstRel = EXECUTOR_RENAME[stem] ? `${EXECUTOR_RENAME[stem]}.md` : rel;
    const dst = path.join(DST, ...dstRel.split('/'));
    if (fs.existsSync(dst) && fs.readFileSync(dst, 'utf8') === text) continue;
    drift.push(rel);
    if (!process.argv.includes('--check')) {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.writeFileSync(dst, text);
      written.push(rel);
    }
  }
  return { files, written, drift };
}

const { files, written, drift } = generate();
if (process.argv.includes('--check')) {
  if (drift.length) {
    console.error(msg('zgen.drift') + drift.join(', '));
    console.error(msg('zgen.rebuild'));
    process.exit(1);
  }
  console.log(msg('zgen.in_sync', { count: files.length }));
} else {
  console.log(msg('zgen.summary', { count: files.length, written: written.length }) + (written.length ? ': ' + written.join(', ') : msg('zgen.already_sync')));
}
