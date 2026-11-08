#!/usr/bin/env node
// Carries the project engine's edits back into the protocol source: the core - protocol/skills/forma/core/
// (the law, the manual, the dashboard with the economy module, the project/ scaffold), the adapters -
// protocol/skills/forma/adapters/<engine>/ (claude - ready; codex, gemini - "not ready", carried as is).
// For the author only: works only when protocol/ is a git clone (protocol/.git exists).
//   node .forma/protocol/scripts/engine-to-protocol.cjs      - show the classification, writes nothing
//   ... --apply                                              - carry over "engine only changed"
//   ... --apply <file> [<file> ...]                          - carry only the named files (paths from the project root); foreign divergences untouched
//   ... --add <project-path> [--add ...]                     - carry a new file explicitly
//   ... --mark                                               - record the base: engine = template at protocol/ HEAD
//   ... --before-push                                        - pre-push check: the version strictly above the published one
//
// The direction is decided by git, not by mtime (after clone/checkout mtime = the checkout time, it lies).
// The base is the protocol/ commit where the engine and the template last matched; kept in
// protocol/.git/forma-base (outside history, each clone has its own). Three contents per file:
// B = template@base, H = template now, E = engine. Engine only changed (E!=B, H=B) -> carried over;
// template only (E=B, H!=B) -> "update the Forma protocol"; both -> conflict, the human decides.
// No base - it is inferred per file: the newest template version from git log equal to E.
// Deliberate differences and noise - protocol/scripts/engine-to-protocol.exceptions.
// Printed labels come from the core dictionary: English key in code, ru value as data.
'use strict';
const fs = require('fs');
const path = require('path');
const { walk: walkTree } = require('../skills/forma/core/dashboard/lib/fs.cjs');
const { gitOut } = require('./lib/git.cjs');
const { readOwnLayer, isForbiddenTransfer } = require('./lib/forbidden-transfer.cjs');
const i18n = require('../skills/forma/core/i18n/index.cjs');
const msg = (code, params) => i18n.message(code, params, 'ru');

const root = process.cwd();
const protoDir = path.join(root, '.forma/protocol');
const FORMA_GIT = 'skills/forma';
const TPL_GIT = FORMA_GIT + '/core';
const tpl = path.join(protoDir, ...TPL_GIT.split('/'));
const forma = path.join(protoDir, ...FORMA_GIT.split('/'));
const baseFile = path.join(protoDir, '.git', 'forma-base');

if (!fs.existsSync(path.join(protoDir, '.git'))) {
  console.error(msg('e2p.no_git'));
  console.error(msg('e2p.run_from_root'));
  process.exit(2);
}
if (!fs.existsSync(tpl)) { console.error(msg('e2p.no_tpl', { path: path.relative(root, tpl) })); process.exit(2); }

const args = process.argv.slice(2);
const git = (...a) => gitOut(protoDir, ...a);

// --before-push: after pull --rebase, before push. The same bump on both sides of git merges SILENTLY
// (the lines matched - no conflict), and two releases get one number. Caught here.
if (args.includes('--before-push')) {
  const ver = (ref) => JSON.parse(git('show', ref + ':.claude-plugin/plugin.json')).version;
  const cmp = (x, y) => { const a = x.split('-')[0].split('.').map(Number), b = y.split('-')[0].split('.').map(Number);
    for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] || 0) - (b[i] || 0); if (d) return d; } return 0; };
  let up; try { up = git('rev-parse', '--abbrev-ref', '@{u}').trim(); } catch { console.error(msg('e2p.no_upstream')); process.exit(2); }
  if (git('status', '--porcelain').trim()) { console.error(msg('e2p.dirty_protocol')); process.exit(1); }
  const mine = ver('HEAD'), theirs = ver(up);
  if (git('rev-list', '--count', up + '..HEAD').trim() === '0') { console.log(msg('e2p.nothing_to_push', { up })); process.exit(0); }
  if (git('rev-list', '--count', 'HEAD..' + up).trim() !== '0') { console.error(msg('e2p.up_ahead', { up })); process.exit(1); }
  if (cmp(mine, theirs) <= 0) { console.error(msg('e2p.version_not_higher', { mine, theirs, up })); process.exit(1); }
  console.log(msg('e2p.push_ok', { theirs, mine }));
  process.exit(0);
}
const apply = args.includes('--apply');
const mark = args.includes('--mark');
const adds = [];
const named = [];   // names after --apply: only they are carried
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--add' && args[i + 1]) adds.push(args[++i].replace(/\\/g, '/'));
  else if (!args[i].startsWith('--')) named.push((path.isAbsolute(args[i]) ? path.relative(root, args[i]) : args[i]).replace(/\\/g, '/').replace(/^\.\//, ''));
}

// --- exceptions ---
const SKIP = [], MASK = {};
const excFile = path.join(protoDir, 'scripts', 'engine-to-protocol.exceptions');
if (fs.existsSync(excFile)) {
  for (const raw of fs.readFileSync(excFile, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(skip|mask)\s+(\S+)(?:\s+(.+))?$/);
    if (!m) { console.error(msg('e2p.bad_exception_line', { raw })); process.exit(2); }
    if (m[1] === 'skip') SKIP.push(new RegExp(m[2]));
    else (MASK[m[2]] = MASK[m[2]] || []).push(new RegExp(m[3]));
  }
}
// Layer 4 (.claude/project-layer.txt) and zones that can never physically be in the protocol template -
// not "new": not carried by --apply, --add, nor caught by the MAP (lib/forbidden-transfer.cjs).
const OWN_LAYER = readOwnLayer(root);
const forbidden = (rel) => isForbiddenTransfer(rel, OWN_LAYER);
// Copies from project/extensions/ (the template/ and custom/ folders and the unsorted <engine>/) - the
// project's files, not the engine's: neither "new" nor "engine changed" (extensions.cjs sources).
// The source of truth - project/extensions/.
const EXT_DST = new Set();
try { for (const x of require('../skills/forma/core/extensions/extensions.cjs').sources(root)) EXT_DST.add(x.dst.split(path.sep).join('/')); } catch { /* no module - no copies */ }
// The engine's own tooling (the run-protocol-* profiles: board, dashboard, core, adapter, checks edits) -
// the protocol's kit, even when the project delivers them as a copy from project/extensions/: they go
// into the template so any project could fix the engine.
const ENGINE_TOOLING = /(^|\/)agents\/run\/run-protocol-[^/]+\.md$/;
const isExtCopy = (rel) => !ENGINE_TOOLING.test(rel) && (EXT_DST.has(rel) || [...EXT_DST].some((d) => d.startsWith(rel + '/')));
const skipped = (rel) => forbidden(rel) || isExtCopy(rel) || SKIP.some((r) => r.test(rel));
const MASKED = '\u0000masked\u0000';
const norm = (s) => s.replace(/\r\n/g, '\n');
const mask = (rel, s) => { if (s == null) return null; const rs = MASK[rel]; s = norm(s);
  return rs ? s.split('\n').map((l) => (rs.some((r) => r.test(l)) ? MASKED : l)).join('\n') : s; };

// project -> template. living/ and project/ excluded deliberately: they are a concrete project's history
// and content. Template paths - from protocol/skills/forma/. Only files already present in the template
// are compared.
// Dormant Codex (`.forma/engines.json`): its folder is not carried into the protocol source; the shared `.agents/skills` mirror still is.
const CODEX_ASLEEP = (() => { try { return JSON.parse(fs.readFileSync('.forma/engines.json', 'utf8')).dormant.includes('codex'); } catch { return false; } })();
const MAP = [
  // core
  ['AGENTS.md', 'core/AGENTS.md'],
  ['.forma/dashboard', 'core/dashboard'],
  ['.forma/manual', 'core/manual'],
  ['.forma/skills', 'core/skills'],   // the interview - core; .claude/skills/<interview> - the delivered copy, does not go into the adapter
  ['.forma/board', 'core/board'],
  ['.forma/i18n', 'core/i18n'],   // the key dictionary (§6) and the installer texts
  ['.forma/plumb', 'core/plumb'],   // the Plumb: plumb-run.cjs and neighbours
  ['.forma/engines.json', 'core/engines.json'],   // the registry of sleeping engines
  // the Claude adapter (the Claude transcript readers live in the project's .forma/dashboard but belong to the adapter)
  ['.claude/forma-adapter.cjs', 'adapters/claude/forma-adapter.cjs'],   // the core-adapter boundary: `dashboard/lib/engines.cjs`
  ['.claude/permission-levels.json', 'adapters/claude/permission-levels.json'],   // access levels: read by permissions-level.cjs
  ['.claude/agents', 'adapters/claude/agents'],
  ['.claude/hooks', 'adapters/claude/hooks'],
  ['.claude/rules', 'adapters/claude/rules'],
  ['.claude/scripts', 'adapters/claude/scripts'],
  ['.claude/skills', 'adapters/claude/skills'],
  ['.forma/dashboard', 'adapters/claude/dashboard', { noFresh: true }],
  // "not ready" adapters - as is
  ['.agents/forma-adapter.cjs', 'adapters/gemini/forma-adapter.cjs'],   // the core-adapter boundary: `dashboard/lib/engines.cjs`
  ['.agents/plugins/forma/agents', 'adapters/gemini/agents'],
  ['.agents/rules', 'adapters/gemini/rules'],
  ['.agents/tests', 'adapters/gemini/tests'],                           // the adapter conformance test (wired in adapter-conformance.cjs)
  ['.agents/hooks', 'adapters/gemini/hooks'],
  ['.agents/scripts', 'adapters/gemini/scripts'],
  ['.agents/skills', 'adapters/codex/.agents/skills'],
  ['.codex', 'adapters/codex/.codex'],
  // MiniMax: a stub in the template, the engine sleeps by default; carried regardless of the sleeping registry
  ['.minimax', 'adapters/minimax/.minimax'],
  ['miniapps/minimax-engine', 'adapters/minimax/miniapps/minimax-engine'],
  // ZCode: flat subpaths, as gemini; the machine .state/ does not go into the template
  ['.zcode/forma-adapter.cjs', 'adapters/zcode/forma-adapter.cjs'],
  ['.zcode/rules', 'adapters/zcode/rules'],
  ['.zcode/scripts', 'adapters/zcode/scripts'],
  ['.zcode/tests', 'adapters/zcode/tests'],
  ['.zcode/agents', 'adapters/zcode/agents'],
].filter(([p]) => !(CODEX_ASLEEP && p === '.codex'));
// A project file already known to one of the mappings (e.g. dashboard/floor.cjs - the Claude adapter)
// is not "new" for another mapping of the same directory.
const KNOWN = new Set();
for (const [p, t] of MAP) {
  const tAbs = path.join(forma, t);
  if (!fs.existsSync(tAbs)) continue;
  if (fs.statSync(tAbs).isFile()) KNOWN.add(p); else for (const f of walk(tAbs)) KNOWN.add(p + '/' + f);
}

// Files under a directory (paths through "/"); the file itself - `['']`; no path - `[]`.
function walk(abs) {
  return fs.existsSync(abs) && fs.statSync(abs).isFile() ? [''] : walkTree(abs, { symlinks: true });
}
// The count of lines present in one version and absent in the other (multiset)
function ldiff(a, b) {
  const m = new Map(); let d = 0;
  for (const l of a.split('\n')) m.set(l, (m.get(l) || 0) + 1);
  for (const l of b.split('\n')) { const k = m.get(l) || 0; if (k) m.set(l, k - 1); else d++; }
  for (const v of m.values()) d += v;
  return d;
}
// The core/adapters split renamed the template's directories; a base from before the split knows the file by the old path.
const LEGACY = [[FORMA_GIT + '/core/', FORMA_GIT + '/template/'], [FORMA_GIT + '/adapters/claude/dashboard/', FORMA_GIT + '/template/dashboard/'],
  [FORMA_GIT + '/adapters/claude/', FORMA_GIT + '/template/'], [FORMA_GIT + '/adapters/gemini/', FORMA_GIT + '/templates-gemini/'],
  [FORMA_GIT + '/adapters/codex/', FORMA_GIT + '/templates-codex/']];
const show0 = (ref, gp) => { try { return git('show', ref + ':' + gp); } catch { return null; } };
const show1 = (ref, gp) => { const v = show0(ref, gp); if (v != null) return v;
  const l = LEGACY.find(([n]) => gp.startsWith(n)); return l ? show0(ref, l[1] + gp.slice(l[0].length)) : null; };

let base = null;
if (fs.existsSync(baseFile)) {
  base = fs.readFileSync(baseFile, 'utf8').trim();
  try { git('cat-file', '-e', base + '^{commit}'); } catch { console.error(msg('e2p.base_not_found', { base })); process.exit(2); }
}

// classes: engine - the engine only changed; template - the template only; conflict - both; same - only the exceptions differ
const R = { engine: [], template: [], conflict: [], same: [], fresh: [] };
for (const [p, t, opt] of MAP) {
  const pAbs = path.join(root, p), tAbs = path.join(forma, t);
  const isFile = fs.existsSync(tAbs) && fs.statSync(tAbs).isFile();
  const tFiles = walk(tAbs);
  // A project file not yet in the template - new; carried by --add (a directory never becomes one by this entry).
  if (!isFile && !fs.existsSync(tAbs) && fs.existsSync(pAbs) && fs.statSync(pAbs).isFile()) {
    if (!skipped(p)) R.fresh.push({ rel: p, src: pAbs, dst: tAbs });
    continue;
  }
  for (const f of tFiles) {
    const src = isFile ? pAbs : path.join(pAbs, f);
    const dst = isFile ? tAbs : path.join(tAbs, f);
    const rel = isFile ? p : p + '/' + f;
    const gp = FORMA_GIT + '/' + (isFile ? t : t + '/' + f);
    if (skipped(rel) || !fs.existsSync(src)) continue;
    const eRaw = fs.readFileSync(src, 'utf8'), hRaw = fs.readFileSync(dst, 'utf8');
    if (norm(eRaw) === norm(hRaw)) continue;
    const E = mask(rel, eRaw), H = mask(rel, hRaw);
    const x = { rel, src, dst, eRaw, hRaw };
    if (E === H) { R.same.push(x); continue; }
    let B, how;
    if (base) { B = mask(rel, show1(base, gp)); how = msg('e2p.how_base', { sha: base.slice(0, 7) }); }
    else {
      // no base recorded: the newest template version equal to the engine
      const revs = git('log', '--follow', '--format=%H', '--', gp).split('\n').filter(Boolean);
      const hit = revs.find((c) => mask(rel, show1(c, gp)) === E);
      if (hit) { B = E; how = msg('e2p.how_engine_equals', { sha: hit.slice(0, 7) }); }
      else {
        // no exact hit: an estimate - the template version nearest to the engine (fewest differing lines)
        let best = null, bd = Infinity;
        for (const c of revs) { const v = mask(rel, show1(c, gp)); if (v == null) continue; const d = ldiff(E, v); if (d < bd) { bd = d; best = { c, v }; } }
        B = best ? best.v : H;
        how = best ? msg('e2p.how_estimate', { sha: best.c.slice(0, 7), head: best.c === revs[0] ? ' (HEAD)' : '' }) : msg('e2p.how_no_history');
      }
    }
    x.how = how;
    const eCh = E !== B, hCh = H !== B;
    (eCh && hCh ? R.conflict : eCh ? R.engine : R.template).push(x);
  }
  if (isFile || (opt && opt.noFresh)) continue;
  const known = new Set(tFiles);
  const topKnown = new Set(tFiles.map((f) => f.split('/')[0]));
  const newSkillDirs = new Set();   // a new skill folder: one "new" item for the whole folder, not per file inside
  for (const f of walk(pAbs)) {
    const rel = p + '/' + f;
    if (known.has(f) || KNOWN.has(rel) || skipped(rel)) continue;
    if (/skills$/.test(t)) {
      const top = f.split('/')[0];
      if (!topKnown.has(top)) { newSkillDirs.add(top); continue; }
    }
    R.fresh.push({ rel, src: path.join(pAbs, f), dst: path.join(tAbs, f) });
  }
  for (const top of newSkillDirs) {
    const rel = p + '/' + top;
    if (skipped(rel)) continue;
    R.fresh.push({ rel, src: path.join(pAbs, top), dst: path.join(tAbs, top), dir: true });
  }
}

// Cross-check with the project's installed template (project/config/PROJECT.md, "Project template", k:name):
// templates/<template>/skills/<template>/template/{scripts,agents/run}/ - product files, not the engine.
// Those matching the template are removed from "new"; diverging ones - a separate list, untouched, not carried.
R.templateProject = [];
const pmPath = path.join(root, 'project/config/PROJECT.md');
const tplName = fs.existsSync(pmPath) && (fs.readFileSync(pmPath, 'utf8').match(/k:name\s*--> \| `([^`]+)`/) || [])[1];
if (tplName) {
  const tplRoot = path.join(protoDir, 'templates', tplName, 'skills', tplName, 'template');
  for (const [projRel, tplSub] of [['.claude/scripts', 'scripts'], ['.claude/agents/run', 'agents/run']]) {
    const tplAbs = path.join(tplRoot, tplSub);
    if (!fs.existsSync(tplAbs)) continue;
    for (const f of walk(tplAbs)) {
      const rel = projRel + '/' + f;
      const projFile = path.join(root, projRel, f);
      if (!fs.existsSync(projFile)) continue;
      const i = R.fresh.findIndex((x) => x.rel === rel);
      if (i !== -1) R.fresh.splice(i, 1);
      const a = norm(fs.readFileSync(projFile, 'utf8')), b = norm(fs.readFileSync(path.join(tplAbs, f), 'utf8'));
      if (a !== b) R.templateProject.push({ rel });
    }
  }
}

console.log(msg('e2p.base_line', {
  base: base ? msg('e2p.base_recorded', { sha: base.slice(0, 7) }) : msg('e2p.base_unrecorded'),
}));
const out = (title, list) => { console.log(`${title}: ${list.length}`); for (const x of list) console.log('  ' + x.rel + (x.how ? '   [' + x.how + ']' : '')); };
out(msg('e2p.title_engine_only'), R.engine);
out(msg('e2p.title_template_only'), R.template);
out(msg('e2p.title_conflict'), R.conflict);
out(msg('e2p.title_same'), R.same);
out(msg('e2p.title_fresh'), R.fresh);
out(msg('e2p.title_template_project'), R.templateProject);

if (mark) {
  const dirty = R.engine.length + R.template.length + R.conflict.length;
  if (dirty) { console.error(msg('e2p.mark_dirty', { count: dirty })); process.exit(1); }
  if (git('status', '--porcelain', '--', FORMA_GIT).trim()) { console.error(msg('e2p.mark_dirty_tree')); process.exit(1); }
  const head = git('rev-parse', 'HEAD').trim();
  fs.writeFileSync(baseFile, head + '\n');
  console.log(msg('e2p.mark_done', { sha: head }));
  process.exit(0);
}

// A new file in an engine folder that sits in neither project/extensions/template/ nor custom/, is not in
// the protocol template and is not named in --add - unsorted: stop with a question; silently neither carried nor left.
const ENGINE_PREFIX = CODEX_ASLEEP ? ['.claude/', '.agents/'] : ['.claude/', '.agents/', '.codex/'];
const unsorted = R.fresh.filter((x) => ENGINE_PREFIX.some((e) => x.rel.startsWith(e)) && !adds.includes(x.rel));
if (unsorted.length) {
  console.error(msg('e2p.unsorted_header'));
  for (const x of unsorted) console.error('  ' + x.rel);
  console.error(msg('e2p.unsorted_question'));
  console.error(msg('e2p.unsorted_answer'));
  console.error(msg('e2p.unsorted_add'));
  process.exit(3);
}

const forbiddenAdds = adds.filter(forbidden);
if (forbiddenAdds.length) {
  console.error(msg('e2p.add_forbidden', { list: forbiddenAdds.join(', ') }));
  process.exit(1);
}
const bad = adds.filter((a) => !R.fresh.some((x) => x.rel === a));
if (bad.length) { console.error(msg('e2p.add_not_fresh', { list: bad.join(', ') })); process.exit(1); }
if (named.length && !apply) { console.error(msg('e2p.named_needs_apply')); process.exit(1); }
const only = apply && named.length ? new Set(named) : null;
if (only) {
  // the refusal is whole, before any write: every name must be in "engine only changed" or in "new" (with --add)
  const refuse = [];
  for (const nm of only) {
    if (R.engine.some((x) => x.rel === nm)) continue;
    let why;
    if (R.fresh.some((x) => x.rel === nm)) {
      if (adds.includes(nm)) continue;   // named in --apply and in --add alike: carried below
      why = msg('e2p.refuse_fresh', { path: nm });
    }
    else if (R.conflict.some((x) => x.rel === nm)) why = msg('e2p.refuse_conflict');
    else if (R.template.some((x) => x.rel === nm)) why = msg('e2p.refuse_template');
    else if (R.same.some((x) => x.rel === nm)) why = msg('e2p.refuse_same');
    else if (forbidden(nm) || isExtCopy(nm) || SKIP.some((r) => r.test(nm))) why = msg('e2p.refuse_excluded');
    else if (!MAP.some(([p]) => nm === p || nm.startsWith(p + '/'))) why = msg('e2p.refuse_outside_map');
    else why = msg('e2p.refuse_no_diff');
    refuse.push(msg('e2p.refuse_line', { name: nm, why }));
  }
  if (refuse.length) { console.error(msg('e2p.apply_refused', { list: refuse.join('\n') })); process.exit(1); }
}
if (!apply) { console.log(msg('e2p.nothing_written', { add: R.fresh.length ? msg('e2p.add_hint') : '' })); process.exit(0); }

// the carry: the engine's content, but masked lines are taken from the template (the de-identification does not leak)
function merge(x) {
  const rs = MASK[x.rel];
  if (!rs) return norm(x.eRaw);
  const tl = norm(x.hRaw).split('\n').filter((l) => rs.some((r) => r.test(l)));
  const el = norm(x.eRaw).split('\n');
  if (el.filter((l) => rs.some((r) => r.test(l))).length !== tl.length) return null;
  let i = 0;
  return el.map((l) => (rs.some((r) => r.test(l)) ? tl[i++] : l)).join('\n');
}
let n = 0;
for (const x of R.engine) {
  if (only && !only.has(x.rel)) continue;
  const c = merge(x);
  if (c == null) { console.error(msg('e2p.skipped_mask', { rel: x.rel })); continue; }
  fs.writeFileSync(x.dst, x.hRaw.includes('\r\n') ? c.replace(/\n/g, '\r\n') : c); n++;
}
for (const x of R.fresh.filter((x) => adds.includes(x.rel) && (!only || only.has(x.rel)))) {
  fs.mkdirSync(path.dirname(x.dst), { recursive: true });
  if (x.dir) fs.cpSync(x.src, x.dst, { recursive: true }); else fs.copyFileSync(x.src, x.dst);
  n++;
}
console.log(msg('e2p.transferred', { count: n }));
