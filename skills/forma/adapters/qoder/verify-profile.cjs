'use strict';

// Install verify profile for Qoder: the installed files and hook wiring named by the manifest, the role
// catalog's parity with the reference, §8 references, and the adapter's own fit test (no model call).
// The core (`.forma/verify/verify-install.cjs`) finds this file via the manifest (`engines[].profile`).

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

function checkFiles(ctx, expect, out) {
  const { root, finding } = ctx;
  for (const f of expect.files || []) {
    if (!fs.existsSync(path.join(root, f))) out.push(finding(f, 'installer file', 'file missing'));
  }
}

/** The hook commands the manifest records are present under their event and matcher, and their files exist. */
function checkWiring(ctx, expect, out) {
  const { root, finding } = ctx;
  const file = path.join(root, '.qoder', 'settings.json');
  if (!fs.existsSync(file)) return; // expect.files already names it
  let config;
  try {
    config = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    out.push(finding('.qoder/settings.json', 'valid JSON', error.message));
    return;
  }
  const hooks = config.hooks || {};
  for (const want of expect.hooks || []) {
    const command = 'node .qoder/engine/hooks/' + want.name;
    const groups = Array.isArray(hooks[want.event]) ? hooks[want.event] : [];
    const group = groups.find((entry) => (entry.matcher || '') === (want.matcher || ''));
    const found = group && Array.isArray(group.hooks) && group.hooks.some((hook) => hook && hook.command === command);
    if (!found) out.push(finding('.qoder/settings.json — ' + want.event + (want.matcher ? ' / ' + want.matcher : ''), command, 'not wired'));
    if (!fs.existsSync(path.join(root, '.qoder', 'engine', 'hooks', want.name))) {
      out.push(finding('.qoder/engine/hooks/' + want.name, 'hook target exists', 'file missing'));
    }
  }
}

/** The role catalog (.qoder/engine/agents) is regenerated from the reference by the shipped gen-roles;
 *  `--check` writes nothing and exits non-zero naming the drifted roles. */
function checkMirror(ctx, expect, out) {
  const { root, finding } = ctx;
  const from = expect.mirrorFrom;
  if (!from) return;
  if (!fs.existsSync(path.join(root, from))) return; // a Qoder-only install keeps the shipped catalog
  const r = spawnSync(process.execPath, [path.join(root, '.qoder', 'engine', 'scripts', 'gen-roles.cjs'), '--check'], { cwd: root, encoding: 'utf8' });
  if (r.error) { out.push(finding('.qoder/engine/scripts/gen-roles.cjs --check', 'runs', r.error.message)); return; }
  if (r.status !== 0) {
    const why = ((r.stderr || '') + (r.stdout || '')).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 3).join(' | ');
    out.push(finding('.qoder/engine/agents — the role catalog', `in sync with ${from} (gen-roles --check)`, `exit ${r.status}${why ? ': ' + why : ''}`));
  }
}

/** Reference closure for §8: a bare `name.md` in .qoder/engine/qoder-8.md names a file that exists in
 *  the zones the engine reads (its own .qoder, .claude, .forma). */
function checkReferences(ctx, out) {
  const { root, finding } = ctx;
  const known = new Set();
  for (const d of ['.qoder', '.claude', '.forma']) for (const f of walkFiles(path.join(root, d))) known.add(path.basename(f));
  const src = path.join(root, '.qoder', 'engine', 'qoder-8.md');
  if (!fs.existsSync(src)) return; // expect.files already names it
  const seen = new Set();
  for (const m of fs.readFileSync(src, 'utf8').matchAll(/`([a-z][a-z0-9-]*\.md)`/g)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    if (!known.has(m[1])) out.push(finding(`.qoder/engine/qoder-8.md → \`${m[1]}\``, 'file in .qoder/, .claude/ or .forma/', 'no such file'));
  }
}

function checkBehavior(ctx, out) {
  const { root, finding } = ctx;
  const test = path.join(root, '.qoder', 'tests', 'test-qoder-adapter.cjs');
  if (!fs.existsSync(test)) return; // expect.files already names it
  const r = spawnSync(process.execPath, [test], { cwd: root, encoding: 'utf8' });
  if (r.error || r.status !== 0) {
    const tail = ((r.stdout || '') + (r.stderr || '')).split(/\r?\n/).map((l) => l.trim()).filter((l) => /^(not ok|AssertionError|Error:)/.test(l)).slice(0, 3).join(' | ');
    out.push(finding('.qoder/tests/test-qoder-adapter.cjs', 'exit 0', r.error ? r.error.message : `exit ${r.status}${tail ? ': ' + tail : ''}`));
  }
}

function check(ctx) {
  const out = [];
  const expect = ctx.engine.expect || {};
  checkFiles(ctx, expect, out);
  checkWiring(ctx, expect, out);
  checkMirror(ctx, expect, out);
  checkReferences(ctx, out);
  if (ctx.behavior) checkBehavior(ctx, out);
  return out;
}

module.exports = { id: 'qoder', check };
