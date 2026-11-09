#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const i18n = require('../skills/forma/core/i18n/index.cjs');
const tr = (code, params) => i18n.message(code, params, 'ru');

const ROOT = path.resolve(__dirname, '..');
const TEST_DIR = path.join(ROOT, 'test');

// A per-project subdirectory: several open projects do not share one temp directory
const PROJECT_SLUG =
  path
    .basename(ROOT)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'project';

// 1. Resolving the temp folder (a RAM disk or the system fallback)
function resolveTmpDir() {
  if (process.env.FORMA_TEST_TMP) {
    const custom = path.resolve(process.env.FORMA_TEST_TMP);
    try {
      fs.mkdirSync(path.join(custom, PROJECT_SLUG), { recursive: true });
      fs.accessSync(custom, fs.constants.W_OK);
      return { path: path.join(custom, PROJECT_SLUG), type: 'FORMA_TEST_TMP' };
    } catch {
      // the variable is set but the path is dead: a warning and a fallback to autodetection - blind trust in the variable is forbidden
      console.warn(tr('trun.tmp_dead', { custom }));
    }
  }

  // Windows: RAM disk R:\
  if (process.platform === 'win32') {
    const winRam = 'R:\\forma-tmp';
    try {
      if (fs.existsSync('R:\\')) {
        const winDir = path.join(winRam, PROJECT_SLUG);
        fs.mkdirSync(winDir, { recursive: true });
        fs.accessSync(winDir, fs.constants.W_OK);
        return { path: winDir, type: tr('trun.ramdisk_win') };
      }
    } catch {
      // a fallback when access to R: fails
    }
  }

  // Linux: shared memory /dev/shm
  if (process.platform === 'linux') {
    const shmRam = '/dev/shm/forma-tmp';
    try {
      if (fs.existsSync('/dev/shm')) {
        const shmDir = path.join(shmRam, PROJECT_SLUG);
        fs.mkdirSync(shmDir, { recursive: true });
        fs.accessSync(shmDir, fs.constants.W_OK);
        return { path: shmDir, type: tr('trun.ramdisk_shm') };
      }
    } catch {
      // the fallback
    }
  }

  // The system fallback (graceful degradation)
  const fallback = path.join(os.tmpdir(), 'forma-tmp', PROJECT_SLUG);
  try {
    fs.mkdirSync(fallback, { recursive: true });
    return { path: fallback, type: 'os.tmpdir()' };
  } catch {
    return { path: os.tmpdir(), type: 'os.tmpdir()' };
  }
}

// 2. Recursive search for *.test.cjs test files
function findTestFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'fixture') {
        results.push(...findTestFiles(full));
      }
    } else if (entry.isFile() && entry.name.endsWith('.test.cjs')) {
      results.push(full);
    }
  }
  return results;
}

function main() {
  const rawArgs = process.argv.slice(2);
  const flags = [];
  const patterns = [];

  for (const arg of rawArgs) {
    if (arg.startsWith('-')) {
      flags.push(arg);
    } else {
      patterns.push(arg.toLowerCase());
    }
  }

  const tmpInfo = resolveTmpDir();
  // Exported into env vars for all child processes
  process.env.FORMA_TEST_TMP = tmpInfo.path;
  process.env.TMPDIR = tmpInfo.path;
  process.env.TEMP = tmpInfo.path;
  process.env.TMP = tmpInfo.path;

  // Resolving the concurrency level
  const cpus = Array.isArray(os.cpus()) ? os.cpus().length : 1;
  const concurrency = process.env.FORMA_TEST_CONCURRENCY
    ? parseInt(process.env.FORMA_TEST_CONCURRENCY, 10)
    : Math.max(1, Math.min(cpus, 16));

  const allTests = findTestFiles(TEST_DIR);
  let targetTests = allTests;

  if (patterns.length > 0) {
    targetTests = allTests.filter((file) => {
      const rel = path.relative(ROOT, file).replace(/\\/g, '/').toLowerCase();
      const base = path.basename(file).toLowerCase();
      return patterns.some((p) => rel.includes(p) || base.includes(p));
    });
  }

  if (targetTests.length === 0) {
    if (patterns.length > 0) {
      console.log(tr('trun.no_tests_pattern', { patterns: patterns.join(', ') }));
    } else {
      console.log(tr('trun.no_tests_dir'));
    }
    process.exit(0);
  }

  const relTargets = targetTests.map((f) => path.relative(ROOT, f));
  console.log(
    tr('trun.header', { n: relTargets.length, total: allTests.length, type: tmpInfo.type, path: tmpInfo.path, concurrency })
  );

  const nodeArgs = ['--test'];
  const hasConcurrencyFlag = flags.some((f) => f.startsWith('--test-concurrency'));
  if (!hasConcurrencyFlag) {
    nodeArgs.push(`--test-concurrency=${concurrency}`);
  }
  nodeArgs.push(...flags);
  nodeArgs.push(...relTargets);

  const res = spawnSync(process.execPath, nodeArgs, {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });

  process.exit(res.status ?? (res.error ? 1 : 0));
}

if (require.main === module) {
  main();
}

module.exports = { resolveTmpDir, findTestFiles };
