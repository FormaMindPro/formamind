'use strict';

/**
 * The MiniMax Code engine installation check profile.
 *
 * The core finds this file by the manifest (`engines[].profile`) and calls `check(ctx)`;
 * the expectations come from the manifest (`engine.expect`), not from the code: the installer wrote down
 * what it installed - the profile collates that with the disk.
 *
 * While the engine is not registered in the manifest, the profile is not called by the core; it
 * is run by hand and by the zone's test. Everything it checks - from the `.minimax/` zone.
 *
 * Printed labels come from the core dictionary: English key in code, ru value as data.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const msg = (code, params) => i18n.message(code, params, 'ru');
const i18n = require([path.resolve(__dirname, '../../.forma/i18n/index.cjs'), path.resolve(__dirname, '../../../../core/i18n/index.cjs')].find((p) => fs.existsSync(p)));

const ZONE = '.minimax';

/** The nodes' roles that must be in place. */
const NODES = ['intent', 'spec', 'kit', 'core'];

/** The zone's files without which the engine does not count as installed. */
const REQUIRED = [
  '.minimax/forma-adapter.cjs',
  '.minimax/rules/minimax-8.md',
  '.minimax/scripts/gen-roles.cjs',
  '.minimax/scripts/sync-ledger.cjs',
  '.minimax/scripts/capabilities.cjs',
  '.minimax/scripts/economy.cjs',
  '.minimax/scripts/tool-usage.cjs',
  '.minimax/verify-profile.cjs',
  '.minimax/tests/test-minimax-adapter.cjs',
];

function checkFiles(ctx, out) {
  const { root, finding } = ctx;
  for (const rel of REQUIRED) {
    if (!fs.existsSync(path.join(root, rel))) out.push(finding(rel, 'file of the engine zone', 'file missing'));
  }
  for (const n of NODES) {
    const rel = `${ZONE}/agents/${n}.md`;
    if (!fs.existsSync(path.join(root, rel))) out.push(finding(rel, 'node role', 'file missing'));
  }
  if (!fs.existsSync(path.join(root, ZONE, 'agents', 'run'))) {
    out.push(finding(`${ZONE}/agents/run`, 'at least one executor profile', 'directory missing'));
  }
}

function checkHooks(ctx, expect, out) {
  const { root, finding } = ctx;
  // This engine's hooks live in the plugin package: `miniapps/<id>/.minimax-plugin/`.
  // No package - the guard and the calls log do not work, and that must be said out loud.
  const pkg = path.join(root, 'miniapps', 'minimax-engine', '.minimax-plugin', 'plugin.json');
  const expectedHooks = (expect && expect.hooks) || [];
  if (!expectedHooks.length) {
    if (!fs.existsSync(pkg)) {
      out.push(finding('miniapps/minimax-engine/.minimax-plugin/plugin.json', 'package of the engine (hooks, ledger)', 'package not installed — hooks of the engine do not fire'));
    }
    return;
  }
  if (!fs.existsSync(pkg)) {
    out.push(finding('miniapps/minimax-engine/.minimax-plugin/plugin.json', 'package of the engine', 'file missing'));
    return;
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(pkg, 'utf8'));
  } catch (e) {
    out.push(finding('miniapps/minimax-engine/.minimax-plugin/plugin.json', 'valid JSON', e.message));
    return;
  }
  for (const h of expectedHooks) {
    const rel = `miniapps/minimax-engine/${h.file}`;
    if (!fs.existsSync(path.join(root, rel))) out.push(finding(rel, `hook ${h.event}`, 'file missing'));
  }
  if (!Array.isArray(manifest.hooks) || !manifest.hooks.length) {
    out.push(finding('miniapps/minimax-engine/.minimax-plugin/plugin.json → hooks', 'hook files declared', 'hooks array is empty'));
  }
}

function checkBehavior(ctx, out) {
  const { root, finding } = ctx;
  const gen = path.join(root, ZONE, 'scripts', 'gen-roles.cjs');
  if (fs.existsSync(gen)) {
    const r = spawnSync(process.execPath, [gen, '--check'], { cwd: root, encoding: 'utf8' });
    if (r.status !== 0) {
      const why = ((r.stdout || '') + (r.stderr || '')).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 5);
      out.push(finding('node .minimax/scripts/gen-roles.cjs --check', 'exit 0', 'exit ' + r.status + (why.length ? ': ' + why.join(' | ') : '')));
    }
  }
  const caps = path.join(root, ZONE, '.state', 'capabilities.json');
  if (!fs.existsSync(caps)) {
    out.push(finding(`${ZONE}/.state/capabilities.json`, 'facts about the engine (probe)', 'file missing — run node .minimax/scripts/capabilities.cjs'));
  }
}

function check(ctx) {
  const out = [];
  checkFiles(ctx, out);
  checkHooks(ctx, ctx.engine && ctx.engine.expect, out);
  if (ctx.behavior) checkBehavior(ctx, out);
  return out;
}

module.exports = { id: 'minimax', check };
