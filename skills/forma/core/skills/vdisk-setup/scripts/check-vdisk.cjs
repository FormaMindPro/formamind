#!/usr/bin/env node
'use strict';

/**
 * check-vdisk.cjs — Verification and path resolution for virtual RAM disk
 * Used by vdisk-setup core skill, test runners, and page build pipelines.
 *
 * Flags:
 *   --json            Output result in JSON format
 *   --ensure-slug <s> Create isolated project/session subdirectory and output its path
 *   --status          Brief human-readable status (exit code 0 - mounted, 1 - unmounted)
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function parseArgs(argv) {
  const opts = { json: false, ensureSlug: null, status: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') opts.json = true;
    else if (argv[i] === '--status') opts.status = true;
    else if (argv[i] === '--ensure-slug' && argv[i + 1]) {
      opts.ensureSlug = argv[++i];
    }
  }
  return opts;
}

function detectVDisk() {
  const isWin = process.platform === 'win32';
  const envPath = process.env.FORMA_TEST_TMP ? path.resolve(process.env.FORMA_TEST_TMP) : null;
  const defaultPath = isWin ? 'R:\\forma-tmp' : '/dev/shm/forma-tmp';

  let candidate = null;
  let source = 'none';

  if (envPath && fs.existsSync(envPath)) {
    candidate = envPath;
    source = 'env';
  } else if (fs.existsSync(defaultPath)) {
    candidate = defaultPath;
    source = 'detected';
  }

  const result = {
    mounted: false,
    path: candidate || defaultPath,
    source,
    platform: process.platform,
    writable: false,
    degradedFallback: path.join(os.tmpdir(), 'forma-tmp'),
  };

  if (candidate) {
    try {
      const probe = path.join(candidate, `.probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
      fs.writeFileSync(probe, 'ok');
      fs.unlinkSync(probe);
      result.mounted = true;
      result.writable = true;
    } catch {
      result.writable = false;
    }
  }

  return result;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const info = detectVDisk();

  if (opts.ensureSlug) {
    const basePath = info.mounted ? info.path : info.degradedFallback;
    const slugPath = path.join(basePath, opts.ensureSlug);
    try {
      fs.mkdirSync(slugPath, { recursive: true });
      if (opts.json) {
        console.log(JSON.stringify({ ...info, targetPath: slugPath }, null, 2));
      } else {
        console.log(slugPath);
      }
      process.exit(info.mounted ? 0 : 2);
    } catch (err) {
      console.error(`Error creating directory ${slugPath}:`, err.message);
      process.exit(1);
    }
  }

  if (opts.json) {
    console.log(JSON.stringify(info, null, 2));
  } else if (opts.status) {
    if (info.mounted) {
      console.log(`[OK] Virtual RAM disk mounted and available: ${info.path} (source: ${info.source})`);
      process.exit(0);
    } else {
      console.log(`[!] Virtual RAM disk not detected (degraded fallback: ${info.degradedFallback})`);
      process.exit(1);
    }
  } else {
    console.log(`RAM disk status:   ${info.mounted ? 'MOUNTED' : 'NOT MOUNTED'}`);
    console.log(`Path:              ${info.path}`);
    console.log(`Source:            ${info.source}`);
    console.log(`Write permission:  ${info.writable ? 'YES' : 'NO'}`);
    if (!info.mounted) {
      console.log(`\nDegraded fallback path: ${info.degradedFallback}`);
    }
  }

  process.exit(info.mounted ? 0 : 1);
}

if (require.main === module) {
  main();
}

module.exports = { detectVDisk };
