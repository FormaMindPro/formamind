#!/usr/bin/env node
// The cycle count by epics (AGENTS.md §3, §7).
// The cycle runs inside an epic: `Core` closes it when the epic's accepted cards (done + assignee "Core")
// have reached the "cycle volume" (PROJECT.md), on the human's command or by the deadline. The protocol release
// (dev -> main, the version, the push) - by the release volume or on a cycle's closure.
//   node .claude/scripts/cycle-status.cjs          - the report line: "Forma 7/10 · … · protocol: K/N commits in dev before the release"
//   node .claude/scripts/cycle-status.cjs --json   - the same as data
// Read only. The exit is always 0.
// Printed labels come from the core dictionary: English key in code, ru value as data.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
function resolveLib(subpath) {
  const candidates = [
    path.resolve(__dirname, '../../.forma/dashboard/lib', subpath),
    path.resolve(__dirname, '../../../core/dashboard/lib', subpath),
    path.resolve(process.cwd(), '.forma/dashboard/lib', subpath),
    path.resolve(process.cwd(), '.forma/protocol/skills/forma/core/dashboard/lib', subpath),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

const { readIfExists, projectFile } = require(resolveLib('fs.cjs'));
// Installed layout first (.claude/scripts → .forma/i18n); the protocol source keeps it in core/i18n (tests load this file in place).
const i18n = require([path.resolve(__dirname, '../../.forma/i18n/index.cjs'), path.resolve(__dirname, '../../../core/i18n/index.cjs')].find((p) => fs.existsSync(p)));
const { cardFiles, frontmatterBlock } = require(resolveLib('card.cjs'));
const msg = (code, params) => i18n.message(code, params, 'ru');

function parseVolume(text) {
  if (!text) return null;
  return i18n.rowNumber(text, 'volume');
}

function getCycleStatus(root = ROOT) {
  const pm = readIfExists(projectFile(root, 'PROJECT.md'));
  const volume = parseVolume(pm);
  const rm = i18n.reader(pm).trailingNumber('release');
  const release = rm ? +rm : 10;

  const perEpic = new Map();
  for (const file of cardFiles(root)) {
    const fm = frontmatterBlock(fs.readFileSync(file, 'utf8')) || '';
    const epic = (fm.match(/^epic:\s*"(.+?)"/m) || [])[1];
    if (!epic) continue;
    const status = (fm.match(/^status:\s*"(.+?)"/m) || [])[1];
    const assignee = (fm.match(/^assignee:\s*"?(.+?)"?\s*$/m) || [])[1];
    if (status === 'done' && assignee === 'Core') perEpic.set(epic, (perEpic.get(epic) || 0) + 1);
  }

  let ahead = null;
  const proto = path.join(root, '.forma/protocol');
  if (fs.existsSync(path.join(proto, '.git'))) {
    // the commits in dev not yet released into main; no dev branch - the old count against upstream
    const cnt = (range, ...o) => +execFileSync('git', ['-C', proto, 'rev-list', '--count', ...o, range], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    try { ahead = cnt('main..dev', '--no-merges'); } catch { try { ahead = cnt('@{u}..HEAD'); } catch { /* no dev branch and no upstream - the counter keeps its previous value */ } }
  }

  const epics = [...perEpic].map(([epic, accepted]) => ({ epic, accepted, full: volume != null && accepted >= volume }));
  return { volume, epics, protocolAhead: ahead, releaseVolume: release };
}

if (require.main === module) {
  const status = getCycleStatus(ROOT);
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify(status) + '\n');
    process.exit(0);
  }
  const parts = status.epics.map((e) => `${e.epic.replace(/\/.*$/, '')} ${e.accepted}/${status.volume ?? '?'}${e.full ? msg('cycle-status.due_core') : ''}`);
  if (status.protocolAhead) parts.push(msg('cycle-status.protocol_line', { ahead: status.protocolAhead, release: status.releaseVolume }));
  if (parts.length) console.log(msg('cycle-status.header') + parts.join(' · '));
  process.exit(0);
}

module.exports = { parseVolume, getCycleStatus };
