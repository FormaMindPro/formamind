'use strict';
/**
 * ram-disk-status.lib.cjs - the logic of the RAM disk status line (SessionStart).
 * readStatus(cb) - one detection (the vdisk-setup skill's check-vdisk.cjs), on a miss one provision
 * attempt (setup-ramdisk.ps1, machine-local), then one line, never a crash. formatStatus(reading) -
 * the pure formatter the selftest exercises. Part of the project extensions, synced to .claude/hooks/.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const CANDIDATES = [
  '.claude/skills/vdisk-setup/scripts/check-vdisk.cjs',
  '.forma/skills/vdisk-setup/scripts/check-vdisk.cjs',
];

function checkScript() {
  return CANDIDATES.find((p) => fs.existsSync(path.join(process.cwd(), p))) || null;
}

/** One probe of the machine's checker: { mounted, path, source } or { mounted: false, error }. */
function probe() {
  const script = checkScript();
  if (!script) return { mounted: false, error: 'check-vdisk.cjs not found' };
  try {
    const out = execFileSync(process.execPath, [script, '--json'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
    const j = JSON.parse(out);
    return { mounted: !!j.mounted || !!j.ok, path: j.path || j.vdiskPath || null, source: j.source || null };
  } catch (e) {
    return { mounted: false, error: String(e && e.message || e).slice(0, 120) };
  }
}

/** One provision attempt through the machine's setup script; machine-local, never hardcoded here. */
function provisionOnce() {
  for (const base of ['.claude/skills/vdisk-setup/scripts', '.forma/skills/vdisk-setup/scripts']) {
    const ps1 = path.join(process.cwd(), base, 'setup-ramdisk.ps1');
    if (!fs.existsSync(ps1)) continue;
    try {
      execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1], { timeout: 20000, windowsHide: true });
      return true;
    } catch { return false; }
  }
  return false;
}

function formatStatus(r) {
  if (r && r.mounted && r.path) return 'RAM disk ready: ' + r.path + (r.source ? ' (' + r.source + ')' : '') + ' — test fixtures and scratch output go here.';
  if (r && r.provisionTried && r.provisionOk && r.path) return 'RAM disk provisioned and ready: ' + r.path + ' — test fixtures and scratch output go here.';
  return 'No RAM disk on this machine' + (r && r.error ? ' (' + r.error + ')' : '') + ' — the work continues degraded on ' + (r && r.fallback || 'os.tmpdir()') + '.';
}

function readStatus(cb) {
  let r = probe();
  if (!r.mounted) {
    const ok = provisionOnce();
    r = probe();
    r.provisionTried = true;
    r.provisionOk = ok;
  }
  if (!r.mounted) r.fallback = 'os.tmpdir()';
  let line = null;
  try { line = formatStatus(r); } catch { line = null; }
  cb(line);
}

module.exports = { readStatus, formatStatus, probe };
