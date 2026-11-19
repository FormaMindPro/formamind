#!/usr/bin/env node
'use strict';

/**
 * gen-roles.cjs - the Qoder role catalog from the canonical .claude/agents.
 * The host registers agent types only through its Desktop settings, so this catalog is not registration:
 * it is the set of role texts the session-start hook delivers and the dashboard/Kit read.
 *
 * The body is copied as is; the frontmatter of the five node roles, the run crafts and the Plumb
 * executor is the engine's engineering choice: the node -> model/effort table below is the same
 * declaration the adapter's `nodeModels` carries, so the catalog and the dashboard read one set of defaults.
 *
 *   node .qoder/engine/scripts/gen-roles.cjs           - rebuild .qoder/engine/agents from .claude/agents
 *   node .qoder/engine/scripts/gen-roles.cjs --check   - report drift, write nothing
 *   node .qoder/engine/scripts/gen-roles.cjs --print-paths - print the expected relative paths, one per line
 *
 * No .claude/agents (a Qoder-only install): the shipped catalog is kept, not emptied.
 */

const fs = require('fs');
const path = require('path');

function findRoot(start) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, 'AGENTS.md'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return path.resolve(start);
    dir = up;
  }
}

const ROOT = findRoot(process.cwd());
const SRC = path.join(ROOT, '.claude', 'agents');
const DST = path.join(ROOT, '.qoder', 'engine', 'agents');

function walk(dir, base = dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out.sort();
}

function read(rel, base) {
  return fs.readFileSync(path.join(base, rel), 'utf8');
}

/** A project-layer role (frontmatter `layer: project`): the catalog must not carry it. */
function isProjectRole(rel, base) {
  const fm = read(rel, base).match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return !!fm && /^layer:\s*project\s*$/m.test(fm[1]);
}

/**
 * The node -> model/effort table: the same values the adapter's `nodeModels` declares.
 * The Plumb executor is the zone's cheapest model; its file keeps the canon executor's name.
 * A role outside the five nodes keeps its source frontmatter untouched.
 */
const NODE_MODELS = {
  Intent: { model: 'deepseek', effort: 'max' },
  Spec: { model: 'deepseek-flash', effort: 'medium' },
  Kit: { model: 'deepseek-flash', effort: 'max' },
  Run: { model: 'qwen-3.8-flash', effort: 'max' },
  Core: { model: 'deepseek-flash', effort: 'max' },
};
const PLUMB_MODEL = { model: 'qwen-3.8-flash', effort: 'low' };
// Roles outside the five nodes still belong to this family: no Claude model may reach the Qoder catalog.
const EXTRACTOR_MODEL = { model: 'deepseek-flash', effort: 'medium' };
const ASSET_MODEL = { model: 'qwen-3.8-flash', effort: 'low' };

function nodeModelOf(rel) {
  const r = rel.split('\\').join('/');
  if (r === 'intent.md') return NODE_MODELS.Intent;
  if (r === 'spec.md') return NODE_MODELS.Spec;
  if (r === 'kit.md') return NODE_MODELS.Kit;
  if (r === 'run.md' || r.startsWith('run/')) return NODE_MODELS.Run;
  if (r === 'core.md') return NODE_MODELS.Core;
  if (r === 'plumb-haiku.md') return PLUMB_MODEL;
  if (r === 'extractor.md') return EXTRACTOR_MODEL;
  if (r === 'asset-describer-haiku.md') return ASSET_MODEL;
  return null;
}

/** The role text with the node's model and effort in its frontmatter; the rest of it is kept. */
function withNodeModel(text, rel) {
  const pick = nodeModelOf(rel);
  if (!pick) return text;
  const fm = text.match(/^---\r?\n[\s\S]*?\r?\n---/);
  if (!fm) return text;
  let head = fm[0];
  head = /^model:.*$/m.test(head)
    ? head.replace(/^model:.*$/m, 'model: ' + pick.model)
    : head;
  head = /^effort:.*$/m.test(head)
    ? head.replace(/^effort:.*$/m, 'effort: ' + pick.effort)
    : head.replace(/^model:.*$/m, (line) => line + '\neffort: ' + pick.effort);
  return head + text.slice(fm[0].length);
}

function main() {
  const check = process.argv.includes('--check');
  const printPaths = process.argv.includes('--print-paths');
  if (!fs.existsSync(SRC)) {
    if (!fs.existsSync(DST)) {
      console.error('gen-roles: no .claude/agents and no shipped .qoder/engine/agents catalog');
      process.exit(1);
    }
    if (printPaths) for (const rel of walk(DST)) console.log(rel);
    else console.log('gen-roles: no .claude/agents — the shipped catalog is kept');
    return;
  }

  const source = walk(SRC).filter((rel) => !isProjectRole(rel, SRC));
  const current = walk(DST);
  if (printPaths) {
    for (const rel of source) console.log(rel);
    return;
  }

  const problems = [];
  for (const rel of source) {
    const target = path.join(DST, rel);
    const expected = withNodeModel(read(rel, SRC), rel);
    if (!fs.existsSync(target)) problems.push('missing role: ' + rel);
    else if (expected !== read(rel, DST)) problems.push('drifted role: ' + rel);
  }
  for (const rel of current) if (!source.includes(rel)) problems.push('stale role: ' + rel);

  if (check) {
    if (problems.length) {
      console.error('gen-roles --check: red');
      for (const problem of problems) console.error('  — ' + problem);
      process.exit(1);
    }
    console.log('gen-roles --check: the catalog matches .claude/agents (the node frontmatter carries the engine models)');
    return;
  }

  for (const rel of source) {
    const target = path.join(DST, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, withNodeModel(read(rel, SRC), rel));
  }
  for (const rel of current) {
    if (!source.includes(rel)) fs.rmSync(path.join(DST, rel), { force: true });
  }
  console.log('gen-roles: ' + source.length + ' roles rebuilt from .claude/agents');
}

main();
