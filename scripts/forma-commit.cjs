#!/usr/bin/env node
// The engine commit without drift: Claude -> Gemini/Codex -> the protocol source -> commits.
// For the protocol author, in any project whose protocol/ is a git clone of FormaMindPro/formamind. Run from the project root.
//   node .forma/protocol/scripts/forma-commit.cjs "message"          - sync, check, commit
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
// commit protocol/ into dev + --mark -> commit the project (git add -A, referencing the new protocol/ HEAD).
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
const proto = path.join(root, '.forma/protocol');
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const toAt = args.indexOf('--to'); // --release --to X.Y.Z: release with the named version instead of +1 to the patch
const toVer = toAt >= 0 ? args[toAt + 1] : null;
const msg = args.find((a, i) => !a.startsWith('--') && !(toAt >= 0 && i === toAt + 1));
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
    const pklj = fs.readFileSync(pkl, 'utf8');
    fs.writeFileSync(pkl, pklj.replace(new RegExp(`"version": "${v}"`, 'g'), `"version": "${nv}"`));
  }
  pgit('add', '-A');
  r = pgit('commit', '-q', '-m', `v${nv} — ${list.length} commit(s)\n\n${list.reverse().map((s) => '- ' + s).join('\n')}\n\n${CO}`);
  if (r.code) stop(tr('commit.merge_commit_failed', { out: r.out }));
  ok(tr('commit.released', { v, nv, n: list.length }));
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
      const rel = run('gh', ['release', 'create', `v${nv}`, '--title', nv, '--notes', `Release v${nv}`, '--latest', '-R', 'FormaMindPro/formamind']);
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
  if (git('diff', '--cached', '--quiet').code) git('commit', '-q', '-m', `Protocol release v${nv}: ${list.length} commit(s)\n\n${CO}`);
}
const ENG = '.claude/scripts/sync-engines.cjs';
const CDX = '.codex/scripts/sync-codex.cjs';
const E2P = '.forma/protocol/scripts/engine-to-protocol.cjs';
function codexDormant() { try { return JSON.parse(fs.readFileSync('.forma/engines.json', 'utf8')).dormant.includes('codex'); } catch { return false; } }

// The project's pre-commit: any commit, a plain git commit too, carries Claude -> Gemini/Codex
// and takes their files into the same commit. Carrying into the protocol source and the version - still forma-commit.
// First in the hook is the version-freeze gate (goal-freeze.cjs): if this constant rewrites the hook, the gate restores it itself.
const HOOK = path.join(root, '.git', 'hooks', 'pre-commit');
const HOOK_BODY = '#!/bin/sh\n# forma: ' + tr('board.goal-freeze.wire_comment') + '\nnode .forma/board/checks/goal-freeze.cjs --staged || exit 1\n# forma: ' + tr('board.goal-freeze.hook_fallback_comment') + '\nexec node .forma/protocol/scripts/forma-commit.cjs --sync-staged\n';
function installHook() {
  fs.writeFileSync(HOOK, HOOK_BODY);
  try { fs.chmodSync(HOOK, 0o755); } catch { /* a filesystem without chmod (Windows) - git runs the hook anyway */ }
}
if (has('--install-hook')) { installHook(); ok(tr('commit.hook_installed_path', { path: path.relative(root, HOOK) })); process.exit(0); }
try { if (fs.readFileSync(HOOK, 'utf8') !== HOOK_BODY) throw 0; } catch { installHook(); ok(tr('commit.hook_installed_check')); }

// The protocol clone's hooks: a commit or push carrying project traces (card codes, dates, site names) is impossible past forma-commit too.
const PROTO_HOOKS = {
  'pre-commit': 'node scripts/check-release.cjs --traces',
  'commit-msg': 'node scripts/check-release.cjs --message "$1"',
  'pre-push': 'node scripts/check-release.cjs --prepush',
};
for (const [name, cmd] of Object.entries(PROTO_HOOKS)) {
  const f = path.join(proto, '.git', 'hooks', name);
  const body = tr('commit.hook_proto_body', { cmd });
  try { if (fs.readFileSync(f, 'utf8') === body) continue; } catch { /* no hook */ }
  try { fs.writeFileSync(f, body); fs.chmodSync(f, 0o755); } catch { /* a filesystem without chmod - git runs the hook anyway */ }
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
  pgit('add', '-A');
  const ft = scanTraces(proto), mt = scanMessages([protoMsg]);
  if (ft.length || mt.length) { pgit('reset', '-q'); stopTraces(ft, mt); }
  const c = pgit('commit', '-q', '-m', `${protoMsg}\n\nCarried over from the engine by forma-commit.cjs.\n\n${CO}`);
  if (c.code) stop(tr('commit.proto_commit_failed', { out: c.out }));
  node(E2P, '--mark');
  ok(tr('commit.proto_dev_status', { n: pending().length, total: RELEASE_N }));
}

// 4. the project commit - everything, including the reference to protocol/
git('add', '-A');
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
