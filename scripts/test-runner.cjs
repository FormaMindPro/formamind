#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const TEST_DIR = path.join(ROOT, 'test');

// 1. Определение временной папки (RAM-диск или системный откат)
function resolveTmpDir() {
  if (process.env.FORMA_TEST_TMP) {
    const custom = path.resolve(process.env.FORMA_TEST_TMP);
    try {
      fs.mkdirSync(custom, { recursive: true });
      fs.accessSync(custom, fs.constants.W_OK);
      return { path: custom, type: 'FORMA_TEST_TMP' };
    } catch {
      // откат при невалидном пути
    }
  }

  // Windows: RAM-диск R:\
  if (process.platform === 'win32') {
    const winRam = 'R:\\forma-tmp';
    try {
      if (fs.existsSync('R:\\')) {
        fs.mkdirSync(winRam, { recursive: true });
        fs.accessSync(winRam, fs.constants.W_OK);
        return { path: winRam, type: 'RAM-диск (R:)' };
      }
    } catch {
      // откат при ошибке доступа к R:
    }
  }

  // Linux: shared memory /dev/shm
  if (process.platform === 'linux') {
    const shmRam = '/dev/shm/forma-tmp';
    try {
      if (fs.existsSync('/dev/shm')) {
        fs.mkdirSync(shmRam, { recursive: true });
        fs.accessSync(shmRam, fs.constants.W_OK);
        return { path: shmRam, type: 'RAM-диск (/dev/shm)' };
      }
    } catch {
      // откат
    }
  }

  // Системный откат (Graceful degradation)
  const fallback = path.join(os.tmpdir(), 'forma-tmp');
  try {
    fs.mkdirSync(fallback, { recursive: true });
    return { path: fallback, type: 'os.tmpdir()' };
  } catch {
    return { path: os.tmpdir(), type: 'os.tmpdir()' };
  }
}

// 2. Рекурсивный поиск файлов тестов *.test.cjs
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
  // Экспортируем во временные переменные для всех дочерних процессов
  process.env.FORMA_TEST_TMP = tmpInfo.path;
  process.env.TMPDIR = tmpInfo.path;
  process.env.TEMP = tmpInfo.path;
  process.env.TMP = tmpInfo.path;

  // Определение уровня параллелизма
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
      console.log(`[test-runner] Не найдено тестов по шаблону: ${patterns.join(', ')}`);
    } else {
      console.log('[test-runner] В каталоге test/ не найдено файлов *.test.cjs');
    }
    process.exit(0);
  }

  const relTargets = targetTests.map((f) => path.relative(ROOT, f));
  console.log(
    `[test-runner] Тестов: ${relTargets.length}/${allTests.length} | Память: ${tmpInfo.type} [${tmpInfo.path}] | Потоков: ${concurrency}`
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
