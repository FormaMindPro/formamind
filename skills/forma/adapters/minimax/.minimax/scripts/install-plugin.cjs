'use strict';

/**
 * Installing the engine plugin package into the runtime profile and the parity check.
 *
 * The package lives in two places for different reasons:
 *   - in the project (`miniapps/minimax-engine/`) as the source: it is under git, visible in a diff,
 *     edited by the `.minimax/scripts/gen-plugin-agents.cjs` generator;
 *   - in the profile (`<profile>/plugins/minimax-engine/`) as installed: only there does the runtime
 *     find it. The profile is a machine path, so it is never written into the project files.
 *
 * The installation copies the files one by one and removes from the target what is no longer in the
 * source - otherwise the previous package would stay in the profile forever.
 *
 * Run:
 *   node .minimax/scripts/install-plugin.cjs           - install
 *   node .minimax/scripts/install-plugin.cjs --check   - compare only (exit 1 on a divergence)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const i18n = require([path.resolve(__dirname, '../../.forma/i18n/index.cjs'), path.resolve(__dirname, '../../../../core/i18n/index.cjs')].find((p) => fs.existsSync(p)));
const msg = (code, params) => i18n.message(code, params, 'ru');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'miniapps', 'minimax-engine');
const PLUGIN_ID = 'minimax-engine';

/** The runtime profile: the active data directory, not a guess about the home folder. */
function profileDir() {
  return process.env.MINIMAX_DATA_DIR || path.join(os.homedir(), '.minimax');
}

function targetDir() {
  return path.join(profileDir(), 'plugins', PLUGIN_ID);
}

/** All the package files - relative paths through `/`. */
function listFiles(dir, base = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? base + '/' + entry.name : entry.name;
    if (entry.isDirectory()) out.push(...listFiles(path.join(dir, entry.name), rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out.sort();
}

function readIfExists(p) {
  try {
    return fs.existsSync(p) ? fs.readFileSync(p) : null;
  } catch {
    return null;
  }
}

/** The divergences: the files absent, and the files whose content drifted. */
function diff(src, dst) {
  const srcFiles = listFiles(src);
  const dstFiles = fs.existsSync(dst) ? listFiles(dst) : [];
  const missing = srcFiles.filter((f) => !dstFiles.includes(f));
  const changed = srcFiles.filter(
    (f) => dstFiles.includes(f) && !readIfExists(path.join(src, f)).equals(readIfExists(path.join(dst, f)))
  );
  const extra = dstFiles.filter((f) => !srcFiles.includes(f));
  return { missing, changed, extra, total: srcFiles.length };
}

function install(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  const files = listFiles(src);
  for (const rel of files) {
    const to = path.join(dst, ...rel.split('/'));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(src, ...rel.split('/')), to);
  }
  // Remove what is no longer in the source: an old package must not live forever.
  const keep = new Set(files);
  for (const rel of listFiles(dst)) {
    if (!keep.has(rel)) fs.unlinkSync(path.join(dst, ...rel.split('/')));
  }
  return files.length;
}

function main() {
  const check = process.argv.includes('--check');
  if (!fs.existsSync(SRC)) {
    console.error(msg('mip.no_source', { id: PLUGIN_ID }));
    process.exit(2);
  }
  const dst = targetDir();
  const d = diff(SRC, dst);

  if (check) {
    if (d.missing.length || d.changed.length || d.extra.length) {
      console.log(msg('mip.profile_diffs'));
      for (const f of d.missing) console.log(msg('mip.missing') + f);
      for (const f of d.changed) console.log(msg('mip.changed') + f);
      for (const f of d.extra) console.log(msg('mip.extra') + f);
      process.exit(1);
    }
    console.log(msg('mip.match', { count: d.total }));
    return;
  }

  const n = install(SRC, dst);
  const after = diff(SRC, dst);
  console.log(msg('mip.installed', { count: n, dst }));
  if (after.missing.length || after.changed.length || after.extra.length) {
    console.error(msg('mip.residual'));
    process.exit(1);
  }
  console.log(msg('mip.parity'));
}

if (require.main === module) main();

module.exports = { install, diff, listFiles, targetDir, profileDir, SRC, PLUGIN_ID };
