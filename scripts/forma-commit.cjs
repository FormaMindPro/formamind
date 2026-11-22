#!/usr/bin/env node
// The engine commit without drift: Claude -> Gemini/Codex -> the protocol source -> commits.
// For the protocol author, in any project whose protocol/ is a git clone of FormaMindPro/formamind. Run from the project root.
//   node .forma/protocol/scripts/forma-commit.cjs "message"          - sync, check, commit the staged paths + the protocol pointer
//   ... --files <path...> | --card NNN                            - commit exactly these project paths (plus the pointer)
//   ... --all                                                     - allow the whole project tree (git add -A)
//   ... --check                                                   - check only, writes nothing (for pre-commit)
//   ... --release [--to X.Y.Z]                                    - release now: dev -> main, version +1 (or the named one), push main and dev
//   ... --push                                                    - push dev (version unchanged) and the project, if it has a remote
// Protocol commits go into the dev branch without a version; once N accumulate (PROJECT.md, the "Protocol release" line) - the release runs by itself.
//   ... --sync-staged                                             - core and adapter check before the commit (pre-commit calls it); roles are not copied between engines
//   ... --sync-plugin                                             - update the Claude Code plugin from GitHub (marketplace + plugin update) and verify versions; after --release this runs by itself, --no-plugin turns it off
//   ... --install-hook                                            - install .git/hooks/pre-commit (any run installs it by itself)
//
// Order: sync-engines --check (core + adapters by the conformance test; roles are not copied between engines) ->
// engine-to-protocol --apply (core/, adapters/claude/, adapters/codex/, adapters/gemini/) ->
// commit protocol/ into dev + --mark -> commit the project (the named or staged paths and the protocol pointer, never a blind tree).
// Stop on a conflict or "only the template changed": the human decides that ("update the Forma protocol").
'use strict';
const fs = require('fs');
const path = require('path');
const { walk: walkTree, projectFile } = require('../skills/forma/core/dashboard/lib/fs.cjs');
const { run, gitRun } = require('./lib/git.cjs');
const { scanTraces, scanMessages } = require('./check-release.cjs');
const i18n = require('../skills/forma/core/i18n/index.cjs');
const tr = (code, params) => i18n.message(code, params, 'en');

const root = process.cwd();

// Git directories, not the assumption that `.git` is a directory: in a linked worktree `.git` is a file and the
// real directories live under the main clone's `.git/worktrees/<name>`. The common dir is shared by every worktree,
// so the pre-commit hook goes there once for all of them. No answer from git - the plain `.git` of the root.
function gitDirOf(dir, flag) {
  const r = gitRun(dir, 'rev-parse', '--path-format=absolute', flag);
  const lines = r.code === 0 ? r.out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : [];
  return path.resolve(lines.find((l) => /^[A-Za-z]:[\\/]|^\//.test(l)) || path.join(dir, '.git'));
}
const GIT_DIR = gitDirOf(root, '--git-dir');
const COMMON_DIR = gitDirOf(root, '--git-common-dir');
const LINKED = GIT_DIR !== COMMON_DIR;
const MAIN_ROOT = LINKED ? path.dirname(COMMON_DIR) : root;

// The protocol clone: the worktree's own copy once its submodule is initialized, otherwise the main clone's -
// a linked worktree starts without one. No clone in either place is still a stop.
const protoLocal = path.join(root, '.forma/protocol');
const protoMain = path.join(MAIN_ROOT, '.forma/protocol');
const proto = fs.existsSync(path.join(protoLocal, '.git')) ? protoLocal
  : LINKED && fs.existsSync(path.join(protoMain, '.git')) ? protoMain : protoLocal;
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const toAt = args.indexOf('--to'); // --release --to X.Y.Z: release with the named version instead of +1 to the patch
const toVer = toAt >= 0 ? args[toAt + 1] : null;
const cardAt = args.indexOf('--card');
const cardNum = cardAt >= 0 ? args[cardAt + 1] : null;
const filesAt = args.indexOf('--files');
let filesList = null;
if (filesAt >= 0) {
  filesList = [];
  for (let i = filesAt + 1; i < args.length; i++) {
    if (args[i].startsWith('--')) break;
    filesList.push(args[i]);
  }
}
const msg = args.find((a, i) => !a.startsWith('--') && !(toAt >= 0 && i === toAt + 1) && !(cardAt >= 0 && i === cardAt + 1) && !(filesAt >= 0 && i > filesAt && (filesList && filesList.includes(a))));
// The protocol receives a clean message: the leading project card marker ("Card NNN: ...") is dropped,
// it stays in the project's commit. Any other trace in the message is a stop.
const protoMsg = msg ? msg.replace(/^\s*(?:\u043a\u0430\u0440\u0442\u043e\u0447\u043a\p{L}*|card)[\s-]*\d{2,3}\s*[:—-]\s*/iu, '') : '';
const CO = 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>';

const node = (script, ...a) => run('node', [script, ...a]);
const git = (...a) => gitRun(root, ...a);
const pgit = (...a) => gitRun(proto, ...a);
const stop = (m, code = 1) => { console.error(tr('commit.stop_prefix') + m); process.exit(code); };
const ok = (m) => console.log('✓ ' + m);

if (!fs.existsSync(path.join(proto, '.git'))) stop(tr('commit.no_git'), 2);

// Release by volume: commits accumulate in `dev`, the version is raised once per release.
// N - PROJECT.md, the "Protocol release" line; no line - 10.
const RELEASE_N = (() => {
  try { const m = fs.readFileSync(projectFile(root, 'PROJECT.md'), 'utf8').match(/\u0412\u044b\u043f\u0443\u0441\u043a \u043f\u0440\u043e\u0442\u043e\u043a\u043e\u043b\u0430[^\n]*?(\d+)\s*$/m); if (m) return +m[1]; } catch { /* no PROJECT.md or release line - the default below applies */ }
  return 10;
})();
const hasDev = () => !!pgit('rev-parse', '--verify', '-q', 'refs/heads/dev').out.trim();
const pending = () => hasDev()
  ? pgit('log', '--no-merges', '--format=%s', 'main..dev').out.split(/\r?\n/).filter(Boolean) : [];
function onDev() {
  if (pgit('rev-parse', '--abbrev-ref', 'HEAD').out.trim() === 'dev') return;
  const r = hasDev() ? pgit('checkout', '-q', 'dev') : pgit('checkout', '-q', '-b', 'dev');
  if (r.code) stop(tr('commit.no_checkout_dev', { out: r.out }));
}
function stopTraces(files, msgs) {
  const lines = files.slice(0, 40).map((b) => tr('commit.trace_file_line', b))
    .concat(msgs.map((b) => tr('commit.trace_message', b)));
  stop(tr('commit.stop_traces', { lines: lines.join('\n') }));
}
// The Claude Code plugin is installed from the same GitHub repository (the forma marketplace): there is no separate
// publication, its copy needs updating. Five places are verified: origin/main, the tag, package.json, plugin.json and the installed plugin.
function claudeCli(a) {
  const r = require('child_process').spawnSync('claude', a, { encoding: 'utf8', shell: process.platform === 'win32' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
function syncPlugin(expected) {
  pgit('fetch', '-q', '--tags', 'origin');
  const remote = (f) => { try { return JSON.parse(pgit('show', 'origin/main:' + f).out).version; } catch { return null; } };
  const want = expected || remote('package.json');
  const rows = [['origin/main package.json', remote('package.json')], ['origin/main plugin.json', remote('.claude-plugin/plugin.json')]];
  const tag = pgit('ls-remote', '--tags', 'origin', 'refs/tags/v' + want).out.trim();
  rows.push([tr('commit.tag_row', { version: want }), tag ? want : null]);
  const cli = claudeCli(['--version']);
  if (cli.code !== 0) { console.log(tr('commit.plugin_cli_missing')); }
  else {
    const m = claudeCli(['plugin', 'marketplace', 'update', 'forma']);
    if (m.code) console.log(tr('commit.plugin_marketplace_fail', { out: m.out }));
    const u = claudeCli(['plugin', 'update', 'forma@forma']);
    if (u.code) console.log(tr('commit.plugin_update_fail', { out: u.out }));
    let installed = null;
    try {
      const all = JSON.parse(claudeCli(['plugin', 'list', '--json']).out).filter((x) => x.id === 'forma@forma');
      installed = (all.find((x) => x.scope === 'user') || {}).version || null;
      // project-scoped installations are updated only from their own project: name them, do not touch them
      for (const x of all.filter((y) => y.scope !== 'user' && y.version !== want)) {
        console.log(tr('commit.plugin_project_scope', { path: x.projectPath, version: x.version, scope: x.scope }));
      }
    } catch { /* the list did not parse */ }
    rows.push([tr('commit.plugin_row_user'), installed]);
  }
  let good = true;
  for (const [what, v] of rows) {
    if (v === want) ok(`${what}: ${v}`); else { good = false; console.log(tr('commit.row_mismatch', { what, value: v || tr('commit.no_value'), want })); }
  }
  if (good) console.log(tr('commit.restart_plugin'));
  return good;
}
let manifestRefreshed = false; // the project's install manifest was rewritten in this run - stage it beside the pointer
// The install manifest follows the dev clone (the source project): version and line from the clone's
// package.json, hashes from the disk - the dev tree is the release content. Returns the refresh summary.
function refreshProjectManifest(version) {
  const VI = require(path.join(proto, 'skills', 'forma', 'core', 'verify', 'verify-install.cjs')); // the clone's copy, fresh after the carry-over
  if (typeof VI.refreshManifest !== 'function') return null; // an older clone: nothing to call yet
  let pj = null; try { pj = JSON.parse(fs.readFileSync(path.join(proto, 'package.json'), 'utf8')); } catch { /* no clone package */ }
  const ref = VI.refreshManifest(root, { version: version != null ? version : pj && pj.version, line: pj && pj.line });
  if (ref) { ok(tr('commit.manifest_refreshed', { version: ref.version, changed: ref.changed, missing: ref.missing.length })); manifestRefreshed = true; }
  return ref;
}
// The release body is the CHANGELOG section of the version: a locally created release must not be a
// placeholder, because the repository's release workflow skips an existing release and its notes stay empty.
function changelogNotes(version, previous) {
  let text;
  try { text = fs.readFileSync(path.join(proto, 'CHANGELOG.md'), 'utf8').replace(/\r\n/g, '\n'); } catch { return null; }
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.trim() === `## [${version}]` || l.startsWith(`## [${version}] `));
  if (start < 0) return null;
  const out = [];
  for (let i = start + 1; i < lines.length && !/^## \[/.test(lines[i]); i++) out.push(lines[i]);
  const section = out.join('\n').trim();
  if (!section) return null;
  return `${section}\n\n**Full Changelog**: https://github.com/FormaMindPro/formamind/compare/v${previous}...v${version}`;
}
function release() {
  const list = pending();
  const dirty = scanMessages(list);
  if (dirty.length) stopTraces([], dirty);
  if (!list.length) { ok(tr('commit.release_no_commits')); return; }
  if (pgit('status', '--porcelain').out.trim()) stop(tr('commit.release_dirty'));
  // The pre-release check: carry-over corruptions, tests, linter. Red - no release, nothing merged or pushed.
  const chkArgs = [path.join(proto, 'scripts', 'check-release.cjs')].concat(has('--no-tests') ? ['--no-tests'] : []);
  const chk = run('node', chkArgs);
  if (chk.code) stop(tr('commit.release_check_failed', { out: chk.out }));
  ok(tr('commit.release_check_ok'));
  pgit('fetch', '-q', 'origin');
  let r = pgit('checkout', '-q', 'main');
  if (r.code) stop(tr('commit.no_main', { out: r.out }));
  r = pgit('merge', '--ff-only', '-q', 'origin/main');
  if (r.code) { pgit('checkout', '-q', 'dev'); stop(tr('commit.main_diverged', { out: r.out })); }
  r = pgit('merge', '--no-ff', '--no-commit', 'dev');
  if (r.code) { pgit('merge', '--abort'); pgit('checkout', '-q', 'dev'); stop(tr('commit.merge_conflict', { out: r.out })); }
  const pj = path.join(proto, '.claude-plugin', 'plugin.json');
  const j = fs.readFileSync(pj, 'utf8');
  const v = JSON.parse(j).version, m = v.match(/^(\d+)\.(\d+)\.(\d+)(-[\w.]+)?$/);
  if (!m) stop(tr('commit.bad_version', { v }));
  const nv = toVer || `${m[1]}.${m[2]}.${+m[3] + 1}${m[4] || ''}`; // the stage label (-alpha) is carried over as is
  if (toVer && !/^\d+\.\d+\.\d+$/.test(toVer)) { pgit('merge', '--abort'); pgit('checkout', '-q', 'dev'); stop(tr('commit.bad_to_version', { to: toVer })); }
  fs.writeFileSync(pj, j.replace(`"version": "${v}"`, `"version": "${nv}"`));
  const pk = path.join(proto, 'package.json'); // package.json carries the same version as plugin.json
  const pkj = fs.readFileSync(pk, 'utf8');
  fs.writeFileSync(pk, pkj.replace(/"version": "[^"]*"/, `"version": "${nv}"`));
  const pkl = path.join(proto, 'package-lock.json');
  if (fs.existsSync(pkl)) {
    // The lock carries its own version: a release that skipped it (a manual cut) must not leave the
    // three version files disagreeing. Lift the lock from whatever it says to the new version.
    const lock = JSON.parse(fs.readFileSync(pkl, 'utf8'));
    lock.version = nv;
    if (lock.packages && lock.packages['']) lock.packages[''].version = nv;
    fs.writeFileSync(pkl, JSON.stringify(lock, null, 2) + '\n');
  }
  pgit('add', '--', '.claude-plugin/plugin.json', 'package.json', ...(fs.existsSync(pkl) ? ['package-lock.json'] : []));
  r = pgit('commit', '-q', '-m', `v${nv} — ${list.length} commit(s)\n\n${list.reverse().map((s) => '- ' + s).join('\n')}\n\n${CO}`);
  if (r.code) stop(tr('commit.merge_commit_failed', { out: r.out }));
  ok(tr('commit.released', { v, nv, n: list.length }));
  refreshProjectManifest(nv); // the manifest carries the version just shipped
  const bp = node(E2P, '--before-push');
  if (bp.code) stop(bp.out);
  r = pgit('push', '-q', 'origin', 'main');
  if (r.code) stop(tr('commit.push_main_failed', { out: r.out }));
  pgit('checkout', '-q', 'dev');
  r = pgit('merge', '--ff-only', '-q', 'main');
  if (r.code) stop(tr('commit.dev_behind_main', { out: r.out }));
  r = pgit('push', '-q', '-u', 'origin', 'dev');
  if (r.code) stop(tr('commit.push_dev_failed', { out: r.out }));
  const mk = node(E2P, '--mark');
  if (mk.code) console.error(tr('commit.mark_failed', { out: mk.out }));
  ok(tr('commit.pushed'));
  try {
    if (run('gh', ['auth', 'status']).code === 0) {
      // The body comes from CHANGELOG.md; the workflow's own release would be skipped once this one exists.
      const notes = changelogNotes(nv, v) || `Release v${nv}`;
      const rel = run('gh', ['release', 'create', `v${nv}`, '--title', nv, '--notes', notes, '--latest', '-R', 'FormaMindPro/formamind']);
      if (rel.code === 0) ok(tr('commit.gh_release_created', { v: nv }));
      else console.log(tr('commit.gh_release_failed', { out: rel.out }));
    } else {
      console.log(tr('commit.gh_no_auth'));
    }
  } catch {
    console.log(tr('commit.gh_missing'));
  }
  if (!has('--no-plugin')) syncPlugin(nv);
  git('add', '.forma/protocol');
  if (manifestRefreshed) git('add', '.forma/install-manifest.json');
  if (git('diff', '--cached', '--quiet').code) git('commit', '-q', '-m', `Protocol release v${nv}: ${list.length} commit(s)\n\n${CO}`);
}
const ENG = '.claude/scripts/sync-engines.cjs';
const CDX = '.codex/scripts/sync-codex.cjs';
// The engine's script of the resolved clone: a relative path in a normal tree, the main clone's absolute path in a
// linked worktree whose own submodule is not initialized - the object of the check is the same template either way.
const E2P = proto === protoLocal ? '.forma/protocol/scripts/engine-to-protocol.cjs' : path.join(proto, 'scripts', 'engine-to-protocol.cjs');
function codexDormant() { try { return JSON.parse(fs.readFileSync('.forma/engines.json', 'utf8')).dormant.includes('codex'); } catch { return false; } }

// The project's pre-commit: any commit, a plain git commit too, carries Claude -> Gemini/Codex
// and takes their files into the same commit. Carrying into the protocol source and the version - still forma-commit.
// First in the hook is the version-freeze gate (goal-freeze.cjs): if this constant rewrites the hook, the gate restores it itself.
// The hook lives in the common dir - one hook for the main clone and its worktrees. Its body finds the script by itself:
// a worktree without the submodule falls back to the first worktree of the list, which is the main clone.
const HOOK = path.join(COMMON_DIR, 'hooks', 'pre-commit');
const HOOK_BODY = '#!/bin/sh\n# forma: ' + tr('board.goal-freeze.wire_comment') + '\nnode .forma/board/checks/goal-freeze.cjs --staged || exit 1\n# forma: ' + tr('board.goal-freeze.hook_fallback_comment') + '\nscript=".forma/protocol/scripts/forma-commit.cjs"\n[ -f "$script" ] || script="$(git worktree list --porcelain | sed -n \'s/^worktree //p\' | head -n 1)/.forma/protocol/scripts/forma-commit.cjs"\nexec node "$script" --sync-staged\n';
function installHook() {
  fs.mkdirSync(path.dirname(HOOK), { recursive: true });
  fs.writeFileSync(HOOK, HOOK_BODY);
  try { fs.chmodSync(HOOK, 0o755); } catch { /* a filesystem without chmod (Windows) - git runs the hook anyway */ }
}
if (has('--install-hook')) { installHook(); ok(tr('commit.hook_installed_path', { path: path.relative(root, HOOK) })); process.exit(0); }
try { if (fs.readFileSync(HOOK, 'utf8') !== HOOK_BODY) throw 0; } catch { installHook(); ok(tr('commit.hook_installed_check')); }

// The protocol clone's hooks: a commit or push carrying project traces (card codes, dates, site names) is impossible past forma-commit too.
// They go into the protocol repository's real git dir: a submodule has `.git` as a file, and a write into `<proto>/.git/hooks` fails silently there.
const PROTO_GIT_DIR = gitDirOf(proto, '--git-dir');
const PROTO_HOOKS = {
  'pre-commit': 'node scripts/check-release.cjs --traces',
  'commit-msg': 'node scripts/check-release.cjs --message "$1"',
  'pre-push': 'node scripts/check-release.cjs --prepush',
};
for (const [name, cmd] of Object.entries(PROTO_HOOKS)) {
  const f = path.join(PROTO_GIT_DIR, 'hooks', name);
  const body = tr('commit.hook_proto_body', { cmd });
  try { if (fs.readFileSync(f, 'utf8') === body) continue; } catch { /* no hook */ }
  try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); fs.chmodSync(f, 0o755); } catch { /* a filesystem without chmod - git runs the hook anyway */ }
}

// Engine parity. Unclosed Core cards are not engine drift: a warning, not a stop.
// tpl=false: .codex/ diverging from the protocol template is not drift between engines; step 2 carries it over
// (engine-to-protocol). Checking it before step 2 means stopping every .codex/ edit.
// The commit verifies only the core and the Claude adapter; Codex and Gemini - a manual sync-engines --check before the release.
const OTHER = /\.codex\/|\.agents\/|GEMINI\.md|adapters\/(codex|gemini)\/|CODEX-8|gemini-8|\bCodex\b|\bGemini\b/i;
function parity(tpl = true) {
  const bad = [];
  if (fs.existsSync(ENG)) {
    const out = node(ENG, '--check').out.split(/\r?\n/);
    let cards = false;
    for (const l of out) {
      if (/^\s{4}— /.test(l)) { cards = /\u043d\u0435 \u0437\u0430\u043a\u0440\u044b\u0442\u044b `Core`/.test(l); if (!cards && (tpl || !OTHER.test(l))) bad.push(l.trim()); }
      if (cards && /\u043d\u0435 \u0437\u0430\u043a\u0440\u044b\u0442\u044b `Core`/.test(l)) console.log(tr('commit.core_deal', { line: l.trim().replace(/^— /, '') }));
    }
  }
  // Codex - a "not ready" adapter: its check is a summary, the commit does not hold; a dormant one (`.forma/engines.json`) is not checked at all.
  if (tpl && fs.existsSync(CDX) && !codexDormant()) { const r = node(CDX, '--check'); if (r.code) console.log(tr('commit.codex_not_ready')); }
  return bad;
}
// The engine against the protocol source
function e2p() {
  const out = node(E2P).out;
  const n = (t) => +((out.match(new RegExp(t.replace(/[.*+?${}()|[\]\\]/g, '\\$&') + '[^:]*: (\\d+)')) || [])[1] || 0);
  return { out, engine: n(tr('e2p.title_engine_only')), template: n(tr('e2p.title_template_only')), conflict: n(tr('e2p.title_conflict')) };
}

// The project's protocol files against their counterparts in the template. A warning, not a stop; CRLF -> LF.
const CORE = path.join(proto, 'skills', 'forma', 'core'), CLA = path.join(proto, 'skills', 'forma', 'adapters', 'claude');
function templateDrift() {
  const pairs = [];
  const walk = (d) => walkTree(d, { symlinks: true, abs: true });
  const tree = (src, base, dst) => { for (const f of walk(path.join(root, src))) pairs.push([f, path.join(base, dst, path.relative(path.join(root, src), f))]); };
  pairs.push([path.join(root, 'AGENTS.md'), path.join(CORE, 'AGENTS.md')]);
  tree('.claude/agents', CLA, 'agents');
  pairs.push([path.join(root, '.claude/rules/claude-8.md'), path.join(CLA, 'rules/claude-8.md')]);
  for (const f of walk(path.join(CLA, 'scripts')).filter((f) => f.endsWith('.cjs'))) pairs.push([path.join(root, '.claude/scripts', path.relative(path.join(CLA, 'scripts'), f)), f]);
  tree('manual', CORE, 'manual');
  for (const f of ['generate.js', 'index.html', 'economy.cjs', 'tally.cjs', 'spend-line.cjs']) pairs.push([path.join(root, 'dashboard', f), path.join(CORE, 'dashboard', f)]);
  tree('dashboard/web', CORE, 'dashboard/web');
  const rd = (f) => { try { return fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n'); } catch { return null; } };
  // Copies from project/extensions/ are the project's files, not the engine's: their difference from the template is not lag (as in engine-to-protocol.cjs).
  // The run-protocol-* profiles are engine tooling and go into the template even if the project delivers them as copies.
  const ext = new Set();
  try { for (const x of require('../skills/forma/core/extensions/extensions.cjs').sources(root)) ext.add(x.dst.split(path.sep).join('/')); } catch { /* no module - no copies */ }
  const isExtCopy = (a) => { const rel = path.relative(root, a).replace(/\\/g, '/'); return ext.has(rel) && !/(^|\/)agents\/run\/run-protocol-[^/]+\.md$/.test(rel); };
  return pairs.filter(([a, b]) => { if (isExtCopy(a)) return false; const x = rd(a), y = rd(b); return x !== null && x !== y; })
    .map(([a]) => path.relative(root, a).replace(/\\/g, '/'));
}

if (has('--sync-staged')) {
  // Roles are not copied between engines: each engine keeps its own adapter. Only the check lives here.
  const bad = parity(false);
  if (bad.length) { console.error(tr('commit.core_mismatch_staged', { list: bad.join('\n  ') })); process.exit(1); }
  const tdiff = templateDrift();
  if (tdiff.length) console.log(tr('commit.template_behind', { files: tdiff.join(', ') }));
  // The project's template (extensions): its own layer, shown beside the protocol-source drift so the
  // two are never confused - drift above is the protocol source lagging, this line is the project's own.
  try {
    const ext = run('node', [path.join(root, '.forma', 'extensions', 'extensions.cjs'), 'check']);
    const lines = (ext.out || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length) console.log(lines[lines.length - 1]);
  } catch { /* no extensions module - the project runs without one */ }
  process.exit(0);
}

if (has('--sync-plugin')) process.exit(syncPlugin(null) ? 0 : 1);

if (has('--check')) {
  const bad = parity(), s = e2p();
  if (s.engine) bad.push(tr('commit.engine_ahead', { n: s.engine }));
  if (s.template || s.conflict) bad.push(tr('commit.protocol_ahead', { template: s.template, conflict: s.conflict, e2p: E2P }));
  if (bad.length) { console.error(tr('commit.drift_stop', { list: bad.join('\n  ') })); process.exit(1); }
  ok(tr('commit.no_drift'));
  process.exit(0);
}

// A linked worktree shares the branch and the refs with the main clone: a protocol commit, a release or a push
// from here would move the main clone's `dev` under it. The checks stay available; the commit runs from MAIN_ROOT.
if (LINKED && (msg || has('--release') || has('--push'))) stop(tr('commit.linked_worktree_stop', { main: MAIN_ROOT }));

// --push without a message - pushing the already made commits only.
if (!msg && !has('--push') && !has('--release')) stop(tr('commit.need_message'), 2);
if (msg) {

// 1. the core + adapters by the conformance test (roles are not copied between engines)
const bad = parity(false);
if (bad.length) stop(tr('commit.core_mismatch_fix', { list: bad.join('\n  ') }));
ok(tr('commit.core_ok'));

// 2. the engine -> the protocol source
let s = e2p();
if (s.template || s.conflict) stop(tr('commit.template_ahead_stop', { template: s.template, conflict: s.conflict, out: s.out }));
if (s.engine) {
  const r = node(E2P, '--apply');
  if (/\u041f\u0420\u041e\u041f\u0423\u0429\u0415\u041d/.test(r.out)) stop(tr('commit.carry_partly_failed', { out: r.out }));
  ok(tr('commit.carried', { n: s.engine }));
}
const fresh = (s.out.split(tr('e2p.title_fresh'))[1] || '').split(/\r?\n/).slice(1).filter((l) => /^\s{2}\S/.test(l)).map((l) => l.trim());
if (fresh.length) console.log(tr('commit.fresh_files', { files: fresh.join(', ') }));

// 3. the protocol commit into `dev` without a version; the version - only on a release
if (pgit('status', '--porcelain').out.trim()) {
  onDev();
  if (has('--all')) {
    pgit('add', '-A');
  } else {
    // The allowlist: tracked changes anywhere in the clone, new files only in the engine's own product dirs.
    pgit('add', '-u');
    if (fresh.length) {
      for (const d of ['skills/forma', 'templates']) {
        if (fs.existsSync(path.join(proto, d))) pgit('add', '--', d);
      }
    }
  }
  const ft = scanTraces(proto), mt = scanMessages([protoMsg]);
  if (ft.length || mt.length) { pgit('reset', '-q'); stopTraces(ft, mt); }
  const c = pgit('commit', '-q', '-m', `${protoMsg}\n\nCarried over from the engine by forma-commit.cjs.\n\n${CO}`);
  if (c.code) stop(tr('commit.proto_commit_failed', { out: c.out }));
  node(E2P, '--mark');
  refreshProjectManifest(null); // the carry-over changed the engine's files - the manifest re-records them
  ok(tr('commit.proto_dev_status', { n: pending().length, total: RELEASE_N }));
}

// 4. the project commit - exactly the named paths; the protocol pointer always follows its commit.
// Without --files/--card only what is already staged is committed; --all is the explicit whole-tree opt-in.
const pointer = '.forma/protocol';
const stagePointer = () => {
  if (fs.existsSync(path.join(root, pointer))) git('add', '--', pointer);
  if (manifestRefreshed) git('add', '--', '.forma/install-manifest.json');
};
if (filesList && filesList.length) {
  git('add', '--', ...filesList);
  stagePointer();
} else if (cardNum) {
  const normNum = String(cardNum).replace(/^card-/, '').padStart(3, '0');
  const cardFilesToStage = [];
  const featDir = path.join(root, '.devtool', 'features');
  if (fs.existsSync(featDir)) {
    for (const f of fs.readdirSync(featDir)) {
      if (f.startsWith(`card-${normNum}`)) cardFilesToStage.push(path.join('.devtool', 'features', f));
    }
  }
  const matDir = path.join('project', 'cards', `card-${normNum}`);
  if (fs.existsSync(path.join(root, matDir))) {
    cardFilesToStage.push(matDir);
  }
  if (!cardFilesToStage.length) stop(tr('commit.card_paths_missing', { card: normNum }));
  git('add', '--', ...cardFilesToStage);
  stagePointer();
} else if (has('--all')) {
  git('add', '-A');
} else {
  stagePointer();
  console.log(tr('commit.only_staged_hint'));
}
if (git('diff', '--cached', '--quiet').code) {
  const c = git('commit', '-q', '-m', `${msg}\n\n${CO}`);
  if (c.code) stop(tr('commit.project_commit_failed', { out: c.out }));
  ok(tr('commit.project_committed', { line: git('log', '--oneline', '-1').out.trim() }));
} else ok(tr('commit.project_clean'));
}

// 5. release: N commits accumulated in `dev`, or --release (closing the circle, the human's command).
//    dev -> main by one merge, one patch raise, push main and dev. --push without a release - dev only.
if (has('--release') || pending().length >= RELEASE_N) release();
else if (has('--push') && pgit('rev-parse', '--verify', '-q', 'dev').out.trim()) {
  const ps = pgit('push', '-q', '-u', 'origin', 'dev');
  if (ps.code) stop(tr('commit.push_dev_failed', { out: ps.out }));
  ok(tr('commit.dev_pushed_status', { n: pending().length, total: RELEASE_N }));
}
if (has('--push') || has('--release')) {
  if (git('remote').out.trim()) {
    const ps = git('push', '-q');
    if (ps.code) stop(tr('commit.project_push_failed', { out: ps.out }));
    ok(tr('commit.project_pushed'));
  } else ok(tr('commit.no_remote'));
}

// 6. The report: the circle count by epics and unpushed commits. The push - on closing the circle by `Core`
//    or on the human's command, not on every card (AGENTS.md §7).
const CYC = '.claude/scripts/cycle-status.cjs';
if (fs.existsSync(path.join(root, CYC))) { const r = node(CYC); if (r.out.trim()) console.log('! ' + r.out.trim()); }
