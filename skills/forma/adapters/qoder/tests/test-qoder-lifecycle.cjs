#!/usr/bin/env node
'use strict';

/**
 * test-qoder-lifecycle.cjs - the Qoder install, switch, cleanup and uninstall lifecycle.
 * It installs into a temporary root and checks:
 *  1. the installer lays the adapter, §8, guards, role catalog, scripts, tests, profile and settings wiring;
 *  2. the manifest records qoder with its profile and the guard hooks; verify-install is green;
 *  3. engine-switch status sees qoder as active;
 *  4. clean-engine-files manages .qoder, and the transfer map carries only adapter files — never the
 *     project's witnesses, checks, commands or settings;
 *  5. uninstall removes .qoder and the other engine folders, and keeps project/.
 *
 * Run:
 *   node .qoder/tests/test-qoder-lifecycle.cjs
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function findRoot(start) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, 'AGENTS.md'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return path.resolve(start);
    dir = up;
  }
}

const root = findRoot(__dirname);
const FORMA = path.join(root, '.forma', 'protocol', 'bin', 'forma.cjs');
const LAYOUT = path.join(root, '.forma', 'protocol', 'scripts', 'layout', 'clean-engine-files.cjs');
const TRANSFER = path.join(root, '.forma', 'protocol', 'scripts', 'engine-to-protocol.cjs');

let passed = 0;
const it = (name, fn) => { fn(); passed += 1; console.log('ok  ' + name); };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qoder-lifecycle-'));
const p = (...parts) => path.join(dir, ...parts);
const exists = (...parts) => fs.existsSync(p(...parts));
const tail = (r) => ((r.stdout || '') + (r.stderr || '')).trim().split(/\r?\n/).slice(-12).join('\n');

try {
  it('the installer lays the Qoder adapter, guards, catalog, tests and settings wiring', () => {
    const r = spawnSync(process.execPath, [FORMA, 'init', '--dir', dir, '--engines', 'qoder', '--board', 'skip',
      '--template', 'none', '--lang', 'en', '--no-adopt', '--yes', '--no-dashboard', '--no-archive-foreign'], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, 'install failed:\n' + tail(r));
    for (const rel of ['forma-adapter.cjs', 'verify-profile.cjs', 'engine/qoder-8.md', 'engine/hooks/guard-destructive.cjs',
      'engine/hooks/guard-cards.cjs', 'engine/hooks/unlock-delete.cjs', 'engine/scripts/gen-roles.cjs',
      'engine/agents/intent.md', 'tests/test-qoder-adapter.cjs', 'settings.json']) {
      assert.ok(exists('.qoder', ...rel.split('/')), '.qoder/' + rel + ' missing');
    }
    const settings = JSON.parse(fs.readFileSync(p('.qoder', 'settings.json'), 'utf8'));
    const groups = settings.hooks.PreToolUse || [];
    assert.ok(groups.some((g) => g.matcher === 'Bash'), 'PreToolUse Bash is not wired');
    assert.ok(groups.some((g) => g.matcher === 'Write|Edit'), 'PreToolUse Write|Edit is not wired');
    assert.ok((settings.hooks.UserPromptSubmit || []).length, 'UserPromptSubmit is not wired');
  });

  it('the manifest records qoder with its profile and the guard hooks, and verify-install is green', () => {
    const manifest = JSON.parse(fs.readFileSync(p('.forma', 'install-manifest.json'), 'utf8'));
    const row = (manifest.engines || []).find((e) => e.id === 'qoder');
    assert.ok(row, 'the manifest has no qoder row');
    assert.equal(row.profile, '.qoder/verify-profile.cjs');
    assert.ok((row.expect.hooks || []).some((h) => h.name === 'guard-destructive.cjs'), 'the manifest names no delete guard');
    const v = spawnSync(process.execPath, [p('.forma', 'verify', 'verify-install.cjs'), '--root', dir], { cwd: dir, encoding: 'utf8' });
    assert.equal(v.status, 0, 'verify-install is red:\n' + tail(v));
  });

  it('engine-switch status sees qoder as active', () => {
    const r = spawnSync(process.execPath, [p('.claude', 'scripts', 'engine-switch.cjs'), 'status'], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, 'status failed:\n' + tail(r));
    const line = (id) => (r.stdout.split(/\r?\n/).find((l) => l.startsWith(id + ':')) || '').slice(id.length + 1).trim();
    assert.ok(line('qoder'), 'status has no qoder line');
    assert.equal(line('qoder'), line('claude'), 'qoder is not active while claude is');
  });

  it('clean-engine-files manages .qoder and the transfer map stays selective', () => {
    const { ENGINE_ROOTS, zonesFrom } = require(LAYOUT);
    assert.ok(ENGINE_ROOTS.includes('.qoder'), 'clean-engine-files does not manage .qoder');
    const zones = zonesFrom(new Set([p('.qoder', 'engine', 'hooks', 'x.cjs'), p('.qoder', 'tests', 'x.cjs')]), dir);
    assert.ok(zones.has('.qoder/engine') && zones.has('.qoder/tests'), 'the .qoder zones are not derived');
    const map = fs.readFileSync(TRANSFER, 'utf8');
    for (const rel of ['.qoder/forma-adapter.cjs', '.qoder/verify-profile.cjs', '.qoder/engine/qoder-8.md',
      '.qoder/engine/hooks/guard-destructive.cjs', '.qoder/engine/scripts', '.qoder/engine/agents', '.qoder/tests']) {
      assert.ok(map.includes("['" + rel + "'"), 'the map does not carry ' + rel);
    }
    for (const rel of ['.qoder/engine/witnesses', '.qoder/engine/checks', '.qoder/commands', '.qoder/settings.json']) {
      assert.ok(!map.includes("['" + rel + "'"), 'the map carries a project-owned path: ' + rel);
    }
  });

  it('uninstall removes .qoder and keeps project/', () => {
    const r = spawnSync(process.execPath, [FORMA, 'uninstall', '--dir', dir, '--yes'], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, 'uninstall failed:\n' + tail(r));
    assert.ok(!exists('.qoder'), '.qoder survived uninstall');
    assert.ok(!exists('.claude'), '.claude survived uninstall');
    assert.ok(exists('project'), 'project/ was removed');
  });

  console.log(`\npassed: ${passed}`);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
