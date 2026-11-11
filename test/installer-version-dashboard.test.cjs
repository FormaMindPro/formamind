'use strict';
// Installer: says which version it installed (fresh / refreshed / updated from an older one) and where the dashboard is;
// --dashboard starts it and prints the real address, --no-dashboard leaves it alone.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BIN = path.join(__dirname, '..', 'bin', 'forma.cjs');
const VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version;

function tmp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }
function install(dir, home, args = []) {
  const r = spawnSync(process.execPath, [BIN, 'init', '--yes', '--board', 'skip', '--dir', dir, ...args],
    { encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home } });
  return { ...r, out: r.stdout + r.stderr };
}
const manifestFile = (dir) => path.join(dir, '.forma', 'install-manifest.json');

test('version line: installed, refreshed, updated', () => {
  const dir = tmp('forma-v-'), home = tmp('forma-h-');
  try {
    let r = install(dir, home);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, new RegExp(`✓ Forma ${VERSION.replace(/\./g, '\\.')} installed\\.`));
    assert.match(r.out, /Next: open the folder in VSCode \(Antigravity\) or an agent harness — Intent will lead the setup per project\/config\/SETUP\.md, starting with the interview\./);
    assert.doesNotMatch(r.out, /Claude Code — Intent/);
    r = install(dir, home);
    assert.match(r.out, new RegExp(`Forma ${VERSION.replace(/\./g, '\\.')} — already this version`));
    assert.doesNotMatch(r.out, /Next: open the folder/);
    const m = JSON.parse(fs.readFileSync(manifestFile(dir), 'utf8'));
    m.version = '0.0.0';
    fs.writeFileSync(manifestFile(dir), JSON.stringify(m));
    r = install(dir, home);
    assert.match(r.out, new RegExp(`Forma updated: 0\\.0\\.0 → ${VERSION.replace(/\./g, '\\.')}\\.`));
    assert.equal(JSON.parse(fs.readFileSync(manifestFile(dir), 'utf8')).version, VERSION);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); } catch {}
    try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 5 }); } catch {}
  }
});

test('dashboard: without a terminal the installer prints the start command and does not start it', () => {
  const dir = tmp('forma-d-'), home = tmp('forma-h-');
  try {
    const r = install(dir, home);
    assert.match(r.out, /Dashboard: node \.forma\/dashboard\/ensure-running\.js/);
    assert.equal(fs.existsSync(path.join(dir, '.forma', 'dashboard', '.cache', 'server.json')), false);
    const no = install(dir, home, ['--no-dashboard']);
    assert.match(no.out, /Dashboard: node \.forma\/dashboard\/ensure-running\.js/);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); } catch {}
    try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 5 }); } catch {}
  }
});

test('dashboard: --dashboard starts it and prints its address', async () => {
  const dir = tmp('forma-d-'), home = tmp('forma-h-');
  const cache = path.join(dir, '.forma', 'dashboard', '.cache', 'server.json');
  const supCache = path.join(dir, '.forma', 'dashboard', '.cache', 'supervisor.json');
  let info = null;
  try {
    const r = install(dir, home, ['--dashboard']);
    assert.equal(r.status, 0, r.out);
    for (let i = 0; i < 60; i++) {
      if (fs.existsSync(cache)) {
        try { info = JSON.parse(fs.readFileSync(cache, 'utf8')); if (info && info.url) break; } catch {}
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
    assert.ok(info && info.url, 'server.json must be written: ' + r.out);
    assert.ok(r.out.includes(`Dashboard: ${info.url}`), r.out);
    const res = await fetch(info.url);
    assert.equal(res.status, 200);
  } finally {
    try {
      const sup = JSON.parse(fs.readFileSync(supCache, 'utf8'));
      if (sup && sup.pid) { try { process.kill(sup.pid); } catch { /* already gone */ } }
    } catch { /* no supervisor file */ }
    if (info && info.pid) { try { process.kill(info.pid); } catch { /* already gone */ } }
    if (process.platform === 'win32') {
      try {
        const normDir = path.normalize(dir).replace(/\\/g, '\\\\');
        const script = `Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -like '*${normDir}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
        spawnSync('powershell', ['-NoProfile', '-Command', script], { stdio: 'ignore', timeout: 5000 });
      } catch {}
    } else {
      try {
        const ps = spawnSync('pkill', ['-f', path.join(dir, '.forma', 'dashboard')]);
        void ps;
      } catch { /* no pkill */ }
    }
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); } catch {}
    try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 5 }); } catch {}
  }
});
