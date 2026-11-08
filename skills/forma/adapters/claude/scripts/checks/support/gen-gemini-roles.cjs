'use strict';

// Generator of the base engine's role mirror into the sink engine (the roles folders - from adapters, engines.cjs).
// The rules are derived byte-for-byte from the current (already synced) mirror.
// The frontmatter (model/effort/tools/skills) is not generated: it is an engineering choice per the
// engine's capabilities; role-parity.cjs itself excludes it from the reconciliation (normalizeText cuts `^---...---\n`).
// The generator touches only the file's body and keeps the frontmatter already standing in the destination file.

const fs = require('fs');
const path = require('path');
const roots = require('./engine-roots.cjs');
const { ROLE_EQUIVALENCE } = require('./role-parity.cjs');

// The source - the engine in whose folder this script lies; the sink - the mirror engine (by the adapter's id).
// Both engines' roles and skills folders come from the `sources` of their adapters (engines.cjs); no adapter - no mirror, an empty plan.
const TARGET_ID = 'gemini';

/** The project's mirror context: { from, to, roleTransforms, onDemandTransforms, protectedLiterals }, or null. */
function ctxOf(root) {
  const from = roots.own(root);
  const to = roots.find(root, TARGET_ID);
  if (!from || !to || !from.src.rolesDir || !to.src.rolesDir) return null;
  const rel = path.posix.basename(to.src.rolesDir); // how the mirror names its own roles folder from inside
  const re = (s, tail = '') => new RegExp(roots.escapeRe(s) + tail, 'g');
  const R = from.src.rolesDir;
  const K = from.src.skillsDir;
  const tick = '`';
  // A role (with the `model:` frontmatter) gets the header suffix " (Gemini Engine)" and the full set
  // of path substitutions. On-demand (no frontmatter) gets only the substitution of its own folder.
  const onDemand = [[re(`${R}/on-demand/`), `${rel}/on-demand/`]];
  const roleTransforms = [
    ...onDemand,
    [re(`${R}/run/`), `${rel}/run/`],
    [re(`${R}/*.md`), `${rel}/*.md`],
    [re(`${R}/`, '(?=[,`\s)]|$)'), `${rel}/`],
    [re(`${K}/`), `${to.src.skillsDir}/`],
  ];
  // Protected literals: a reference to a concrete file (not to "my roles folder" in general) or documentation
  // of the two mirrors' construction itself - a regex cannot tell this from a general folder reference,
  // so the exception is explicit, by file and exact substring. Extend only by what a diff reveals.
  const protectedLiterals = {
    'core.md': [`${tick}${K}/*/SKILL.md${tick}`],
    'spec.md': [`agents in ${tick}${R}/${tick}, skills in ${tick}${K}/${tick}`],
    [path.join('run', 'run-image-series.md')]: [`(${tick}~/${from.dir}/skills/${tick}, not ${tick}${K}/${tick} of this project)`],
  };
  return { from, to, roleTransforms, onDemandTransforms: onDemand, protectedLiterals };
}

// An on-demand file that itself documents the mirror's construction (both real paths named side by side) -
// copied byte-for-byte, with not a single substitution.
const ON_DEMAND_EXCLUDE = new Set(['intent-housekeeping.md']);

function splitFrontmatter(text) {
  const m = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  if (!m) return { fm: null, body: text };
  return { fm: m[0], body: text.slice(m[0].length) };
}

function protect(body, literals) {
  const slots = [];
  let out = body;
  (literals || []).forEach((lit, i) => {
    const token = `\u0000PROT${i}\u0000`;
    if (out.includes(lit)) {
      out = out.split(lit).join(token);
      slots.push([token, lit]);
    }
  });
  return { out, slots };
}

function restore(body, slots) {
  let out = body;
  for (const [token, lit] of slots) out = out.split(token).join(lit);
  return out;
}

function transformBody(body, transforms, addTitleSuffix, literals) {
  let out = body.replace(/\r\n/g, '\n');
  const { out: protectedOut, slots } = protect(out, literals);
  out = protectedOut;
  for (const [re, to] of transforms) out = out.replace(re, to);
  out = restore(out, slots);
  if (addTitleSuffix) {
    out = out.replace(/^(\s*\n)*(# `[^`]+`)(\r?\n)/, (m0, lead, title, nl) => (lead || '') + title + ' (Gemini Engine)' + nl);
  }
  return out;
}

/** The list of role files (relative to the source's roles directory): the root six + `run/*.md`. */
function listRoleFiles(root, ctx) {
  const base = path.join(root, ctx.from.src.rolesDir);
  const top = fs.readdirSync(base).filter((f) => f.endsWith('.md'));
  const runDir = path.join(base, 'run');
  const run = fs.existsSync(runDir) ? fs.readdirSync(runDir).filter((f) => f.endsWith('.md')).map((f) => path.join('run', f)) : [];
  // A role the mirror carries under another name (equivalence table) has no pair by design: skipped.
  const skip = new Set(ROLE_EQUIVALENCE.map(([src]) => src + '.md'));
  const topPaired = top.filter((f) => !skip.has(f));
  return [...topPaired, ...run];
}

/** The list of on-demand files (relative to the source's roles-directory `on-demand/`). */
function listOnDemandFiles(root, ctx) {
  const dir = path.join(root, ctx.from.src.rolesDir, 'on-demand');
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.md')) : [];
}

/** The generated body for one role; the frontmatter is taken from the current destination file (never created). */
function renderRole(root, relFile, ctx = ctxOf(root)) {
  const claudeAbs = path.join(root, ctx.from.src.rolesDir, relFile);
  const geminiAbs = path.join(root, ctx.to.src.rolesDir, relFile);
  const claudeRaw = fs.readFileSync(claudeAbs, 'utf8');
  const { body } = splitFrontmatter(claudeRaw);
  const genBody = transformBody(body, ctx.roleTransforms, true, ctx.protectedLiterals[relFile]);
  if (!fs.existsSync(geminiAbs)) {
    return { ok: false, reason: 'missing_dest_frontmatter', content: null };
  }
  const destRaw = fs.readFileSync(geminiAbs, 'utf8').replace(/\r\n/g, '\n');
  const { fm: destFm } = splitFrontmatter(destRaw);
  if (!destFm) return { ok: false, reason: 'dest_has_no_frontmatter', content: null };
  return { ok: true, content: destFm + genBody };
}

/** The generated on-demand file: either a byte-for-byte copy (a file in the exclusions) or with the path substitution. */
function renderOnDemand(root, file, ctx = ctxOf(root)) {
  const claudeAbs = path.join(root, ctx.from.src.rolesDir, 'on-demand', file);
  const claudeRaw = fs.readFileSync(claudeAbs, 'utf8').replace(/\r\n/g, '\n');
  if (ON_DEMAND_EXCLUDE.has(file)) return { ok: true, content: claudeRaw };
  const content = transformBody(claudeRaw, ctx.onDemandTransforms, false, ctx.protectedLiterals[file]);
  return { ok: true, content };
}

/** All the pairs with their generated content and their state against disk. `kind`: role|on-demand. */
function planAll(root) {
  const ctx = ctxOf(root);
  if (!ctx) return []; // no source or sink adapter - no mirror
  const plan = [];
  for (const relFile of listRoleFiles(root, ctx)) {
    const destRel = path.join(ctx.to.src.rolesDir, relFile);
    const gen = renderRole(root, relFile, ctx);
    plan.push({ kind: 'role', relFile, destRel, gen });
  }
  for (const file of listOnDemandFiles(root, ctx)) {
    const destRel = path.join(ctx.to.src.rolesDir, 'on-demand', file);
    const gen = renderOnDemand(root, file, ctx);
    plan.push({ kind: 'on-demand', relFile: path.join('on-demand', file), destRel, gen });
  }
  return plan;
}

/** The status of one plan entry against disk: synced|drift|would_create|problem. */
function statusOf(root, entry) {
  if (!entry.gen.ok) return { status: 'problem', detail: entry.gen.reason };
  const destAbs = path.join(root, entry.destRel);
  if (!fs.existsSync(destAbs)) return { status: 'would_create' };
  const destRaw = fs.readFileSync(destAbs, 'utf8').replace(/\r\n/g, '\n');
  return destRaw === entry.gen.content ? { status: 'synced' } : { status: 'drift' };
}

/** `--check`: a report without writes. */
function checkAll(root) {
  const plan = planAll(root);
  return plan.map((entry) => ({ entry, res: statusOf(root, entry) }));
}

/** Translating the destination file's line-ending style back to `\r\n` when it was stored that way - the write
 * does not impose `\n` on a file that was `\r\n` before; the content (EOL-insensitive) does not change. */
function matchEol(content, destAbs) {
  if (!fs.existsSync(destAbs)) return content;
  const existing = fs.readFileSync(destAbs, 'utf8');
  const hadCrlf = /\r\n/.test(existing) && !/[^\r]\n/.test(existing.replace(/\r\n/g, ''));
  return hadCrlf ? content.replace(/\n/g, '\r\n') : content;
}

/** `--apply`: writes the drifting files (except `problem`), leaves the rest untouched. Idempotent. */
function applyAll(root, { dryRun = false } = {}) {
  const plan = planAll(root);
  const written = [];
  const unchanged = [];
  const problems = [];
  for (const entry of plan) {
    const res = statusOf(root, entry);
    if (res.status === 'problem') { problems.push({ relFile: entry.relFile, reason: res.detail }); continue; }
    if (res.status === 'synced') { unchanged.push(entry.relFile); continue; }
    const destAbs = path.join(root, entry.destRel);
    if (!dryRun) {
      fs.writeFileSync(destAbs, matchEol(entry.gen.content, destAbs), 'utf8');
    }
    written.push({ relFile: entry.relFile, was: res.status });
  }
  return { written, unchanged, problems };
}

module.exports = { planAll, checkAll, applyAll, renderRole, renderOnDemand, ctxOf };
