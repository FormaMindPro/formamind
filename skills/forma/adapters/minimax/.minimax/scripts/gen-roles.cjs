'use strict';

/**
 * The generator of the Claude -> MiniMax roles mirror (`.claude/agents/` -> `.minimax/agents/`).
 *
 * The mechanics - the same as the Gemini mirror's (`gen-gemini-roles.cjs`), with two differences
 * caused by the engine:
 *   - the role's body - a copy with the paths and the tools' names transposed to mine;
 *   - the frontmatter - mine: the model, the tools and `uses` are the engine's engineering choice,
 *     the parity check does not compare them (`role-parity.cjs` cuts `^---...---\n`).
 *
 * Run: node .minimax/scripts/gen-roles.cjs [--check]
 *   --check - writes nothing, only reports the divergences (a role whose body has drifted).
 */

const fs = require('fs');
const path = require('path');
const i18n = require([path.resolve(__dirname, '../../.forma/i18n/index.cjs'), path.resolve(__dirname, '../../../../core/i18n/index.cjs')].find((p) => fs.existsSync(p)));
const msg = (code, params) => i18n.message(code, params, 'ru');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, '.claude', 'agents');
const DST = path.join(ROOT, '.minimax', 'agents');

/**
 * The path transpositions in a role's body: my zone - `.minimax/`, the law - `AGENTS.md`.
 *
 * The paths are written full (`.minimax/skills/`, `.minimax/rules/minimax-8.md`), not "from the engine's folder":
 * the engines' parity check normalizes exactly the full paths (by the adapters' contract), and only they
 * match the reference. The roles folder is the exception: the check knows the short form too (`agents/…`).
 */
const BODY_TRANSFORMS = [
  [/\.claude\/agents\/on-demand\//g, 'agents/on-demand/'],
  [/\.claude\/agents\/run\//g, 'agents/run/'],
  [/\.claude\/agents\/(?=[,`\s)]|$)/g, 'agents/'],
  [/\.claude\/skills\//g, '.minimax/skills/'],
  [/\.claude\/rules\/claude-8\.md/g, '.minimax/rules/minimax-8.md'],
  [/\bclaude-8\.md\b/g, 'minimax-8.md'],
  [/\bCLAUDE\.md\b/g, 'AGENTS.md'],
  [/Plumb on `haiku` or OpenRouter `jev`/g, 'Plumb on `minimax-m3.1-flash` or OpenRouter `jev`'],
  [/Plumb on `haiku`\/`jev`/g, 'Plumb on `minimax-m3.1-flash`\/`jev`'],
];

/** The tools: the clone's name -> my runtime's name. The order matters: the long ones first. */
const TOOL_MAP = [
  [/mcp__chrome-devtools__[a-z_]+/g, 'mcp_browser'],
  [/\bSendMessage\b/g, 'task_append'],
  [/\bAskUserQuestion\b/g, 'ask_user'],
  [/\bTodoWrite\b/g, 'todowrite'],
  [/\bWebSearch\b/g, 'web_search'],
  [/\bWebFetch\b/g, 'web_fetch'],
  [/\bKillShell\b/g, 'task_stop'],
  [/\bTaskOutput\b/g, 'task_output'],
];

/**
 * The engine's rules: those that change the MEANING, not the path.
 *
 * A foreign engine tag in my zone - not a typo but a spend error: the core accepts `claude-code:`,
 * and a MiniMax attempt written by a foreign template would go into Claude's spend silently.
 * The rule is one: the tag in the zone is mine.
 */
const FILE_RULES = {
  'on-demand/route-choice.md': [[/claude-code:/g, 'minimax:']],
};

/**
 * The write zones: where a role puts a new file. These places belong to the engine, so my
 * zone has its own paths. Reading the shared scripts (`.claude/scripts/*`) stays: it is a dependency,
 * named in section 8, not an ownership.
 */
const WRITE_PATH_RULES = [
  [/project\/extensions\/claude\//g, 'project/extensions/minimax/'],
  [/\.claude\/settings\.local\.json/g, '.minimax/settings.local.json'],
  [/puts it in `\.claude\/scripts\/`/g, 'puts it in `.minimax/scripts/`'],
  [/never to `\.claude\/scripts\/`/g, 'never to `.minimax/scripts/`'],
];

/** My model: one runtime; the "node / measurement" distinction is expressed by the tool set, not by a model. */
const MY_MODEL = 'minimax-m3.1-flash';

/**
 * The roles written by the engine itself, not by the generator: their mechanics is mine (the engine tag, the
 * calls log, the line output script). The generator does not touch them, and the check requires their presence.
 * A Claude role with the `claude-code:` tag in my zone would be a straight error: the core accepts such a tag,
 * and a MiniMax attempt would go into Claude's spend silently.
 */
const OWN_ROLES = new Set(['on-demand/spend-line.md']);

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
  return out;
}

function myFrontmatter(srcFm) {
  const f = parseFrontmatter(srcFm);
  const lines = ['---'];
  if (f.name) lines.push(`name: ${f.name}`);
  if (f.description) lines.push(`description: ${f.description}`);
  lines.push(`model: ${MY_MODEL}`);
  if (f.tier) lines.push(`tier: ${f.tier}`);
  if (f.effort) lines.push(`effort: ${f.effort}`);
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
  for (const [re, to] of (FILE_RULES[rel] || [])) out = out.replace(re, to);
  return out;
}

function walk(dir, base = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), rel));
    else if (e.name.endsWith('.md')) out.push(rel);
  }
  return out;
}

function main() {
  const check = process.argv.includes('--check');
  if (!fs.existsSync(SRC)) {
    console.error(msg('mmgen.no_source', { src: SRC }));
    process.exit(2);
  }
  const files = walk(SRC);
  const diffs = [];
  const missing = [];
  for (const rel of files) {
    const dstPath = path.join(DST, rel);
    if (OWN_ROLES.has(rel)) {
      // An engine role: written by hand, the generator does not touch it - but it must be there.
      if (!fs.existsSync(dstPath)) missing.push(rel);
      continue;
    }
    const srcText = fs.readFileSync(path.join(SRC, rel), 'utf8');
    const { fm, body } = splitFrontmatter(srcText);
    const want = myFrontmatter(fm) + transformBody(body, rel);
    if (check) {
      const have = fs.existsSync(dstPath) ? fs.readFileSync(dstPath, 'utf8') : null;
      if (have !== want) diffs.push(rel);
      continue;
    }
    fs.mkdirSync(path.dirname(dstPath), { recursive: true });
    fs.writeFileSync(dstPath, want, 'utf8');
  }
  if (check) {
    if (missing.length) {
      console.log(msg('mmgen.own_missing') + missing.join(', '));
      process.exit(1);
    }
    if (diffs.length) {
      console.log(msg('mmgen.body_diffs', { count: diffs.length }));
      for (const d of diffs) console.log('  ' + d);
      process.exit(1);
    }
    console.log(msg('mmgen.all_match', { count: files.length - OWN_ROLES.size, own: OWN_ROLES.size }));
    return;
  }
  console.log(msg('mmgen.written', { count: files.length - OWN_ROLES.size, dst: path.relative(ROOT, DST), own: OWN_ROLES.size }));
}

if (require.main === module) main();

module.exports = { transformBody, myFrontmatter, mapTools, TOOL_MAP, BODY_TRANSFORMS, SRC, DST };
