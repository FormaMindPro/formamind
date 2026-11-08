#!/usr/bin/env node
'use strict';

// The engines' switch: the sleeping registry `.forma/engines.json` (`{ "dormant": [...] }`).
//   node .claude/scripts/engine-switch.cjs status
//   node .claude/scripts/engine-switch.cjs sleep <engine>     - into the registry; the engine is neither reconciled nor installed
//   node .claude/scripts/engine-switch.cjs wake <engine>      - out of the registry, the engine's data rebuilt, reconciled
//   node .claude/scripts/engine-switch.cjs rebuild            - the mirrors of all active engines rebuilt from .claude/; the sleeping ones untouched;
//                                                                 an engine without an installed adapter (no zone of its own) - a skip marker, exit 0
// The rebuild (wake) is per engine - the REBUILD table. An engine missing from the table - only the marker and the general reconciliation.
// The registry is edited here, in the project; into the protocol source it goes by the usual forma-commit (engine-to-protocol, core/engines.json).
// Printed labels come from the core dictionary: English key in code, ru value as data.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
// Installed layout first (.claude/scripts -> .forma/i18n); the protocol source keeps it in core/i18n (tests load this file in place).
const i18n = require([path.resolve(__dirname, '../../.forma/i18n/index.cjs'), path.resolve(__dirname, '../../../core/i18n/index.cjs')].find((p) => fs.existsSync(p)));
const msg = (code, params) => i18n.message(code, params, 'ru');

const ROOT = process.cwd();
const REGISTRY = path.join(ROOT, '.forma', 'engines.json');
const ENGINES = ['claude', 'codex', 'gemini', 'kimi', 'minimax', 'zcode'];
// The adapter's zone - the sign of "the engine is installed"; claude - the base, lives in .claude/ and has no zone.
const ZONE = { gemini: '.agents/plugins/forma', kimi: '.kimi', codex: '.codex', minimax: '.minimax', zcode: '.zcode' };
const installed = (id) => !ZONE[id] || fs.existsSync(path.join(ROOT, ZONE[id]));
const REBUILD = {
  gemini: [
    ['.claude/scripts/sync-engines.cjs', '--apply'], // the roles mirror .agents/plugins/forma/agents/ anew from .claude/agents/
  ],
  kimi: [
    ['.kimi/scripts/sync-kimi.cjs'],        // the roles mirror .kimi/agents/ anew from .claude/agents/
    ['.kimi/scripts/sync-kimi-agents.cjs'], // the native agents .kimi/agents-code/ from the mirror
    ['.kimi/tests/test-kimi-adapter.cjs'],
  ],
  codex: [
    ['.codex/scripts/sync-codex.cjs', '--apply'],   // the roles and the skills mirror anew from .claude/
    ['.codex/tests/test-sync-codex.cjs'],
  ],
  minimax: [
    ['.minimax/scripts/gen-roles.cjs'],           // the roles .minimax/agents/ anew from .claude/agents/
    ['.minimax/scripts/gen-plugin-agents.cjs'],   // the miniapps/minimax-engine/ package's subagents from .minimax/agents/
    ['.minimax/scripts/install-plugin.cjs'],      // the package - into the MiniMax data directory
    ['.minimax/tests/test-minimax-adapter.cjs'],
  ],
  zcode: [
    ['.zcode/scripts/gen-roles.cjs'],        // the roles mirror .zcode/agents/ anew from .claude/agents/
    ['.zcode/tests/test-zcode-adapter.cjs'],
  ],
};

const read = () => { try { const l = JSON.parse(fs.readFileSync(REGISTRY, 'utf8')).dormant; return Array.isArray(l) ? l : []; } catch { return []; } };
const write = (list) => fs.writeFileSync(REGISTRY, JSON.stringify({ dormant: list }, null, 2) + '\n');
const node = (args) => spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' });
const fail = (m) => { console.error(msg('engine-switch.stop', { m })); process.exit(1); };

// The rebuild steps of one engine by the REBUILD table: the shared path for wake and rebuild.
function rebuildEngine(id) {
  for (const step of REBUILD[id] || []) {
    if (!fs.existsSync(path.join(ROOT, step[0]))) fail(msg('engine-switch.missing_step', { step: step[0], id }));
    const r = node(step);
    console.log(`${r.status === 0 ? '✓' : '✗'} ${step.join(' ')}`);
    if (r.status !== 0) { console.log(((r.stdout || '') + (r.stderr || '')).trim().split(/\r?\n/).slice(-8).join('\n')); fail(msg('engine-switch.rebuild_failed', { id })); }
  }
}

const [cmd, id] = process.argv.slice(2);
if (cmd === 'status' || !cmd) {
  const d = read();
  for (const e of ENGINES) console.log(`${e}: ${d.includes(e) ? msg('engine-switch.status_sleeping') : installed(e) ? msg('engine-switch.status_active') : msg('engine-switch.status_not_installed')}`);
  process.exit(0);
}
if (cmd === 'rebuild') {
  const dormantList = read();
  const active = ENGINES.filter((e) => e !== 'claude' && !dormantList.includes(e));
  const built = [], noAdapter = [];
  for (const e of active) {
    if (!installed(e)) { console.log(msg('engine-switch.skipped_no_adapter', { id: e })); noAdapter.push(e); continue; }
    rebuildEngine(e);
    built.push(e);
  }
  const skipped = ENGINES.filter((e) => e !== 'claude' && dormantList.includes(e));
  console.log(msg('engine-switch.rebuilt', {
    built: built.join(', ') || msg('engine-switch.none'),
    no_adapter: noAdapter.length ? msg('engine-switch.no_adapter_suffix', { list: noAdapter.join(', ') }) : '',
    skipped: skipped.length ? msg('engine-switch.skipped_suffix', { list: skipped.join(', ') }) : '',
  }));
  process.exit(0);
}
if (!['sleep', 'wake'].includes(cmd) || !ENGINES.includes(id)) fail(msg('engine-switch.usage', { engines: ENGINES.join(', ') }));
if (id === 'claude') fail(msg('engine-switch.claude_no_sleep'));

const list = read();
if (cmd === 'sleep') {
  write([...new Set([...list, id])]);
  console.log(msg('engine-switch.sleep_done', { id }));
} else {
  write(list.filter((e) => e !== id));
  console.log(msg('engine-switch.wake_done', { id }));
  rebuildEngine(id);
}
const chk = node(['.claude/scripts/sync-engines.cjs', '--check']);
// A red for the engine - the reconciliation lines about the adapters and about this engine; other findings
// (cards, board) do not belong to the switch. \u0430\u0434\u0430\u043f\u0442\u0435\u0440 = "adapter" in ru (a parse pattern, escapes);
// \u0421\u0431\u043e\u0439 = the ru header naming the reconciliation failed.
const own = chk.stdout.split(/\r?\n/).filter((l) => /✗/.test(l) && new RegExp('\u0430\u0434\u0430\u043f\u0442\u0435\u0440|' + id, 'i').test(l));
const other = new RegExp('^\u0421\u0431\u043e\u0439', 'm').test(chk.stdout);
console.log(own.length ? msg('engine-switch.check_red') + own.join('\n') : msg('engine-switch.check_green'));
if (other && !own.length) console.log(msg('engine-switch.other_findings'));
process.exit(own.length ? 1 : 0);
