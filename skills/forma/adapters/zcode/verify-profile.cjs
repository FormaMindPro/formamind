'use strict';

// Install verify profile for ZCode: the role mirror's parity with the reference, the adapter files,
// and the start-up check behavior (the adapter's own fit test; no model call).
// The core (`.forma/verify/verify-install.cjs`) finds this file via the manifest (`engines[].profile`) and calls `check(ctx)`.
// Expectations come from the manifest (`engine.expect`), not from code: the installer recorded what it installed — the profile checks that against disk.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const walkFiles = (dir) => {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walkFiles(p) : [p];
  });
};

/** The adapter files the installer recorded (`expect.files`). Layer 1 hashes their content already;
 *  this names a missing file by its address before anything else runs. */
function checkFiles(ctx, expect, out) {
  const { root, finding } = ctx;
  for (const f of expect.files || []) {
    if (!fs.existsSync(path.join(root, f))) out.push(finding(f, 'installer file', 'file missing'));
  }
}

/** The role mirror (.zcode/agents) is generated from the reference (`expect.mirrorFrom`, recorded by the
 *  installer) by the shipped gen-roles; `--check` writes nothing and exits non-zero naming the drifted roles.
 *  Both sides can hash-match their shipped copies while the mirror is behind the reference (the reference
 *  changed after the rebuild, the roles the template wrote landed late) — only a regeneration catches that.
 *  gen-roles' messages are localized: the verdict is read from the exit code, its text goes into the finding. */
function checkMirror(ctx, expect, out) {
  const { root, finding } = ctx;
  const from = expect.mirrorFrom;
  if (!from) return;
  if (!fs.existsSync(path.join(root, from))) { out.push(finding(from, 'role reference for the mirror', 'directory missing')); return; }
  const r = spawnSync(process.execPath, [path.join(root, '.zcode', 'scripts', 'gen-roles.cjs'), '--check'], { cwd: root, encoding: 'utf8' });
  if (r.error) { out.push(finding('.zcode/scripts/gen-roles.cjs --check', 'runs', r.error.message)); return; }
  if (r.status !== 0) {
    const why = ((r.stderr || '') + (r.stdout || '')).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 3).join(' | ');
    out.push(finding('.zcode/agents — the role mirror', `in sync with ${from} (gen-roles --check)`, `exit ${r.status}${why ? ': ' + why : ''}`));
  }
}

/** Reference closure for §8: a bare `name.md` in .zcode/rules/zcode-8.md names a file that exists in the
 *  zones the engine reads (its own .zcode, the shared .agents skills mirror, .claude, .forma). */
function checkReferences(ctx, out) {
  const { root, finding } = ctx;
  const known = new Set();
  for (const d of ['.zcode', '.agents', '.claude', '.forma']) for (const f of walkFiles(path.join(root, d))) known.add(path.basename(f));
  const src = path.join(root, '.zcode', 'rules', 'zcode-8.md');
  if (!fs.existsSync(src)) return; // expect.files already names it
  const seen = new Set();
  for (const m of fs.readFileSync(src, 'utf8').matchAll(/`([a-z][a-z0-9-]*\.md)`/g)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    if (!known.has(m[1])) out.push(finding(`.zcode/rules/zcode-8.md → \`${m[1]}\``, 'file in .zcode/, .agents/, .claude/ or .forma/', 'no such file'));
  }
}

/** Behavior: the adapter's fit test runs and exits 0; no model is called. */
function checkBehavior(ctx, out) {
  const { root, finding } = ctx;
  const test = path.join(root, '.zcode', 'tests', 'test-zcode-adapter.cjs');
  if (!fs.existsSync(test)) return; // expect.files already names it
  const r = spawnSync(process.execPath, [test], { cwd: root, encoding: 'utf8' });
  if (r.error || r.status !== 0) {
    const tail = ((r.stdout || '') + (r.stderr || '')).split(/\r?\n/).map((l) => l.trim()).filter((l) => /^(not ok|AssertionError|Error:)/.test(l)).slice(0, 3).join(' | ');
    out.push(finding('.zcode/tests/test-zcode-adapter.cjs', 'exit 0', r.error ? r.error.message : `exit ${r.status}${tail ? ': ' + tail : ''}`));
  }
}

function check(ctx) {
  const out = [];
  const expect = ctx.engine.expect || {};
  checkFiles(ctx, expect, out);
  checkMirror(ctx, expect, out);
  checkReferences(ctx, out);
  if (ctx.behavior) checkBehavior(ctx, out);
  return out;
}

module.exports = { id: 'zcode', check };
