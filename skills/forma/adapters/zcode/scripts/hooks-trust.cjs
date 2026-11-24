#!/usr/bin/env node
'use strict';

/**
 * hooks-trust.cjs - the preflight of the ZCode zone's project hooks.
 *
 * The host runs a project hook only after the human granted it a persistent trust for this workspace
 * (`.zcode/rules/zcode-8.md`, "Host facts"): a hook in `.zcode/config.json` sits in
 * `workspace_hooks_pending_trust` and never fires - silently, which is the worst shape of a guard
 * that looks installed. This script asks the host itself and names every hook that is not
 * `trusted_persistent` on one red line, then exits non-zero.
 *
 * Where the host CLI is looked up, in order: --cli <path>, ZCODE_CLI, `zcode` in PATH, the package the
 * Windows installer lays down. No CLI - no reading is possible, and the script says so and exits 0:
 * an image or a CI box without the host is not a red, a pending hook on the host is.
 *
 * Exit codes: 0 - every declared hook is trusted, or there is nothing to ask, or the host is absent;
 *             1 - at least one hook is not trusted, or the host answered with something unreadable.
 *
 * Usage: node .zcode/scripts/hooks-trust.cjs [--root <dir>] [--cli <path>] [--json]
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const TRUSTED = 'trusted_persistent';

function findRoot(start) {
  let dir = path.resolve(start || process.cwd());
  for (;;) {
    if (fs.existsSync(path.join(dir, '.zcode', 'config.json'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

function findCli(explicit) {
  const candidates = [];
  if (explicit) candidates.push(explicit);
  if (process.env.ZCODE_CLI) candidates.push(process.env.ZCODE_CLI);
  for (const p of candidates) if (p && fs.existsSync(p)) return p;

  const names = process.platform === 'win32' ? ['zcode.cmd', 'zcode.exe', 'zcode'] : ['zcode'];
  for (const dir of String(process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const name of names) {
      const file = path.join(dir, name);
      try { if (fs.statSync(file).isFile()) return file; } catch { /* not there */ }
    }
  }

  const home = process.env.LOCALAPPDATA || process.env.APPDATA || path.join(os.homedir(), '.local', 'share');
  const guesses = [
    path.join(home, 'Programs', 'ZCode', 'resources', 'glm', 'zcode.cjs'),
    path.join(home, 'ZCode', 'resources', 'glm', 'zcode.cjs'),
    '/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs',
  ];
  for (const g of guesses) if (fs.existsSync(g)) return g;
  return null;
}

function statusOf(cli, root) {
  const args = [cli, 'hooks', 'trust', 'status', '--workspace', root, '--json'];
  const run = cli.endsWith('.cjs') || cli.endsWith('.js')
    ? spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 120000 })
    : spawnSync(cli, args.slice(1), { encoding: 'utf8', timeout: 120000, shell: process.platform === 'win32' });
  if (run.error) return { error: run.error.message };
  const text = String(run.stdout || '').trim();
  if (!text) return { error: 'no output (exit ' + run.status + ')' + (run.stderr ? ': ' + String(run.stderr).trim().split(/\r?\n/)[0] : '') };
  try {
    return { report: JSON.parse(text) };
  } catch {
    return { error: 'the answer is not JSON (exit ' + run.status + ')' };
  }
}

function main() {
  const argv = process.argv.slice(2);
  const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
  const root = findRoot(opt('--root') || process.cwd());
  const json = argv.includes('--json');
  const out = (line) => process.stdout.write(line + '\n');
  const red = (line) => process.stderr.write(line + '\n');

  const finish = (code, lines, extra) => {
    if (json) {
      process.stdout.write(JSON.stringify(Object.assign({ root, ok: code === 0, lines }, extra || {}), null, 2) + '\n');
    } else {
      for (const l of lines) (l.red ? red : out)((l.red ? '! ' : '  ') + l.text);
    }
    process.exit(code);
  };

  if (!root) return finish(1, [{ red: true, text: 'hooks-trust: .zcode/config.json was not found from ' + process.cwd() }]);

  let declared = [];
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(root, '.zcode', 'config.json'), 'utf8'));
    for (const [event, groups] of Object.entries((cfg.hooks && cfg.hooks.events) || {})) {
      for (const g of groups || []) for (const h of g.hooks || []) declared.push({ event, matcher: g.matcher || '' });
    }
  } catch (error) {
    return finish(1, [{ red: true, text: 'hooks-trust: .zcode/config.json is unreadable: ' + error.message }]);
  }
  if (!declared.length) return finish(0, [{ text: 'hooks-trust: no project hooks declared in .zcode/config.json' }]);

  const cli = findCli(opt('--cli'));
  if (!cli) {
    return finish(0, [{ text: 'hooks-trust: skip - the host CLI was not found (' + declared.length + ' hook(s) declared, trust not verified)' }]);
  }

  const answer = statusOf(cli, root);
  if (answer.error) {
    return finish(1, [{ red: true, text: 'hooks-trust: the host did not answer: ' + answer.error }], { cli });
  }
  const report = answer.report || {};
  const items = Array.isArray(report.items) ? report.items : [];
  if (!items.length) {
    return finish(1, [{ red: true, text: 'hooks-trust: the host reported no hooks for this workspace (' + String(report.reasonCode || 'no reason') + ')' }], { cli });
  }

  const lines = [];
  let failed = 0;
  for (const item of items) {
    const ok = item.trustState === TRUSTED;
    if (!ok) failed += 1;
    lines.push({
      red: !ok,
      text: '[' + (item.trustState || 'unknown') + '] ' + item.event + ' / ' + (item.matcher || '*') + ' - ' + (item.displayCommand || ''),
    });
  }
  const summary = failed
    ? failed + ' of ' + items.length + ' project hook(s) are not ' + TRUSTED + ': run `node ' + path.relative(root, __filename).replace(/\\/g, '/') + ' --json` and grant them - zcode hooks trust grant --workspace "' + root + '" --all-current --bundle-digest ' + String(report.bundleDigest || '<digest>')
    : 'hooks-trust: all ' + items.length + ' project hook(s) are ' + TRUSTED;
  lines.push({ red: Boolean(failed), text: summary });
  return finish(failed ? 1 : 0, lines, { cli, bundleDigest: report.bundleDigest || null, reasonCode: report.reasonCode || null });
}

main();
