'use strict';

/**
 * The engine package's subagents generator: the zone roles -> the package `agents/<role>.md`.
 *
 * The plugin hands its roles to the runtime as subagents, and the runtime reads them from the
 * package, not from the zone. So there is no second copy, the package files are DERIVED: the role
 * body is carried over verbatim, and the head is rewritten per the plugin contract (native tool
 * names, no aliases and no `task` - a plugin subagent cannot delegate further).
 *
 * Two transpositions without which a subagent does not work:
 *   1. tools - `Bash(node … *)` is not a tool name but a permission template; the name is `bash`;
 *   2. paths - a subagent works with the project root, while a role speaks "relative to the zone":
 *      `agents/on-demand/…` means `.minimax/agents/on-demand/…`.
 *
 * Run: node .minimax/scripts/gen-plugin-agents.cjs [--check]
 */

const fs = require('fs');
const path = require('path');
const i18n = require([path.resolve(__dirname, '../../.forma/i18n/index.cjs'), path.resolve(__dirname, '../../../../core/i18n/index.cjs')].find((p) => fs.existsSync(p)));
const msg = (code, params) => i18n.message(code, params, 'ru');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC_DIR = path.join(ROOT, '.minimax', 'agents');
const PKG_DIR = path.join(ROOT, 'miniapps', 'minimax-engine');
const OUT_DIR = path.join(PKG_DIR, 'agents');

/** The zone roles that become subagents. `intent` is the main session, not a subagent. */
const ROLES = ['spec', 'kit', 'run', 'core', 'extractor', 'plumb-haiku', 'asset-describer-haiku'];

/** The tool names: a role (Claude) -> the runtime native name. */
const NATIVE = {
  Read: 'read', Write: 'write', Edit: 'edit', Grep: 'grep', Glob: 'glob',
  Bash: 'bash', WebFetch: 'web_fetch', WebSearch: 'web_search',
  TodoWrite: 'todowrite', AskUserQuestion: 'ask_user',
};

/** The names the runtime will not accept: aliases, `task` (a subagent does not delegate), MCP servers. */
const DROPPED = new Set(['Task', 'SendMessage', 'KillShell', 'TaskOutput', 'Skill', 'Agent']);

/**
 * The roles whose tools are not restricted: `tools` is an allowlist, and the list would narrow
 * `Kit` to six tools, while it works with MCP servers and the browser. Inheritance (the `tools`
 * field unset) gives the subagent the whole parent session set.
 */
const INHERIT_TOOLS = new Set(['kit']);

/** When the main session should call this node - a hint appended to the role description. */
const delegateHint = (role) => (ROLES.includes(role) ? ' ' + msg('gpa.delegate.' + role) : '');

const displayName = (role) => msg('gpa.display.' + role);

/**
 * The path transposition from "relative to the zone" to "relative to the project root" - the
 * subagent working directory. Reading the shared scripts `.claude/scripts/*` is not transposed:
 * it is a named dependency (the zone §8), the files exist in the project as they are.
 */
const PATH_RULES = [
  [/\.claude\/agents/g, '.minimax/agents'],
  [/\.claude\/rules/g, '.minimax/rules'],
  [/(?<![\w./~-])agents\/on-demand\//g, '.minimax/agents/on-demand/'],
  [/(?<![\w./~-])agents\/run\//g, '.minimax/agents/run/'],
  [/(?<![\w./~-])agents\//g, '.minimax/agents/'],
  [/(?<![\w./~-])on-demand\//g, '.minimax/agents/on-demand/'],
  [/(?<![\w./~-])rules\/minimax-8\.md/g, '.minimax/rules/minimax-8.md'],
  [/(?<![\w./~-])skills\//g, '.minimax/skills/'],
];

function splitFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!m) return { fm: '', body: text };
  return { fm: m[1], body: text.slice(m[0].length) };
}

function field(fm, name) {
  const m = fm.match(new RegExp('^' + name + ':\\s*(.*)$', 'm'));
  return m ? m[1].trim() : '';
}

/** The role tools -> native names: `Bash(node … *)` is `bash`, not a separate name. */
function nativeTools(tools) {
  const out = [];
  for (const raw of String(tools).split(',')) {
    let name = raw.trim();
    if (!name) continue;
    const paren = name.indexOf('(');
    if (paren > 0) name = name.slice(0, paren).trim();
    if (DROPPED.has(name)) continue;
    if (name.startsWith('mcp__')) continue;
    const mapped = NATIVE[name];
    if (mapped && !out.includes(mapped)) out.push(mapped);
  }
  return out;
}

/** The role body from the zone - with the paths brought to the project root. */
function adaptBody(body) {
  let out = body;
  for (const [re, to] of PATH_RULES) out = out.replace(re, to);
  return out;
}

function build(role) {
  const src = path.join(SRC_DIR, role + '.md');
  const text = fs.readFileSync(src, 'utf8');
  const { fm, body } = splitFrontmatter(text);
  const zoneDescription = field(fm, 'description') || msg('gpa.default_description') + role;
  const hint = delegateHint(role);
  const head = ['---', `name: ${role}`, `description: ${zoneDescription}${hint}`];
  if (!INHERIT_TOOLS.has(role)) {
    const tools = nativeTools(field(fm, 'tools'));
    if (tools.length) head.push('tools: [' + tools.join(', ') + ']');
  }
  head.push('x-mavis:', `  displayName: ${displayName(role)}`);
  head.push('---', '');
  return head.join('\n') + adaptBody(body);
}

function main() {
  const check = process.argv.includes('--check');
  const diffs = [];
  for (const role of ROLES) {
    const want = build(role);
    const out = path.join(OUT_DIR, role + '.md');
    if (check) {
      const have = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : null;
      if (have !== want) diffs.push(role);
      continue;
    }
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(out, want, 'utf8');
  }
  if (check) {
    if (diffs.length) {
      console.log(msg('gpa.body_diffs') + diffs.join(', '));
      process.exit(1);
    }
    console.log(msg('gpa.all_match', { count: ROLES.length }));
    return;
  }
  console.log(msg('gpa.written', { count: ROLES.length, dst: path.relative(ROOT, OUT_DIR).replace(/\\/g, '/') }));
}

if (require.main === module) main();

module.exports = { build, nativeTools, adaptBody, ROLES, OUT_DIR, PKG_DIR, INHERIT_TOOLS };
